import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import type { output as ZodOutput } from "zod";
import { screenshotFile, screenshotHtml } from "./chrome.server";
import { renderWorkflowHtml, workflowStats } from "./graph.server";
import type { openItem, renderItem, shareItem } from "./items.shared";
import { publish } from "./share.server";
import { editorUrlFor, loadWorkflow, resolveInsideRoots } from "./sources.server";

const DEFAULT_W = 1600;
const DEFAULT_H = 1000;

export async function handleRender({
  ref,
  directory,
  width,
  height,
  scale,
  dark,
}: ZodOutput<typeof renderItem.input>) {
  if (ref.kind === "html") {
    const file = await resolveInsideRoots(ref.path, "html", directory);
    const shot = await screenshotFile(file, width ?? DEFAULT_W, height ?? DEFAULT_H, scale);
    return {
      dataUri: `data:image/png;base64,${shot.png.toString("base64")}`,
      width: shot.width,
      height: shot.height,
      bytes: shot.png.length,
      nodeCount: null,
    };
  }

  const doc = await loadWorkflow(ref, directory);
  const title = doc.name ?? (ref.kind === "workflow-instance" ? ref.id : "Workflow");
  const page = renderWorkflowHtml(doc, { dark, title });
  const shot = await screenshotHtml(
    page.html,
    Math.min(page.width, 3200),
    Math.min(page.height, 2400),
    scale,
  );
  return {
    dataUri: `data:image/png;base64,${shot.png.toString("base64")}`,
    width: shot.width,
    height: shot.height,
    bytes: shot.png.length,
    nodeCount: workflowStats(doc).nodeCount,
  };
}

export async function handleShare({ ref, directory, dark }: ZodOutput<typeof shareItem.input>) {
  if (ref.kind === "html") {
    const file = await resolveInsideRoots(ref.path, "html", directory);
    // Self-contained by definition, so the file's own bytes are the page.
    return publish(await readFile(file, "utf8"), file.split("/").pop() ?? "diagram");
  }
  const doc = await loadWorkflow(ref, directory);
  const title = doc.name ?? (ref.kind === "workflow-instance" ? ref.id : "Workflow");
  return publish(renderWorkflowHtml(doc, { dark, title }).html, title);
}

/**
 * For anything with an n8n id this returns the editor URL rather than opening
 * something locally — that is the useful answer when an MCP agent just created
 * or edited the workflow and you want to go look at it.
 */
export async function handleOpen({ ref, directory }: ZodOutput<typeof openItem.input>) {
  if (ref.kind === "workflow-instance") {
    const url = editorUrlFor(ref.id);
    if (!url) {
      throw new Error("Set N8N_BASE_URL for the daemon to get an editor link.");
    }
    return { detail: "Open this in n8n:", url };
  }

  if (ref.kind === "workflow-file") {
    const file = await resolveInsideRoots(ref.path, "json", directory);
    const parsed = JSON.parse(await readFile(file, "utf8")) as { id?: unknown };
    const url = editorUrlFor(typeof parsed.id === "string" ? parsed.id : null);
    if (url) return { detail: "This export is on your instance:", url };
    return { detail: "No workflow id in that export, so there is nothing to link to.", url: null };
  }

  const file = await resolveInsideRoots(ref.path, "html", directory);
  const opener =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawn(opener, [file], { stdio: "ignore", detached: true }).unref();
  return { detail: `Opened ${file} in the browser on the daemon machine.`, url: null };
}
