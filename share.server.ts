/**
 * Optional sharing. Serves a rendered workflow page from memory on loopback and,
 * if a tunnel binary is ALREADY installed, exposes it through that.
 *
 * Nothing is installed and nothing is written to disk. When no tunnel is
 * available the local URL is returned instead of failing — sharing is a bonus,
 * not a requirement.
 *
 * A tunnel URL is PUBLIC and unauthenticated. Only the rendered page is
 * reachable, and the renderer never includes node parameters or credentials.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { delimiter, join } from "node:path";
import { accessSync, constants } from "node:fs";

const PORT = Number(process.env.PASEO_PREVIEW_SHARE_PORT ?? 8790);
const TUNNEL_TIMEOUT_MS = 40_000;

const STUB = "<!doctype html><meta charset=utf-8><title>Shared</title><p>Nothing to see here.";

interface Tunnel {
  child: ChildProcess;
  provider: string;
  url: string;
}

const pages = new Map<string, { html: string; title: string }>();
let server: Server | null = null;
let tunnel: Tunnel | null = null;

function onPath(binary: string): string | null {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, binary);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

async function ensureServer(): Promise<void> {
  if (server) return;
  server = createServer((request, response) => {
    const slug = (request.url ?? "/").replace(/^\/+/, "").split("?")[0];
    const page = pages.get(slug);
    if (!page) {
      // No directory listing: an unknown path reveals nothing about the rest.
      response.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      response.end(STUB);
      return;
    }
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    });
    response.end(page.html);
  });
  await new Promise<void>((settle, fail) => {
    server!.once("error", fail);
    server!.listen(PORT, "127.0.0.1", () => settle());
  });
}

/** Providers are tried in order and skipped when the binary is not installed. */
const PROVIDERS: Array<{
  name: string;
  binary: string;
  args: (port: number) => string[];
  match: RegExp;
}> = [
  {
    name: "cloudflared",
    binary: "cloudflared",
    args: (port) => ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`],
    match: /https:\/\/[a-z0-9-]+\.trycloudflare\.com/,
  },
  {
    name: "ngrok",
    binary: "ngrok",
    args: (port) => ["http", String(port), "--log=stdout"],
    match: /https:\/\/[a-z0-9-]+\.ngrok[a-z0-9.-]*\.(app|io|dev)/,
  },
  {
    name: "tailscale funnel",
    binary: "tailscale",
    args: (port) => ["funnel", String(port)],
    match: /https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.ts\.net/,
  },
];

async function startTunnel(): Promise<Tunnel | null> {
  for (const provider of PROVIDERS) {
    const binary = onPath(provider.binary);
    if (!binary) continue;

    const child = spawn(binary, provider.args(PORT), { stdio: ["ignore", "pipe", "pipe"] });
    const url = await new Promise<string | null>((settle) => {
      let buffer = "";
      const finish = (value: string | null) => {
        clearTimeout(timer);
        settle(value);
      };
      const onData = (chunk: Buffer) => {
        buffer += chunk.toString();
        const found = buffer.match(provider.match);
        if (found) finish(found[0]);
      };
      const timer = setTimeout(() => finish(null), TUNNEL_TIMEOUT_MS);
      child.stdout?.on("data", onData);
      child.stderr?.on("data", onData);
      child.once("error", () => finish(null));
      child.once("exit", () => finish(null));
    });

    if (url) return { child, provider: provider.name, url };
    child.kill("SIGTERM");
  }
  return null;
}

export async function publish(
  html: string,
  title: string,
): Promise<{ url: string; reach: "tunnel" | "local"; provider: string; note: string }> {
  await ensureServer();
  const slug = `${randomUUID()}.html`;
  pages.set(slug, { html, title });

  if (!tunnel) tunnel = await startTunnel();

  if (tunnel) {
    return {
      url: `${tunnel.url}/${slug}`,
      reach: "tunnel",
      provider: tunnel.provider,
      note: "Public and unauthenticated — anyone with the link can open it. It only shows node names, types and sticky notes.",
    };
  }
  return {
    url: `http://127.0.0.1:${PORT}/${slug}`,
    reach: "local",
    provider: "none",
    note: "No tunnel binary installed, so this link only works on the machine running the daemon. Install cloudflared, ngrok or tailscale to share it further.",
  };
}

export function status() {
  return {
    active: server !== null,
    url: tunnel?.url ?? (server ? `http://127.0.0.1:${PORT}` : null),
    reach: server ? ((tunnel ? "tunnel" : "local") as "tunnel" | "local") : null,
    provider: tunnel?.provider ?? null,
    published: [...pages.values()].map((page) => page.title),
  };
}

export async function stop(): Promise<{ detail: string }> {
  const hadTunnel = tunnel !== null;
  tunnel?.child.kill("SIGTERM");
  tunnel = null;
  pages.clear();
  if (server) {
    await new Promise<void>((settle) => server!.close(() => settle()));
    server = null;
  }
  return {
    detail: hadTunnel ? "Tunnel closed and shared pages dropped." : "Sharing stopped.",
  };
}
