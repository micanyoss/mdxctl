import { spawnSync } from "node:child_process";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { join } from "node:path";
import * as p from "@clack/prompts";
import { defineCommand } from "citty";
import pc from "picocolors";
import {
  docsPathOf,
  findProjectForCwd,
  getProject,
  listProjects,
  readRegistry,
  REGISTRY_DIR,
  type ProjectEntry,
} from "../registry.js";
import { BootScreen } from "../utils/bootscreen.js";
import {
  linkProjectsIntoApp,
  resolveAstroBin,
  resolveDocsAppDir,
  resolvePortlessBin,
} from "../utils/paths.js";
import { getFreePort, killPortListener, runServer, withOpenSSLEnv } from "../utils/proc.js";
import { withHttp2UpgradeShim } from "../utils/nodeShim.js";
import { unwrap } from "../utils/prompts.js";
import { projectSlug } from "../utils/slug.js";
import { caCertPath, caInTrustStore, runPortlessTrust } from "../utils/trust.js";
import {
  accent,
  isErrorLine,
  milestoneFor,
  parseReady,
  renderStatusCard,
  type ReadyInfo,
} from "../utils/tui.js";

const PORTLESS_NAME = "mdxctl";
const PORTLESS_URL = `https://${PORTLESS_NAME}.localhost`;
const PLAIN_URL = "http://localhost:4321";

/**
 * Marks that an mdxctl run auto-started the portless proxy daemon. Written
 * before launch so that even a hard kill (terminal closed, double Ctrl+C)
 * lets the next run reclaim the leaked daemon and stop it.
 */
const PROXY_OWNER_MARKER = join(REGISTRY_DIR, "portless-proxy-owned");

/** A non-zero exit within this window counts as a startup failure. */
const STARTUP_FAILURE_MS = 15_000;

/** Whether the expected portless proxy (not merely any listener) is running. */
function proxyRunning(): Promise<boolean> {
  const probe = (port: number, tls: boolean): Promise<boolean> =>
    new Promise((resolvePromise) => {
      const request = (tls ? httpsRequest : httpRequest)(
        {
          hostname: "127.0.0.1",
          port,
          path: "/",
          method: "HEAD",
          timeout: 1500,
          ...(tls ? { rejectUnauthorized: false } : {}),
        },
        (response) => {
          response.resume();
          resolvePromise(response.headers["x-portless"] === "1");
        },
      );
      request.once("error", () => resolvePromise(false));
      request.setTimeout(1500, () => {
        request.destroy();
        resolvePromise(false);
      });
      request.end();
    });
  return probe(443, true).then((ok) => (ok ? true : probe(80, false)));
}

/**
 * Returns why portless can't be used right now, or undefined when it's good
 * to go. May run an interactive `portless trust` retry along the way.
 */
async function portlessUnavailableReason(
  portlessBin: string,
  _proxyAlreadyRunning: boolean,
): Promise<string | undefined> {
  // Trust is the only preflight mdxctl performs. Portless itself owns
  // certificate generation and reports any OpenSSL problem from `proxy start`.
  // Do not reject a valid existing CA merely because this shell cannot resolve
  // an `openssl` executable on PATH.

  // When a CA exists but was never trusted (the OS prompt was dismissed),
  // portless does not retry on its own — offer to do it here.
  if (!caInTrustStore()) {
    if (process.stdout.isTTY) {
      const yes = unwrap(
        await p.confirm({
          message:
            "The local HTTPS certificate isn't trusted on this machine yet. Trust it now? (Windows will show a certificate prompt — click Yes)",
          initialValue: true,
        }),
      );
      if (yes) {
        await runPortlessTrust(portlessBin);
      }
    }
    if (!caInTrustStore()) {
      return `the local HTTPS certificate is not trusted. Run ${accent("npx portless trust")} interactively to fix it.`;
    }
  }

  return undefined;
}

interface LaunchOptions {
  /** Public URL shown on the status card. */
  url: string;
  command: string;
  commandArgs: string[];
  env: NodeJS.ProcessEnv;
}

export default defineCommand({
  meta: {
    name: "start",
    alias: "run",
    description: `Serve every registered project's docs at ${PORTLESS_URL}`,
  },
  args: {
    name: {
      type: "positional",
      description:
        "Project to open (defaults to the project of the current folder)",
      required: false,
    },
    portless: {
      type: "boolean",
      default: true,
      description: `Proxy through portless at ${PORTLESS_URL} (--no-portless for a plain astro dev server)`,
    },
    verbose: {
      type: "boolean",
      alias: "v",
      default: false,
      description: "Show raw portless/astro output",
    },
  },
  async run({ args }) {
    const registry = readRegistry();
    const allProjects = listProjects(registry);

    // Every registered project is served; the focused one only decides which
    // URL the status card points at.
    let focus: ProjectEntry | undefined;
    if (args.name) {
      focus = getProject(args.name, registry);
      if (!focus) {
        console.error(
          pc.red(`Project "${args.name}" is not registered.`) +
            (allProjects.length
              ? "\nRegistered projects: " +
                allProjects.map((proj) => pc.white(proj.name)).join(", ")
              : `\nRun ${accent("mdxctl init")} to register your first docs project.`),
        );
        process.exit(1);
      }
    } else {
      focus = findProjectForCwd();
    }

    const missing: ProjectEntry[] = [];
    const projects = allProjects.filter((project) => {
      const ok = existsSync(project.path) && existsSync(docsPathOf(project));
      if (!ok) missing.push(project);
      return ok;
    });

    const focusName = focus?.name;
    if (focus && missing.some((project) => project.name === focusName)) {
      console.error(
        pc.red(`Docs folder for "${focus.name}" no longer exists:`) +
          `\n  ${docsPathOf(focus)}\n\n` +
          `Create it, or re-register with ${accent(`mdxctl add ${focus.name} --path <dir>`)}.`,
      );
      process.exit(1);
    }

    let docsAppDir: string;
    let astroBin: string;
    try {
      docsAppDir = resolveDocsAppDir();
      astroBin = resolveAstroBin();
    } catch (err) {
      console.error(pc.red((err as Error).message));
      process.exit(1);
    }

    /** `https://mdxctl.localhost/<focused project>` when we know which one. */
    const urlFor = (base: string): string =>
      focus ? `${base}/${projectSlug(focus.name)}` : base;

    /**
     * Launches the dev server with the boot screen + status card (or raw
     * output with --verbose).
     */
    const launch = async (
      options: LaunchOptions,
    ): Promise<{ code: number; elapsedMs: number; interrupted: boolean }> => {
      const boot = new BootScreen();
      let readyInfo: ReadyInfo | undefined;

      if (args.verbose) {
        p.log.step(
          `Serving ${pc.green(String(projects.length))} project(s) at ${accent(options.url)}`,
        );
      } else {
        boot.start();
        boot.setMilestone("Linking docs folders");
      }

      const projectsBase = linkProjectsIntoApp(
        docsAppDir,
        projects.map((project) => ({
          name: project.name,
          docsPath: docsPathOf(project),
        })),
      );
      const env = { ...options.env, MDXCTL_PROJECTS_PATH: projectsBase };

      const run = runServer(options.command, options.commandArgs, {
        cwd: docsAppDir,
        env,
        verbose: args.verbose,
        onLine: (line) => {
          if (args.verbose || readyInfo) return;
          const ready = parseReady(line);
          if (ready) {
            readyInfo = ready;
            boot.stop();
            console.log("");
            console.log(
              renderStatusCard({
                url: options.url,
                project: focus ? { name: focus.name, path: focus.path } : undefined,
                projectCount: projects.length,
                readyIn: ready.readyIn,
              }),
            );
            console.log("");
            if (!focus && existsSync(join(process.cwd(), ".mdxctl"))) {
              console.log(
                pc.dim("  This folder has an unregistered ") +
                  pc.white(".mdxctl") +
                  pc.dim(" folder — register it with ") +
                  accent("mdxctl add"),
              );
              console.log("");
            }
            for (const broken of missing) {
              console.log(
                pc.yellow(`  ! ${broken.name}: docs folder missing (${docsPathOf(broken)})`),
              );
            }
            if (missing.length) console.log("");
            return;
          }
          const milestone = milestoneFor(line);
          if (milestone) boot.setMilestone(milestone);
        },
        passLine: (plain) => isErrorLine(plain),
      });

      let code: number;
      try {
        code = await run.promise;
      } catch (err) {
        p.log.warn(pc.yellow(`Failed to launch: ${(err as Error).message}`));
        code = 1;
      } finally {
        if (boot.running) {
          boot.stop();
          if (!readyInfo && !args.verbose && !run.interrupted()) {
            console.error(pc.red("Dev server stopped before it was ready."));
          }
        }
      }
      return { code, elapsedMs: run.elapsedMs(), interrupted: run.interrupted() };
    };

    // --force: replace any stale dev server holding Astro's singleton lock
    // instead of erroring out.
    const plainLaunch = (): LaunchOptions => ({
      url: urlFor(PLAIN_URL),
      command: process.execPath,
      commandArgs: [astroBin, "dev", "--force"],
      env: { ...process.env },
    });

    if (!args.portless) {
      const res = await launch(plainLaunch());
      process.exitCode = res.code;
      return;
    }

    let portlessBin: string;
    try {
      portlessBin = resolvePortlessBin();
    } catch (err) {
      p.log.warn(pc.yellow((err as Error).message));
      const res = await launch(plainLaunch());
      process.exitCode = res.code;
      return;
    }

    const wasProxyRunning = await proxyRunning();
    const unavailable = await portlessUnavailableReason(portlessBin, wasProxyRunning);
    if (unavailable) {
      p.log.warn(`${pc.yellow("portless unavailable:")} ${unavailable}`);
      const res = await launch(plainLaunch());
      process.exitCode = res.code;
      return;
    }

    // Start/register portless separately from Astro. `portless run` installs
    // its own SIGINT handler and wraps the app in a Windows shell, which can
    // race mdxctl during Ctrl+C. A static alias is the documented mode for a
    // service managed by another process, so mdxctl remains the sole owner of
    // the Astro process tree.
    let proxyOwned = existsSync(PROXY_OWNER_MARKER) || !wasProxyRunning;
    let ownershipClaimed = false;
    let proxyStopAttempted = false;
    let aliasRegistered = false;
    /** Env for the proxy daemon: OpenSSL lookup + the Node WebSocket shim. */
    const proxyEnv = (): NodeJS.ProcessEnv => withHttp2UpgradeShim(withOpenSSLEnv());
    /**
     * Starts the portless daemon. If the shimmed environment is what upset it,
     * retry plain: a proxy that can crash on WebSockets still beats none.
     */
    const startProxyDaemon = (stdio: "inherit" | "ignore"): boolean => {
      const attempt = (env: NodeJS.ProcessEnv) =>
        spawnSync(process.execPath, [portlessBin, "proxy", "start"], {
          stdio,
          timeout: 30_000,
          env,
        });
      const shimmed = attempt(proxyEnv());
      if (!shimmed.error && shimmed.status === 0) return true;
      const plain = attempt(withOpenSSLEnv());
      return !plain.error && plain.status === 0;
    };
    const clearMarker = () => {
      try {
        unlinkSync(PROXY_OWNER_MARKER);
      } catch {
        // already gone
      }
    };
    const stopOwnedProxy = () => {
      if (proxyStopAttempted) return;
      proxyStopAttempted = true;
      try {
        spawnSync(process.execPath, [portlessBin, "proxy", "stop"], {
          stdio: "ignore",
          timeout: 15_000,
        });
      } catch {
        // best effort — the daemon may already be gone
      }
      clearMarker();
    };
    const removeAlias = () => {
      if (!aliasRegistered) return;
      aliasRegistered = false;
      try {
        spawnSync(process.execPath, [portlessBin, "alias", "--remove", PORTLESS_NAME], {
          stdio: "ignore",
          timeout: 10_000,
        });
      } catch {
        // best effort — stale routes are cleaned by portless
      }
    };

    /**
     * Marks this run as the owner of the proxy daemon, so it is stopped again
     * on exit. Safe to call repeatedly (the watchdog claims ownership when it
     * has to restart a daemon somebody else started).
     */
    const claimProxyOwnership = () => {
      proxyOwned = true;
      if (ownershipClaimed) return;
      ownershipClaimed = true;
      try {
        writeFileSync(PROXY_OWNER_MARKER, String(process.pid));
      } catch {
        // non-fatal — cleanup stays best-effort for this run
      }
      process.once("exit", () => {
        removeAlias();
        stopOwnedProxy();
      });
    };

    if (proxyOwned) {
      claimProxyOwnership();
    }

    const appPort = await getFreePort();

    try {
      if (!wasProxyRunning && !startProxyDaemon("inherit")) {
        p.log.warn(pc.yellow("portless could not start; falling back to a plain dev server."));
        const fallback = await launch(plainLaunch());
        process.exitCode = fallback.code;
        return;
      }

      const alias = spawnSync(
        process.execPath,
        [portlessBin, "alias", PORTLESS_NAME, String(appPort), "--force"],
        { stdio: "ignore", timeout: 10_000 },
      );
      if (alias.error || alias.status !== 0) {
        p.log.warn(pc.yellow("portless could not register its route; falling back to a plain dev server."));
        const fallback = await launch(plainLaunch());
        process.exitCode = fallback.code;
        return;
      }
      aliasRegistered = true;

      const registerAlias = (): boolean => {
        const result = spawnSync(
          process.execPath,
          [portlessBin, "alias", PORTLESS_NAME, String(appPort), "--force"],
          { stdio: "ignore", timeout: 10_000 },
        );
        const ok = !result.error && result.status === 0;
        if (ok) aliasRegistered = true;
        return ok;
      };

      // The daemon lives in its own process and can die under us — a crash, a
      // `portless proxy stop` from another shell, or another mdxctl run
      // shutting down. Whatever the reason, the URL on the status card would
      // start refusing connections while this dev server keeps running, so
      // bring the proxy (and this run's route) back instead.
      let healing = false;
      const watchdog = setInterval(() => {
        if (healing) return;
        healing = true;
        void (async () => {
          try {
            if (await proxyRunning()) return;
            if (!startProxyDaemon("ignore")) return;
            claimProxyOwnership();
            if (!registerAlias()) return;
            if (!args.verbose) {
              console.log(
                pc.dim("  · portless proxy restarted — ") +
                  accent(urlFor(PORTLESS_URL)) +
                  pc.dim(" is reachable again"),
              );
              console.log("");
            }
          } finally {
            healing = false;
          }
        })();
      }, 5_000);
      watchdog.unref?.();

      const caPath = caCertPath();
      let res: { code: number; elapsedMs: number; interrupted: boolean };
      try {
        res = await launch({
          url: urlFor(PORTLESS_URL),
          command: process.execPath,
          commandArgs: [astroBin, "dev", "--port", String(appPort), "--host", "127.0.0.1", "--force"],
          env: {
            ...process.env,
            PORT: String(appPort),
            HOST: "127.0.0.1",
            PORTLESS_URL,
            ...(existsSync(caPath) ? { NODE_EXTRA_CA_CERTS: caPath } : {}),
            __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: ".localhost",
          },
        });
      } finally {
        clearInterval(watchdog);
      }
      process.exitCode = res.interrupted ? 130 : res.code;
    } finally {
      removeAlias();
      killPortListener(appPort);
      if (proxyOwned) {
        if (await proxyRunning()) {
          stopOwnedProxy();
          if (await proxyRunning()) {
            p.log.warn(
              pc.yellow("Could not stop the portless proxy (port 443 is still in use).") +
                `\nRun ${accent("npx portless proxy stop")} to free it.`,
            );
          }
        } else {
          proxyStopAttempted = true;
          clearMarker();
        }
      }
    }
  },
});
