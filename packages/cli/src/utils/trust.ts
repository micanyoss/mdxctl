import { spawnSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { runAttached } from "./proc.js";

/** Path to the portless local CA certificate. */
export function caCertPath(): string {
  return join(homedir(), ".portless", "ca.pem");
}

function caFingerprint(): string | undefined {
  try {
    const pem = readFileSync(caCertPath(), "utf8");
    return new X509Certificate(pem).fingerprint.replace(/:/g, "").toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Whether the portless CA is in the OS trust store. Only implemented on
 * Windows (certutil); other platforms return true and let portless handle it.
 * When no CA exists yet, also returns true — portless will create and trust
 * one inline on the first proxy start.
 */
export function caInTrustStore(): boolean {
  if (process.platform !== "win32") {
    return true;
  }
  const fingerprint = caFingerprint();
  if (!fingerprint) {
    return true;
  }
  // certutil prints "Cert Hash(sha1): aa bb ..."; compare whitespace-stripped
  for (const args of [
    ["-store", "Root"],
    ["-store", "-user", "Root"],
  ]) {
    const res = spawnSync("certutil", args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    const store = (res.stdout ?? "").toLowerCase().replace(/\s/g, "");
    if (store.includes(fingerprint)) {
      return true;
    }
  }
  return false;
}

/** Runs `portless trust` attached to the TTY so the OS prompt can be accepted. */
export function runPortlessTrust(portlessBin: string): Promise<number> {
  return runAttached(process.execPath, [portlessBin, "trust"]);
}
