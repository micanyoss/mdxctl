# mdxctl

A CLI for managing and serving MDX docs projects from one place, backed by a
bundled Astro docs-viewer app.

## Repository layout

```
packages/
├── cli/       # the `mdxctl` CLI (TypeScript, published to npm)
└── docs-app/  # the Astro + Tailwind/DaisyUI docs viewer the CLI spawns
```

## Quick start

```bash
pnpm install

# Run the CLI in dev mode (tsx, no build step)
pnpm dev:cli --help

# Develop the docs viewer standalone
pnpm dev:docs

# Build everything
pnpm build
```

Once built, the binary is at `packages/cli/dist/cli.js`:

```bash
node packages/cli/dist/cli.js --help
```

## Commands

| Command            | What it does                                                        |
| ------------------ | ------------------------------------------------------------------- |
| `mdxctl setup`     | Register a project and scaffold `.mdxctl/docs`, `.mdxctl/plans`, and a sample `.mdx` |
| `mdxctl start`     | Serve **every** registered project at **https://mdxctl.localhost**  |
| `mdxctl add`       | Register an existing mdxctl folder                                  |
| `mdxctl remove`    | Unregister a project                                                |
| `mdxctl generate`  | Generate an `llms.txt` for a project's docs                         |

The CLI stores each project's mdxctl folder path in `~/.mdxctl/registry.json`.
The registered folder contains the project's `docs/` and `plans/` subfolders.
Project names must be URL-safe (lowercase letters, digits, `-`, `_`) because
they become the first URL segment.

## Routing

One server serves every registered project:

| URL                                | Page                                        |
| ---------------------------------- | ------------------------------------------- |
| `https://mdxctl.localhost/`        | Index of all registered projects            |
| `https://mdxctl.localhost/<name>`  | That project's `docs/index.mdx`              |
| `.../<name>/<path>`                | Any other `.mdx` in that project's docs     |

`mdxctl start` run inside a project folder (one that *is* a registered mdxctl
folder, contains one, or lives under one) prints the focused URL
`https://mdxctl.localhost/<name>` directly. Pass a name (`mdxctl start docs-app`)
to focus a different project; with nothing to focus it prints the index URL.
When no project is registered at all, the index page shows a click-to-copy
`mdxctl setup` card instead.

## How `start` works

1. Links every registered project's `docs` subfolder into the docs-app at
   `packages/docs-app/.mdxctl/projects/<name>` (Windows junction / POSIX
   symlink), so Astro's content layer always sees docs through constant
   in-root paths and each entry id starts with the project name. The separate
   `plans` folder is intentionally not loaded as docs.
2. Spawns the Astro dev server through [**portless**](https://github.com/vercel-labs/portless)
   (bundled as a dependency). Portless runs a local HTTPS reverse proxy on
   port 443 and routes `https://mdxctl.localhost` to the dev server's
   ephemeral port — no port numbers to remember, HTTP/2 by default.

Use `mdxctl start --no-portless` for a plain `astro dev` server on
`localhost:4321` instead. When portless can't be used (openssl missing,
certificate not trusted, startup failure) `start` warns and falls back to
the plain server automatically.

By default `start` shows a clean TUI: a full-width boot animation while the
dev server starts, then a status card (URL, focused project, folder, project
count). Astro/vite/portless logs are hidden — errors always surface.
`--verbose` (`-v`) shows the raw output.

### First-run requirements (per machine)

- **openssl on PATH** (TLS only, first run only) — portless shells out to it
  to mint its local CA. Windows: `winget install -e --id ShiningLight.OpenSSL.Dev`
  (Git for Windows bundles openssl, but it's not on PowerShell's PATH).
  `mdxctl start` preflights this and prints guidance when missing.
- **One-time CA trust** — on first run Windows shows a certificate security
  prompt; click **Yes**. If you miss it, run `npx portless trust` to retry.
- **Port 443 free** — check for IIS/Skype/Docker if binding fails.
- Safari users: `npx portless hosts sync` (Safari doesn't auto-resolve
  `.localhost` subdomains; Chrome/Firefox/Edge do).

Remove all portless state (CA, trust entry, hosts entries) with
`npx portless clean`.

### Keeping the proxy alive (Node 22.21 WebSocket crash)

Node 22.21.0 broke WebSocket upgrades on `http2.createSecureServer({
allowHTTP1: true })` — the mode portless uses to serve HTTP/1 and HTTP/2 on one
TLS port. Node's HTTP/1 listener calls `server.shouldUpgradeCallback(req)`,
which only exists on `http.Server`, so the first WebSocket handshake throws
`TypeError: server.shouldUpgradeCallback is not a function` inside the proxy
daemon and it exits. In practice: the first docs page renders, Vite's HMR socket
connects, the proxy dies, and every following navigation fails with
`ERR_CONNECTION_REFUSED` even though `mdxctl start` still shows its status card.

`start` handles this in two layers:

- **Shim** — `src/utils/nodeShim.ts` generates
  `~/.mdxctl/node-http2-upgrade-shim.cjs` and injects it into the daemon with
  `NODE_OPTIONS=--require`. It restores the missing method using Node's own
  semantics (`listenerCount("upgrade") > 0`), so portless proxies HMR properly.
  Nothing is installed on Node builds that don't need it, and the daemon is
  started again without the shim if the shimmed environment ever fails.
- **Watchdog** — while the dev server runs, `start` probes the proxy every 5s
  and restarts it (plus re-registers the `mdxctl` route) if it disappears for
  any other reason, printing a one-line note.

The docs-app's content collection reads the `MDXCTL_PROJECTS_PATH` environment
variable, which is set to the in-project links directory before Astro starts.
This keeps Astro's glob loader inside its project root while serving docs
stored in each project's hidden `.mdxctl/docs` directory. The index page reads
`~/.mdxctl/registry.json` directly (override with `MDXCTL_REGISTRY_PATH`) so it
can list registered folders and their real paths.

The viewer ships a custom daisyUI theme (`mdxctl`) — a warm beige take on
cupcake, defined in `packages/docs-app/src/styles/global.css`.

## License

MIT
