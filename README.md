# Paseo Diagrams

A [Paseo](https://paseo.sh) plugin for looking at things that are meant to be looked at — HTML/SVG diagrams **and** n8n workflow graphs — from inside Paseo, on your desktop **and** on your phone.

No manual PNG export step, no browser session, and nothing leaves your machine unless you explicitly share it.

It renders **any** self-contained HTML file and has no dependency on a particular generator, skill or template — if it draws in a browser, it shows up here.

## The problem

Coding agents are good at producing diagrams as self-contained HTML with inline SVG. Paseo cannot show you one:

- Paseo chat renders `markdown`, `diff`, `image` and `code` artifacts. HTML is not on that list — an image is, which is what **Send to chat** exploits.
- Paseo plugin surfaces are React Native, and the only modules a client surface may import are `react`, `react-native`, `@tanstack/react-query`, `zod` and `@paseo/plugin`. There is no WebView and no iframe, so **a plugin cannot render HTML directly either.**
- Paseo's built-in browser tabs are hosted by the desktop app, so they are not a phone-viewing path.

The usual workarounds are worse than the problem: exporting a PNG by hand after every revision, or permanently serving files through a tunnel, which means a public unauthenticated URL and another daemon to keep running. Rendering on demand needs neither, and sharing stays something you opt into per item.

## What this does instead

The plugin keeps the HTML as the source of truth and moves the rendering to the daemon, where a browser already exists:

```
agent writes .html  ->  daemon rasterises with headless Chrome  ->  panel shows the image
```

The image travels back over the connection Paseo already has, so it works anywhere a Paseo client works — including the phone, over the relay.

## Features

- **Sidebar item and workspace panel**, plus “Open diagrams and workflows” in the Command Center (`⌘K` / `Ctrl+K`).
- **Two kinds of thing, one list:**
  - **HTML diagrams** — any self-contained `.html` with inline SVG. Render presets Wide (1600×1000), Card (1200×630), Tall (1200×1600), Square (1400×1400).
  - **n8n workflows** — `.json` exports on disk, and the workflows on a live n8n instance via its REST API. The graph is drawn here: nodes coloured by what they do, curved connections with arrowheads, branch indices on `IF`/`Switch`, disabled nodes dimmed, sticky notes behind the graph, light or dark to match your theme.
- **Send to chat** — from an agent's **Diagrams** panel, one press posts the rendered picture into that agent's conversation as an image, so the chart lands in the chat thread instead of staying trapped in a panel. The agent sees it too, which is useful when you want it to look at what it just drew.
- **Deep links back into n8n** — any workflow carrying an id gets a `…/workflow/<id>` link, so a workflow an agent just created or edited through an n8n MCP server is one press from being open in the editor.
- **Optional sharing** — publish a rendered diagram or workflow on a link, using a tunnel binary you already have. Nothing is installed, and it falls back to a loopback URL rather than failing.
- **Smart workspace scanning** — depth-limited, skips `node_modules`, `.git`, `dist`, `build` and friends. `.html` must contain an `<svg>` or `<canvas>` and `.json` must parse as a workflow, so ordinary files don't clutter the list.
- **Open the real thing** — on desktop, one press opens the interactive HTML in the browser on the daemon machine, so hover states and animation still work.
- **Themed and responsive** — colours come from the active Paseo theme, layout adapts to compact clients.

## What is drawn from a workflow, and what is not

The workflow renderer reads node **names**, node **types**, **connections** and **sticky notes**. It never reads node `parameters` or `credentials`, so no URL, token, query, expression or credential name can reach an image or a shared link.

## Requirements

- Paseo `0.5.0-beta.1` or newer, with plugins enabled (`pluginsEnabled: true` in `~/.paseo/config.json`, or **Settings → Plugins**).
- Chrome or Chromium installed on the **daemon** machine. macOS and Linux locations are auto-detected; set `CHROME_BIN` if yours lives somewhere unusual.
- Node.js, for the one-time `npm install`.

No Playwright, no Puppeteer, no Python, no tunnel daemon.

## Install

```bash
git clone https://github.com/itsjustanks/paseo-plugin-diagrams.git
cd paseo-plugin-diagrams
npm install
paseo plugin install "$PWD"
paseo plugin ls        # should report: diagrams  running
```

Run this on the machine the daemon runs on. Plugins are installed per daemon.

## Use it

Save diagram HTML into `~/Diagrams`, and n8n workflow JSON into `~/n8n-workflows`. Open **Diagrams** in the sidebar.

Point an agent at it directly:

> Draw the service architecture as a self-contained HTML file with inline SVG and save it to `~/Diagrams/architecture.html`.

Anything already sitting in a workspace is picked up too — open the **Diagrams** workspace panel instead of the sidebar item.

### Configuration

| Variable                    | Default            | Meaning                                            |
| --------------------------- | ------------------ | -------------------------------------------------- |
| `PASEO_DIAGRAMS_DIR`        | `~/Diagrams`       | Folder scanned for diagram HTML.                    |
| `PASEO_N8N_DIR`             | `~/n8n-workflows`  | Folder scanned for workflow JSON.                   |
| `N8N_BASE_URL`              | unset              | Your n8n. Enables the live list and editor links.   |
| `N8N_API_KEY`               | unset              | n8n API key, required with `N8N_BASE_URL`.          |
| `PASEO_PREVIEW_SHARE_PORT`  | `8790`             | Loopback port used while sharing.                   |
| `CHROME_BIN`                | auto-detected      | Path to Chrome/Chromium on the daemon box.          |

These are read by the daemon, so set them where the daemon can see them.

## How it works

Three RPCs, all handled in the plugin's own subprocess beside the daemon:

| RPC                     | Does                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `preview.list`          | Scans both library folders, the workspace, and a live n8n if configured.                 |
| `preview.render`        | Screenshots a diagram, or draws a workflow graph, and returns a base64 PNG.              |
| `preview.open`          | Returns the n8n editor URL for a workflow, or opens a diagram on the daemon machine.     |
| `preview.share`         | Serves the page from memory and exposes it through an installed tunnel, if there is one. |
| `preview.share-status`  | What is currently published, and how it is reachable.                                    |
| `preview.share-stop`    | Closes the tunnel and drops every published page.                                        |

Sending to chat does not need an RPC: the panel renders through `preview.render`, then posts the PNG with the Paseo SDK's `agents.ref(id).send(text, { images })`, which is why it only appears in the agent-context panel — that is the only place the plugin knows whose conversation to post into.

The client surface holds no filesystem access and no browser logic; it renders a list and an `<Image>`.

## Security

Plugin backends run **unsandboxed** on the daemon machine — that is true of every Paseo plugin, so it is worth being explicit about what this one does with that access:

- Every path the client sends is `realpath`-resolved and must resolve **inside a library folder or the current workspace directory**. Anything else is refused, so a panel cannot be talked into reading arbitrary files.
- Only `.html`/`.htm` and `.json` are accepted, matched against what the reference claims to be.
- The n8n API key is read from the daemon environment, used only for `GET /api/v1/workflows`, never sent to the client surface, and API error bodies are not echoed back.
- Rendering happens in a throwaway temp directory that is removed afterwards, and Chrome is killed if it exceeds its timeout.
- Rendered images are capped before being sent, so a runaway diagram cannot flood the connection.
- Nothing is uploaded or exposed to a network unless you press **Share**. Rendering alone goes back over your existing Paseo connection.

## Sharing

**Share** serves the rendered page from memory on loopback. If `cloudflared`, `ngrok` or `tailscale` is already on the daemon's `PATH` it is used to expose that page and you get a public link; otherwise you get the loopback URL and a note saying so. Nothing is ever installed, and nothing is written to disk.

A tunnel link is **public and unauthenticated**. Only the page you shared is reachable: URLs are random UUIDs, the root returns a stub rather than a listing, and `noindex` is set. **Stop sharing** closes the tunnel and drops every published page; so does reloading or disabling the plugin.

## A note on `@n8n_io/n8n-demo-component`

n8n publishes an official web component for workflow previews, and using it for an authentic canvas is an obvious idea. It was tried here and dropped, for three reasons worth recording:

1. **It renders remotely.** The component mounts an iframe pointing at `n8n-preview-service.internal.n8n.cloud` and posts the workflow JSON into it, so the whole workflow — parameters and all — leaves your machine.
2. **It cannot be pointed at self-hosted n8n.** The `src` attribute suggests it can, but that route does not exist on a self-hosted instance; it answers `404` with `default-src 'none'`.
3. **It does not render headless.** The iframe is lazy-loaded behind an `IntersectionObserver` and a cross-frame handshake, neither of which completes under a headless screenshot. Verified blank at 1600×1000 from both a `file://` page and a real HTTP origin, against the live preview service.

Drawing the graph directly costs a few hundred lines, keeps the plugin dependency-free, works offline, and never sends a workflow anywhere.

## Development

`paseo-plugin.d.ts` supplies the `@paseo/plugin` types for local typechecking. It is generated per project and pinned to one CLI version, so it is deliberately not tracked here. Generate it once after cloning:

```bash
paseo plugin init /tmp/paseo-types && cp /tmp/paseo-types/paseo-plugin.d.ts .
```

Then the normal loop:

```bash
npm run typecheck
paseo plugin reload diagrams
paseo plugin logs diagrams
```

Reload picks up source edits. Don't restart the daemon for a plugin change — that kills running agents.

File suffixes are the runtime boundary and Paseo enforces them: `*.client.tsx` is React Native, `*.server.ts` is Node, `*.shared.ts` is Zod contracts and plain values imported by both.

One hard-won note for anyone doing headless Chrome work: **do not pass `--user-data-dir`.** A fresh profile makes headless Chrome on macOS hang indefinitely; the default profile screenshots in about two seconds.

## Credits

- [Paseo](https://github.com/getpaseo/paseo) by the Paseo team — the app and plugin system this is built on.
- [n8n](https://github.com/n8n-io/n8n) — the workflow automation tool whose export format this reads.
- [diagram-design](https://github.com/cathrynlavery/diagram-design) by Cathryn Lavery — one nice way to author diagram HTML. Not required: point anything at `~/Diagrams` and it shows up here.

## License

MIT © [Ankit Paliwal](https://github.com/itsjustanks)
