import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import type { output as ZodOutput } from "zod";
import type { listDiagrams, openDiagram, renderDiagram } from "./diagrams.shared";
import type { DiagramItem } from "./diagrams.shared";

/** Drop folder agents write diagrams into. Visible from every workspace. */
const LIBRARY_DIR = process.env.PASEO_DIAGRAMS_DIR ?? join(homedir(), "Diagrams");

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", "out", "coverage",
  ".turbo", ".cache", ".venv", "venv", "vendor", "target", "__pycache__",
  ".pnpm-store", ".yarn", "Pods", ".gradle", ".paseo",
]);

const MAX_DEPTH = 6;
const MAX_RESULTS = 300;
const MAX_HTML_BYTES = 16 * 1024 * 1024;
const MAX_PNG_BYTES = 12 * 1024 * 1024;
const RENDER_TIMEOUT_MS = 45_000;

const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  process.env.CHROME_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium",
];

function findChrome(): string {
  for (const candidate of CHROME_CANDIDATES) {
    if (!candidate) continue;
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // try the next one
    }
  }
  throw new Error(
    "No Chrome or Chromium found on this machine. Install one, or set CHROME_BIN for the Paseo daemon.",
  );
}

/**
 * Resolve a client-supplied path and prove it sits inside a root the panel is
 * allowed to read. Plugin backends are unsandboxed, so the panel never gets to
 * name an arbitrary file on the daemon machine.
 */
async function resolveInsideRoots(path: string, directory?: string): Promise<string> {
  if (!/\.(html|htm)$/i.test(path)) {
    throw new Error("Only .html files can be opened as diagrams.");
  }
  const target = await realpath(resolve(path));
  const roots: string[] = [];
  for (const root of [LIBRARY_DIR, directory]) {
    if (!root) continue;
    try {
      roots.push(await realpath(resolve(root)));
    } catch {
      // a root that does not exist simply grants nothing
    }
  }
  const allowed = roots.some((root) => target === root || target.startsWith(root + sep));
  if (!allowed) {
    throw new Error("That file is outside the diagram library and the current workspace.");
  }
  return target;
}

/** Cheap check that an .html file is actually a drawing rather than a web page. */
async function looksLikeDiagram(path: string): Promise<boolean> {
  try {
    const head = (await readFile(path)).subarray(0, 262_144).toString("utf8");
    return head.includes("<svg") || head.includes("<canvas");
  } catch {
    return false;
  }
}

async function scan(
  root: string,
  source: DiagramItem["source"],
  sniff: boolean,
  out: DiagramItem[],
): Promise<boolean> {
  let truncated = false;
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];

  while (queue.length > 0) {
    const { dir, depth } = queue.shift()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth >= MAX_DEPTH || SKIP_DIRS.has(entry.name)) continue;
        queue.push({ dir: full, depth: depth + 1 });
        continue;
      }
      if (!entry.isFile() || !/\.(html|htm)$/i.test(entry.name)) continue;
      if (out.length >= MAX_RESULTS) return true;

      let info;
      try {
        info = await stat(full);
      } catch {
        continue;
      }
      if (info.size > MAX_HTML_BYTES) continue;
      if (sniff && !(await looksLikeDiagram(full))) continue;

      const location = relative(root, dir) || ".";
      out.push({
        path: full,
        name: entry.name,
        location,
        bytes: info.size,
        modifiedAt: info.mtime.toISOString(),
        source,
      });
    }
  }
  return truncated;
}

export async function handleList({ directory }: ZodOutput<typeof listDiagrams.input>) {
  await mkdir(LIBRARY_DIR, { recursive: true });

  const items: DiagramItem[] = [];
  let truncated = await scan(LIBRARY_DIR, "library", false, items);

  if (directory) {
    let workspaceRoot: string | null = null;
    try {
      workspaceRoot = await realpath(resolve(directory));
    } catch {
      workspaceRoot = null;
    }
    const libraryReal = await realpath(LIBRARY_DIR);
    // Skip the workspace pass when it would just re-list the library.
    if (workspaceRoot && workspaceRoot !== libraryReal) {
      truncated = (await scan(workspaceRoot, "workspace", true, items)) || truncated;
    }
  }

  items.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  return { items, libraryDir: LIBRARY_DIR, truncated };
}

function pngSize(buffer: Buffer): { width: number; height: number } {
  if (buffer.length < 24) return { width: 0, height: 0 };
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

export async function handleRender({
  path,
  directory,
  width,
  height,
  scale,
}: ZodOutput<typeof renderDiagram.input>) {
  const file = await resolveInsideRoots(path, directory);
  const chrome = findChrome();
  const workDir = await mkdtemp(join(tmpdir(), "paseo-diagram-"));
  const destination = join(workDir, "render.png");

  try {
    // Deliberately no --user-data-dir: a fresh profile makes headless Chrome on
    // macOS hang past any sane timeout. The default profile screenshots in ~2s.
    await new Promise<void>((settle, fail) => {
      const child = spawn(
        chrome,
        [
          "--headless",
          "--disable-gpu",
          "--no-sandbox",
          "--disable-dev-shm-usage",
          "--hide-scrollbars",
          `--force-device-scale-factor=${scale}`,
          "--no-first-run",
          "--no-default-browser-check",
          `--window-size=${width},${height}`,
          `--screenshot=${destination}`,
          `file://${file}`,
        ],
        { stdio: "ignore" },
      );
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        fail(new Error("Chrome took too long to render this diagram."));
      }, RENDER_TIMEOUT_MS);
      child.on("error", (error) => {
        clearTimeout(timer);
        fail(error);
      });
      // Chrome exits non-zero on benign warnings, so trust the output file instead.
      child.on("close", () => {
        clearTimeout(timer);
        settle();
      });
    });

    const png = await readFile(destination).catch(() => {
      throw new Error("Chrome produced no image. Open the file locally to check it renders.");
    });
    if (png.length === 0) {
      throw new Error("Chrome produced an empty image.");
    }
    if (png.length > MAX_PNG_BYTES) {
      throw new Error(
        `Rendered image is ${(png.length / 1_048_576).toFixed(1)} MB, too large to send. Try a 1x scale.`,
      );
    }
    const size = pngSize(png);
    return {
      dataUri: `data:image/png;base64,${png.toString("base64")}`,
      width: size.width,
      height: size.height,
      bytes: png.length,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export async function handleOpen({ path, directory }: ZodOutput<typeof openDiagram.input>) {
  const file = await resolveInsideRoots(path, directory);
  const opener =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  const child = spawn(opener, [file], { stdio: "ignore", detached: true });
  child.unref();
  return { detail: `Opened ${file} in the browser on the daemon machine.` };
}
