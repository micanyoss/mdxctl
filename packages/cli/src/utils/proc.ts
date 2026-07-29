import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawn, spawnSync, type SpawnOptions } from "node:child_process";
import { createServer } from "node:net";

/**
 * Returns an environment in which portless can find OpenSSL on Windows.
 * Winget's ShiningLight package and Git for Windows commonly install
 * `openssl.exe` outside the user's current PATH, while portless invokes it
 * by name with spawnSync("openssl").
 */
export function withOpenSSLEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (process.platform !== "win32") return { ...env };

  const pathEntries = (env.Path ?? env.PATH ?? "").split(";").filter(Boolean);
  const candidates = [
    env.OPENSSL_BIN,
    env.ProgramFiles ? join(env.ProgramFiles, "OpenSSL-Win64", "bin") : undefined,
    env.ProgramFiles ? join(env.ProgramFiles, "OpenSSL", "bin") : undefined,
    env["ProgramFiles(x86)"]
      ? join(env["ProgramFiles(x86)"], "OpenSSL-Win32", "bin")
      : undefined,
    env.ProgramFiles ? join(env.ProgramFiles, "Git", "mingw64", "bin") : undefined,
    env.ProgramFiles ? join(env.ProgramFiles, "Git", "usr", "bin") : undefined,
    ...pathEntries,
  ].filter((value): value is string => Boolean(value));

  let opensslDir: string | undefined;
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "openssl.exe"))) {
      opensslDir = candidate;
      break;
    }
  }

  if (!opensslDir) {
    const found = spawnSync("where.exe", ["openssl"], {
      encoding: "utf8",
      windowsHide: true,
    });
    const executable = (found.stdout ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (executable) opensslDir = dirname(executable);
  }

  if (!opensslDir) return { ...env };

  const nextPath = [opensslDir, ...pathEntries.filter((entry) => entry !== opensslDir)].join(";");
  const next: NodeJS.ProcessEnv = { ...env, PATH: nextPath, Path: nextPath };
  if (!next.OPENSSL_CONF) {
    const configCandidates = [
      join(opensslDir, "openssl.cnf"),
      join(opensslDir, "cnf", "openssl.cnf"),
      join(dirname(opensslDir), "ssl", "openssl.cnf"),
    ];
    const config = configCandidates.find((candidate) => existsSync(candidate));
    if (config) next.OPENSSL_CONF = config;
  }
  return next;
}

/** portless shells out to a system openssl to generate its local CA. */
export function opensslAvailable(): boolean {
  try {
    const res = spawnSync("openssl", ["version"], { stdio: "ignore" });
    return !res.error && res.status === 0;
  } catch {
    return false;
  }
}

/** Picks an ephemeral free port on 127.0.0.1. */
export function getFreePort(): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "object" && address !== null) {
        const { port } = address;
        server.close(() => resolvePromise(port));
      } else {
        server.close(() => reject(new Error("Could not allocate a free port")));
      }
    });
  });
}

/** Runs a command attached to the current stdio; resolves with its exit code. */
export function runAttached(
  command: string,
  args: string[],
  options: SpawnOptions = {},
): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("close", (code) => resolvePromise(code ?? 1));
  });
}

/**
 * Best-effort: kills whatever is LISTENING on the given TCP port. Used to
 * reap an orphaned dev server that survived the child-tree kill (a wrapper
 * can exit on its own Ctrl+C before our taskkill runs, orphaning its
 * grandchild while it keeps holding the port).
 */
export function killPortListener(port: number): void {
  try {
    if (process.platform === "win32") {
      const out = spawnSync("netstat", ["-ano"], { encoding: "utf8" }).stdout ?? "";
      const pids = new Set<number>();
      for (const line of out.split("\n")) {
        // TCP    127.0.0.1:49320    0.0.0.0:0    LISTENING    41584
        const match = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/);
        if (match && Number(match[1]) === port) {
          pids.add(Number(match[2]));
        }
      }
      for (const pid of pids) {
        spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
          stdio: "ignore",
        });
      }
    } else {
      const out =
        spawnSync("lsof", ["-ti", `tcp:${port}`], { encoding: "utf8" }).stdout ?? "";
      for (const pid of out.split("\n").map((s) => s.trim()).filter(Boolean)) {
        try {
          process.kill(Number(pid));
        } catch {
          // already gone
        }
      }
    }
  } catch {
    // best effort
  }
}

export interface ServerRunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Show all child output unfiltered. */
  verbose?: boolean;
  /** Called with every ANSI-stripped line from both streams. */
  onLine?: (line: string) => void;
  /**
   * In non-verbose mode, decides which lines reach the terminal.
   * Default: none (all child output hidden).
   */
  passLine?: (plainLine: string) => boolean;
}

export interface ServerRun {
  /** Resolves with the child's exit code (130 when stopped via Ctrl+C/SIGTERM). */
  promise: Promise<number>;
  /** Milliseconds since the child was spawned. */
  elapsedMs: () => number;
  /** True when the child died because the user stopped it (SIGINT/SIGTERM), not a crash. */
  interrupted: () => boolean;
}

/**
 * Runs a long-lived dev server: pipes output through a line filter, and
 * reaps the whole child process tree on exit so no orphaned dev servers
 * hold ports or Astro's singleton lock.
 */
export function runServer(
  command: string,
  args: string[],
  options: ServerRunOptions = {},
): ServerRun {
  const startedAt = Date.now();
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  // --- output handling --------------------------------------------------
  const ANSI_RE = /\x1b\[[0-9;]*m/g;
  const makeLineHandler =
    (stream: NodeJS.WriteStream) => {
      let carry = "";
      let lastWasBlank = false;
      return (data: Buffer) => {
        const text = carry + data.toString("utf8");
        const lines = text.split("\n");
        carry = lines.pop() ?? "";
        for (const line of lines) {
          const plain = line.replace(ANSI_RE, "");
          options.onLine?.(plain);
          if (!options.verbose && !options.passLine?.(plain)) {
            continue;
          }
          // collapse consecutive blank lines (filtering leaves gaps)
          const blank = plain.trim() === "";
          if (!options.verbose && blank && lastWasBlank) {
            continue;
          }
          lastWasBlank = blank;
          stream.write(line + "\n");
        }
      };
    };
  child.stdout.on("data", makeLineHandler(process.stdout));
  child.stderr.on("data", makeLineHandler(process.stderr));

  // --- child tree reaping -------------------------------------------------
  const killTree = () => {
    try {
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
        });
      } else {
        child.kill("SIGTERM");
      }
    } catch {
      // already dead
    }
  };
  let interrupted = false;
  let sigints = 0;
  let forceShutdownTimer: NodeJS.Timeout | undefined;
  const releaseStdio = () => {
    // Drop our pipe handles: an orphaned grandchild may keep its inherited
    // copies open after the tree kill, and open pipes would both delay the
    // "close" event and keep this process's event loop alive.
    child.stdout.destroy();
    child.stderr.destroy();
  };
  const forceShutdown = () => {
    forceShutdownTimer = undefined;
    killTree();
    releaseStdio();
  };
  const onSigint = () => {
    interrupted = true;
    sigints += 1;
    if (sigints > 1) {
      forceShutdown();
      process.exit(130);
    }
    // portless installs its own SIGINT handler and needs the first event to
    // reap its shell child and unregister its route. Do not race it with
    // taskkill; force the tree only if it does not exit promptly.
    forceShutdownTimer = setTimeout(forceShutdown, 2_000);
    forceShutdownTimer.unref();
  };
  const onSigterm = () => {
    interrupted = true;
    forceShutdown();
  };
  const onExit = () => killTree();
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  process.on("exit", onExit);

  const promise = new Promise<number>((resolvePromise, reject) => {
    child.on("error", reject);
    let settled = false;
    const settle = (code: number | null) => {
      if (settled) return;
      settled = true;
      if (forceShutdownTimer) {
        clearTimeout(forceShutdownTimer);
        forceShutdownTimer = undefined;
      }
      if (interrupted) releaseStdio();
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
      process.removeListener("exit", onExit);
      resolvePromise(interrupted ? 130 : (code ?? 1));
    };
    child.once("exit", (code) => {
      // When interrupted, don't wait for stdio to drain: orphaned
      // grandchildren can hold the pipes open after the tree kill.
      if (interrupted) settle(code);
    });
    // Otherwise wait for "close" so buffered output is flushed first.
    child.once("close", (code) => settle(code));
  });

  return {
    promise,
    elapsedMs: () => Date.now() - startedAt,
    interrupted: () => interrupted,
  };
}
