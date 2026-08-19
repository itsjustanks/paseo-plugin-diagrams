# Paseo Diagrams

A [Paseo](https://paseo.sh) plugin for looking at diagrams — architecture drawings, flowcharts, ER models, Gantt charts, anything an agent generates as HTML with inline SVG — from inside Paseo, on your desktop **and** on your phone.

No tunnel. No public URL. No manual PNG export step.

It renders **any** self-contained HTML file and has no dependency on a particular generator, skill or template — if it draws in a browser, it shows up here.

## The problem

Coding agents are good at producing diagrams as self-contained HTML with inline SVG. Paseo cannot show you one:

- Paseo chat renders `markdown`, `diff`, `image` and `code` artifacts. HTML is not on that list.
- Paseo plugin surfaces are React Native, and the only modules a client surface may import are `react`, `react-native`, `@tanstack/react-query`, `zod` and `@paseo/plugin`. There is no WebView and no iframe, so **a plugin cannot render HTML directly either.**
- Paseo's built-in browser tabs are hosted by the desktop app, so they are not a phone-viewing path.

The usual workarounds are worse than the problem: exporting a PNG by hand for every revision, or serving the file through a tunnel, which means a public unauthenticated URL and another daemon to keep running.

## What this does instead

The plugin keeps the HTML as the source of truth and moves the rendering to the daemon, where a browser already exists:

```
agent writes .html  ->  daemon rasterises with headless Chrome  ->  panel shows the image
```

The image travels back over the connection Paseo already has, so it works anywhere a Paseo client works — including the phone, over the relay.

## Features

- **Sidebar item “Diagrams”** — your diagram library, reachable from anywhere.
- **Workspace panel “Diagrams”** — the library plus any diagram HTML in the current workspace. Also in the Command Center (`⌘K` / `Ctrl+K`) as “Open diagrams”.
- **Smart workspace scanning** — depth-limited, skips `node_modules`, `.git`, `dist`, `build` and friends, and only lists `.html` files that actually contain an `<svg>` or `<canvas>`, so ordinary web pages don't clutter the list.
- **Render presets** — Wide (1600×1000), Card (1200×630), Tall (1200×1600), Square (1400×1400), at 1× or 2×.
- **Open the real thing** — on desktop, one press opens the interactive HTML in the browser on the daemon machine, so hover states and animation still work.
- **Themed and responsive** — colours come from the active Paseo theme, layout adapts to compact clients.

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

Save diagram HTML into `~/Diagrams` and open **Diagrams** in the sidebar.

Point an agent at it directly:

> Draw the service architecture as a self-contained HTML file with inline SVG and save it to `~/Diagrams/architecture.html`.

Anything already sitting in a workspace is picked up too — open the **Diagrams** workspace panel instead of the sidebar item.

### Configuration

| Variable             | Default        | Meaning                                    |
| -------------------- | -------------- | ------------------------------------------ |
| `PASEO_DIAGRAMS_DIR` | `~/Diagrams`   | The library folder the plugin watches.     |
| `CHROME_BIN`         | auto-detected  | Path to Chrome/Chromium on the daemon box. |

These are read by the daemon, so set them where the daemon can see them.

## How it works

Three RPCs, all handled in the plugin's own subprocess beside the daemon:

| RPC               | Does                                                                       |
| ----------------- | -------------------------------------------------------------------------- |
| `diagrams.list`   | Scans the library and, optionally, the workspace directory.                |
| `diagrams.render` | Screenshots one file with headless Chrome, returns a base64 PNG.           |
| `diagrams.open`   | Opens the file in the browser on the daemon machine.                       |

The client surface holds no filesystem access and no browser logic; it renders a list and an `<Image>`.

## Security

Plugin backends run **unsandboxed** on the daemon machine — that is true of every Paseo plugin, so it is worth being explicit about what this one does with that access:

- Every path the client sends is `realpath`-resolved and must resolve **inside the library folder or the current workspace directory**. Anything else is refused, so a panel cannot be talked into reading arbitrary files.
- Only `.html` and `.htm` files are accepted.
- Rendering happens in a throwaway temp directory that is removed afterwards, and Chrome is killed if it exceeds its timeout.
- Rendered images are capped before being sent, so a runaway diagram cannot flood the connection.
- Nothing is uploaded, served, or exposed to a network. The image goes back over your existing Paseo connection.

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
- [diagram-design](https://github.com/cathrynlavery/diagram-design) by Cathryn Lavery — the agent skill this was written to view. It is not required, but it pairs well: point it at `~/Diagrams` and the output shows up here.

## License

MIT © [Ankit Paliwal](https://github.com/itsjustanks)
