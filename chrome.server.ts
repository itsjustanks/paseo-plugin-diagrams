import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

const RENDER_TIMEOUT_MS = 45_000;
const MAX_PNG_BYTES = 12 * 1024 * 1024;

export function findChrome(): string {
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

export function pngSize(buffer: Buffer): { width: number; height: number } {
  if (buffer.length < 24) return { width: 0, height: 0 };
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** Rasterise a page already on disk, so its relative assets still resolve. */
export async function screenshotFile(
  file: string,
  width: number,
  height: number,
  scale: number,
): Promise<{ png: Buffer; width: number; height: number }> {
  return shoot(`file://${file}`, width, height, scale);
}

/** Rasterise a self-contained HTML string. Nothing is written outside a temp dir. */
export async function screenshotHtml(
  html: string,
  width: number,
  height: number,
  scale: number,
): Promise<{ png: Buffer; width: number; height: number }> {
  const workDir = await mkdtemp(join(tmpdir(), "paseo-preview-"));
  const page = join(workDir, "page.html");
  try {
    await writeFile(page, html, "utf8");
    return await shoot(`file://${page}`, width, height, scale);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function shoot(
  target: string,
  width: number,
  height: number,
  scale: number,
): Promise<{ png: Buffer; width: number; height: number }> {
  const chrome = findChrome();
  const workDir = await mkdtemp(join(tmpdir(), "paseo-shot-"));
  const destination = join(workDir, "render.png");

  try {
    await new Promise<void>((settle, fail) => {
      // Deliberately no --user-data-dir: a fresh profile makes headless Chrome
      // on macOS hang past any sane timeout. The default profile is fast.
      const child = spawn(
        chrome,
        [
          "--headless",
          "--disable-gpu",
          "--no-sandbox",
          "--disable-dev-shm-usage",
          "--hide-scrollbars",
          "--no-first-run",
          "--no-default-browser-check",
          `--force-device-scale-factor=${scale}`,
          `--window-size=${width},${height}`,
          `--screenshot=${destination}`,
          target,
        ],
        { stdio: "ignore" },
      );
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        fail(new Error("Chrome took too long to render this file."));
      }, RENDER_TIMEOUT_MS);
      child.on("error", (error) => {
        clearTimeout(timer);
        fail(error);
      });
      // Chrome exits non-zero on benign warnings, so trust the output file.
      child.on("close", () => {
        clearTimeout(timer);
        settle();
      });
    });

    const png = await readFile(destination).catch(() => {
      throw new Error("Chrome produced no image.");
    });
    if (png.length === 0) throw new Error("Chrome produced an empty image.");
    if (png.length > MAX_PNG_BYTES) {
      throw new Error(
        `Rendered image is ${(png.length / 1_048_576).toFixed(1)} MB, too large to send. Try 1x.`,
      );
    }
    const size = pngSize(png);
    return { png, width: size.width, height: size.height };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
