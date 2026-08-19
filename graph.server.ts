/**
 * Turn an n8n workflow JSON document into a standalone HTML page with inline SVG.
 *
 * Deliberately renders node NAMES, node TYPES and sticky notes only. Node
 * `parameters` and `credentials` are never read, so nothing secret can end up
 * in an image or a shared page.
 */

const NODE_W = 190;
const NODE_H = 58;
const PAD = 70;
const STICKY_TYPE = "n8n-nodes-base.stickyNote";

export interface WorkflowDoc {
  name?: string;
  nodes?: unknown;
  connections?: unknown;
  active?: boolean;
}

interface Node {
  name: string;
  type: string;
  x: number;
  y: number;
  sticky: boolean;
  stickyContent: string;
  stickyW: number;
  stickyH: number;
  disabled: boolean;
}

interface Palette {
  bg: string;
  panel: string;
  grid: string;
  text: string;
  muted: string;
  edge: string;
  edgeAlt: string;
  stickyFill: string;
  stickyStroke: string;
  stickyText: string;
}

const LIGHT: Palette = {
  bg: "#f7f8fa", panel: "#ffffff", grid: "#e6e9ef", text: "#101828", muted: "#667085",
  edge: "#98a2b3", edgeAlt: "#b692f6", stickyFill: "#fffbe6", stickyStroke: "#f2e28a",
  stickyText: "#665c1e",
};

const DARK: Palette = {
  bg: "#14161a", panel: "#1d2027", grid: "#262a33", text: "#f0f2f5", muted: "#98a2b3",
  edge: "#5a6274", edgeAlt: "#8b6fd4", stickyFill: "#2c2a1c", stickyStroke: "#4b4526",
  stickyText: "#e6dca4",
};

/** Node accent colours, chosen by what the node does. */
function accentFor(type: string, dark: boolean): string {
  const t = type.toLowerCase();
  const pick = (light: string, night: string) => (dark ? night : light);
  if (t.includes("trigger") || t.endsWith(".webhook") || t.includes("cron")) {
    return pick("#12b76a", "#3ccb7f");
  }
  if (t.includes("code") || t.includes("function")) return pick("#7a5af8", "#9b8afb");
  if (t.includes("if") || t.includes("switch") || t.includes("filter")) {
    return pick("#f79009", "#fdb022");
  }
  if (t.includes("httprequest") || t.includes("graphql")) return pick("#2e90fa", "#53b1fd");
  if (t.includes("stopanderror") || t.includes("error")) return pick("#f04438", "#f97066");
  if (t.includes("merge") || t.includes("split") || t.includes("aggregate")) {
    return pick("#0ba5ec", "#36bffa");
  }
  if (t.includes("set") || t.includes("noop")) return pick("#667085", "#98a2b3");
  return pick("#6172f3", "#8098f9");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** Short, readable form of `n8n-nodes-base.httpRequest`. */
function shortType(type: string): string {
  const tail = type.split(".").pop() ?? type;
  return tail
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

function readNodes(doc: WorkflowDoc): Node[] {
  if (!Array.isArray(doc.nodes)) return [];
  const nodes: Node[] = [];
  for (const raw of doc.nodes) {
    if (typeof raw !== "object" || raw === null) continue;
    const entry = raw as Record<string, unknown>;
    const position = Array.isArray(entry.position) ? entry.position : [0, 0];
    const type = typeof entry.type === "string" ? entry.type : "unknown";
    const sticky = type === STICKY_TYPE;
    const parameters =
      sticky && typeof entry.parameters === "object" && entry.parameters !== null
        ? (entry.parameters as Record<string, unknown>)
        : {};
    nodes.push({
      name: typeof entry.name === "string" ? entry.name : "Unnamed",
      type,
      x: Number(position[0]) || 0,
      y: Number(position[1]) || 0,
      sticky,
      // Sticky notes are documentation the workflow author wrote on the canvas.
      stickyContent: typeof parameters.content === "string" ? parameters.content : "",
      stickyW: Number(parameters.width) || 260,
      stickyH: Number(parameters.height) || 180,
      disabled: entry.disabled === true,
    });
  }
  return nodes;
}

interface Edge {
  from: string;
  to: string;
  outputIndex: number;
  outputCount: number;
  channel: string;
}

function readEdges(doc: WorkflowDoc): Edge[] {
  const edges: Edge[] = [];
  const connections = doc.connections;
  if (typeof connections !== "object" || connections === null) return edges;
  for (const [from, byChannel] of Object.entries(connections as Record<string, unknown>)) {
    if (typeof byChannel !== "object" || byChannel === null) continue;
    for (const [channel, outputs] of Object.entries(byChannel as Record<string, unknown>)) {
      if (!Array.isArray(outputs)) continue;
      outputs.forEach((targets, outputIndex) => {
        if (!Array.isArray(targets)) return;
        for (const target of targets) {
          if (typeof target !== "object" || target === null) continue;
          const to = (target as Record<string, unknown>).node;
          if (typeof to !== "string") continue;
          edges.push({ from, to, outputIndex, outputCount: outputs.length, channel });
        }
      });
    }
  }
  return edges;
}

export function workflowStats(doc: WorkflowDoc): { nodeCount: number } {
  return { nodeCount: readNodes(doc).filter((node) => !node.sticky).length };
}

export function renderWorkflowHtml(
  doc: WorkflowDoc,
  options: { dark: boolean; title: string },
): { html: string; width: number; height: number } {
  const palette = options.dark ? DARK : LIGHT;
  const nodes = readNodes(doc);
  const edges = readEdges(doc);
  const byName = new Map(nodes.map((node) => [node.name, node]));

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    const w = node.sticky ? node.stickyW : NODE_W;
    const h = node.sticky ? node.stickyH : NODE_H;
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + w);
    maxY = Math.max(maxY, node.y + h);
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 400;
    maxY = 200;
  }

  const headerH = 64;
  const originX = minX - PAD;
  const originY = minY - PAD - headerH;
  const width = Math.max(560, maxX - minX + PAD * 2);
  const height = Math.max(320, maxY - minY + PAD * 2 + headerH);

  const parts: string[] = [];

  // Sticky notes sit behind the graph.
  for (const node of nodes.filter((n) => n.sticky)) {
    const lines = node.stickyContent.split("\n").slice(0, 12);
    parts.push(
      `<g><rect x="${node.x}" y="${node.y}" width="${node.stickyW}" height="${node.stickyH}" rx="10" fill="${palette.stickyFill}" stroke="${palette.stickyStroke}"/>` +
        lines
          .map(
            (line, index) =>
              `<text x="${node.x + 14}" y="${node.y + 26 + index * 16}" font-size="12" fill="${palette.stickyText}">${escapeXml(truncate(line.replace(/^#+\s*/, ""), 56))}</text>`,
          )
          .join("") +
        `</g>`,
    );
  }

  // Edges under the node boxes.
  for (const edge of edges) {
    const from = byName.get(edge.from);
    const to = byName.get(edge.to);
    if (!from || !to || from.sticky || to.sticky) continue;
    const spread = edge.outputCount > 1 ? (edge.outputIndex + 0.5) / edge.outputCount : 0.5;
    const x1 = from.x + NODE_W;
    const y1 = from.y + NODE_H * spread;
    const x2 = to.x;
    const y2 = to.y + NODE_H / 2;
    const grip = Math.max(40, Math.abs(x2 - x1) * 0.45);
    const main = edge.channel === "main";
    parts.push(
      `<path d="M ${x1} ${y1} C ${x1 + grip} ${y1}, ${x2 - grip} ${y2}, ${x2} ${y2}" fill="none" stroke="${main ? palette.edge : palette.edgeAlt}" stroke-width="2"${main ? "" : ' stroke-dasharray="5 4"'} marker-end="url(#head${main ? "" : "-alt"})"/>`,
    );
    if (edge.outputCount > 1) {
      parts.push(
        `<text x="${x1 + 8}" y="${y1 - 6}" font-size="10" fill="${palette.muted}">${escapeXml(String(edge.outputIndex))}</text>`,
      );
    }
  }

  // Node boxes.
  for (const node of nodes.filter((n) => !n.sticky)) {
    const accent = accentFor(node.type, options.dark);
    parts.push(
      `<g${node.disabled ? ' opacity="0.45"' : ""}>` +
        `<rect x="${node.x}" y="${node.y}" width="${NODE_W}" height="${NODE_H}" rx="10" fill="${palette.panel}" stroke="${palette.grid}"/>` +
        `<rect x="${node.x}" y="${node.y}" width="4" height="${NODE_H}" rx="2" fill="${accent}"/>` +
        `<text x="${node.x + 16}" y="${node.y + 25}" font-size="13" font-weight="600" fill="${palette.text}">${escapeXml(truncate(node.name, 24))}</text>` +
        `<text x="${node.x + 16}" y="${node.y + 43}" font-size="11" fill="${palette.muted}">${escapeXml(truncate(shortType(node.type), 26))}${node.disabled ? " · disabled" : ""}</text>` +
        `</g>`,
    );
  }

  const counted = nodes.filter((n) => !n.sticky).length;
  const subtitle = `${counted} node${counted === 1 ? "" : "s"} · ${edges.length} connection${edges.length === 1 ? "" : "s"}${doc.active === true ? " · active" : ""}`;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${originX} ${originY} ${width} ${height}" font-family="ui-sans-serif, -apple-system, Segoe UI, Roboto, sans-serif">` +
    `<defs>` +
    `<marker id="head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${palette.edge}"/></marker>` +
    `<marker id="head-alt" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${palette.edgeAlt}"/></marker>` +
    `</defs>` +
    `<rect x="${originX}" y="${originY}" width="${width}" height="${height}" fill="${palette.bg}"/>` +
    `<text x="${originX + 28}" y="${originY + 38}" font-size="18" font-weight="700" fill="${palette.text}">${escapeXml(truncate(options.title, 60))}</text>` +
    `<text x="${originX + 28}" y="${originY + 58}" font-size="12" fill="${palette.muted}">${escapeXml(subtitle)}</text>` +
    parts.join("") +
    `</svg>`;

  const html =
    `<!doctype html><html><head><meta charset="utf-8"/>` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"/>` +
    `<title>${escapeXml(options.title)}</title>` +
    `<style>html,body{margin:0;padding:0;background:${palette.bg};}` +
    `svg{display:block;max-width:100%;height:auto;}</style></head>` +
    `<body>${svg}</body></html>`;

  return { html, width: Math.round(width), height: Math.round(height) };
}
