import { mkdir, readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import type { WorkflowDoc } from "./graph.server";
import { workflowStats } from "./graph.server";
import type { Item, ItemRef } from "./items.shared";

/** Drop folders. Both are scanned; either can be pointed elsewhere. */
export const DIAGRAM_DIR = process.env.PASEO_DIAGRAMS_DIR ?? join(homedir(), "Diagrams");
export const WORKFLOW_DIR = process.env.PASEO_N8N_DIR ?? join(homedir(), "n8n-workflows");

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", "out", "coverage",
  ".turbo", ".cache", ".venv", "venv", "vendor", "target", "__pycache__",
  ".pnpm-store", ".yarn", "Pods", ".gradle", ".paseo",
]);

const MAX_DEPTH = 6;
const MAX_RESULTS = 400;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const INSTANCE_TIMEOUT_MS = 15_000;

export function instanceConfig(): { baseUrl: string; apiKey: string } | null {
  const baseUrl = process.env.N8N_BASE_URL?.replace(/\/+$/, "");
  const apiKey = process.env.N8N_API_KEY;
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey };
}

/** The n8n editor deep link for a workflow id, when we know the instance. */
export function editorUrlFor(id: string | null | undefined): string | null {
  if (!id) return null;
  const base = process.env.N8N_BASE_URL?.replace(/\/+$/, "");
  return base ? `${base}/workflow/${encodeURIComponent(id)}` : null;
}

export function instanceHost(): string | null {
  const config = instanceConfig();
  if (!config) return null;
  try {
    return new URL(config.baseUrl).host;
  } catch {
    return config.baseUrl;
  }
}

async function callInstance(path: string): Promise<unknown> {
  const config = instanceConfig();
  if (!config) throw new Error("N8N_BASE_URL and N8N_API_KEY are not set for the Paseo daemon.");
  const response = await fetch(`${config.baseUrl}/api/v1${path}`, {
    headers: { "X-N8N-API-KEY": config.apiKey, accept: "application/json" },
    signal: AbortSignal.timeout(INSTANCE_TIMEOUT_MS),
  });
  // Never echo the body: it can carry workflow data or key hints.
  if (!response.ok) throw new Error(`n8n API returned ${response.status} ${response.statusText}.`);
  return response.json();
}

/**
 * Resolve a client-supplied path and prove it sits in a root the panel may read.
 * Plugin backends are unsandboxed, so the panel never names an arbitrary file.
 */
export async function resolveInsideRoots(
  path: string,
  expect: "html" | "json",
  directory?: string,
): Promise<string> {
  const pattern = expect === "html" ? /\.(html|htm)$/i : /\.json$/i;
  if (!pattern.test(path)) throw new Error(`Only ${expect === "html" ? ".html" : ".json"} files can be opened that way.`);
  const target = await realpath(resolve(path));
  const roots: string[] = [];
  for (const root of [DIAGRAM_DIR, WORKFLOW_DIR, directory]) {
    if (!root) continue;
    try {
      roots.push(await realpath(resolve(root)));
    } catch {
      // a root that does not exist grants nothing
    }
  }
  if (!roots.some((root) => target === root || target.startsWith(root + sep))) {
    throw new Error("That file is outside the library folders and the current workspace.");
  }
  return target;
}

function asWorkflow(value: unknown): (WorkflowDoc & { id?: unknown }) | null {
  if (typeof value !== "object" || value === null) return null;
  const doc = value as Record<string, unknown>;
  if (!Array.isArray(doc.nodes)) return null;
  if (typeof doc.connections !== "object" || doc.connections === null) return null;
  return doc as WorkflowDoc & { id?: unknown };
}

/** Cheap check that an .html file is a drawing rather than a web page. */
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
  origin: "library" | "workspace",
  accept: { html: boolean; json: boolean; sniffHtml: boolean },
  out: Item[],
): Promise<void> {
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
      if (entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth >= MAX_DEPTH || SKIP_DIRS.has(entry.name)) continue;
        queue.push({ dir: full, depth: depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      const isHtml = /\.(html|htm)$/i.test(entry.name);
      const isJson = /\.json$/i.test(entry.name);
      if (!(isHtml && accept.html) && !(isJson && accept.json)) continue;
      if (out.length >= MAX_RESULTS) return;

      let info;
      try {
        info = await stat(full);
      } catch {
        continue;
      }
      if (info.size > MAX_FILE_BYTES) continue;

      const location = relative(root, dir) || ".";
      if (isHtml) {
        if (accept.sniffHtml && !(await looksLikeDiagram(full))) continue;
        out.push({
          ref: { kind: "html", path: full },
          name: entry.name,
          location,
          kind: "diagram",
          origin,
          bytes: info.size,
          nodeCount: null,
          updatedAt: info.mtime.toISOString(),
          active: null,
          editorUrl: null,
        });
        continue;
      }

      let doc;
      try {
        doc = asWorkflow(JSON.parse(await readFile(full, "utf8")));
      } catch {
        continue;
      }
      if (!doc) continue;
      out.push({
        ref: { kind: "workflow-file", path: full },
        name: doc.name ?? entry.name.replace(/\.json$/i, ""),
        location,
        kind: "workflow",
        origin,
        bytes: info.size,
        nodeCount: workflowStats(doc).nodeCount,
        updatedAt: info.mtime.toISOString(),
        active: typeof doc.active === "boolean" ? doc.active : null,
        // An export written by an MCP agent usually keeps its workflow id, which
        // is enough to link straight back into the n8n editor.
        editorUrl: editorUrlFor(typeof doc.id === "string" ? doc.id : null),
      });
    }
  }
}

export async function listAll(directory?: string) {
  await mkdir(DIAGRAM_DIR, { recursive: true });
  await mkdir(WORKFLOW_DIR, { recursive: true });

  const items: Item[] = [];
  const instance = {
    configured: instanceConfig() !== null,
    host: instanceHost(),
    error: null as string | null,
  };

  if (instance.configured) {
    try {
      const payload = (await callInstance("/workflows?limit=200")) as { data?: unknown };
      for (const row of Array.isArray(payload.data) ? payload.data : []) {
        if (typeof row !== "object" || row === null) continue;
        const entry = row as Record<string, unknown>;
        const id = entry.id;
        if (typeof id !== "string" && typeof id !== "number") continue;
        items.push({
          ref: { kind: "workflow-instance", id: String(id) },
          name: typeof entry.name === "string" ? entry.name : String(id),
          location: instance.host ?? "instance",
          kind: "workflow",
          origin: "instance",
          bytes: null,
          nodeCount: Array.isArray(entry.nodes) ? entry.nodes.length : null,
          updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : null,
          active: typeof entry.active === "boolean" ? entry.active : null,
          editorUrl: editorUrlFor(String(id)),
        });
      }
    } catch (error) {
      instance.error = error instanceof Error ? error.message : String(error);
    }
  }

  await scan(DIAGRAM_DIR, "library", { html: true, json: false, sniffHtml: false }, items);
  const seen = new Set([await realpath(DIAGRAM_DIR)]);
  const workflowReal = await realpath(WORKFLOW_DIR);
  if (!seen.has(workflowReal)) {
    await scan(WORKFLOW_DIR, "library", { html: false, json: true, sniffHtml: false }, items);
    seen.add(workflowReal);
  }

  if (directory) {
    try {
      const workspaceRoot = await realpath(resolve(directory));
      if (!seen.has(workspaceRoot)) {
        await scan(workspaceRoot, "workspace", { html: true, json: true, sniffHtml: true }, items);
      }
    } catch {
      // an unreadable workspace contributes nothing
    }
  }

  items.sort((a, b) => {
    if (a.origin !== b.origin) return a.origin === "instance" ? -1 : b.origin === "instance" ? 1 : 0;
    return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || a.name.localeCompare(b.name);
  });

  return { items, diagramDir: DIAGRAM_DIR, workflowDir: WORKFLOW_DIR, instance };
}

export async function loadWorkflow(ref: ItemRef, directory?: string): Promise<WorkflowDoc> {
  if (ref.kind === "workflow-instance") {
    const doc = asWorkflow(await callInstance(`/workflows/${encodeURIComponent(ref.id)}`));
    if (!doc) throw new Error("The n8n API returned something that is not a workflow.");
    return doc;
  }
  if (ref.kind !== "workflow-file") throw new Error("Not a workflow reference.");
  const file = await resolveInsideRoots(ref.path, "json", directory);
  const doc = asWorkflow(JSON.parse(await readFile(file, "utf8")));
  if (!doc) throw new Error("That file is not an n8n workflow export.");
  return doc;
}
