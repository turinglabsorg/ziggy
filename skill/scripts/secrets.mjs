/**
 * Keys never enter Ziggy. They live in hush (github.com/turinglabsorg/hush) and reach the
 * process that needs them as an environment variable, through `hush run --redact`.
 *
 * Resolution order for a tenant's Postproxy key:
 *   1. POSTPROXY_API_KEY already in the environment  → use it (we are inside `hush run`, or the
 *      user exported it deliberately).
 *   2. hush holds `ziggy.<slug>.postproxy`            → re-exec this CLI under `hush run`.
 *   3. neither                                         → refuse, and say how to deposit the key
 *      (Bitwarden Send → `ziggy keys pull <slug> --send <url>`).
 *
 * This module never reads a value: `hush list --json` returns metadata only, and the child
 * command is the only place the variable exists.
 */
import { spawnSync } from "node:child_process";
import { postproxySecretName } from "./config.mjs";

export const KEY_ENV = "POSTPROXY_API_KEY";

export function hushBin() {
  return process.env.ZIGGY_HUSH_BIN || "hush";
}

/**
 * Binary used to re-launch the CLI as hush's child. Defaults to "node" (resolved through the
 * child's PATH): process.execPath can point at a node that only exists in the caller's
 * filesystem view (e.g. a container sharing the user's home), where the child would not start.
 */
export function nodeBin() {
  return process.env.ZIGGY_NODE_BIN || "node";
}

/** Names hush holds. `{ ok:false }` when hush is missing/locked — never read that as "absent". */
export function hushNames() {
  const bin = hushBin();
  const result = spawnSync(bin, ["list", "--json"], { encoding: "utf8" });
  if (result.error) {
    return {
      ok: false,
      names: [],
      error: result.error.code === "ENOENT" ? `hush is not installed (${bin})` : `hush could not be started: ${result.error.message}`,
    };
  }
  if (result.status !== 0) {
    return { ok: false, names: [], error: (result.stderr || "").trim() || `hush list exited ${result.status}` };
  }
  try {
    const parsed = JSON.parse(result.stdout);
    const items = Array.isArray(parsed) ? parsed : parsed.secrets || [];
    return { ok: true, names: items.map((m) => (typeof m === "string" ? m : m.name)).filter(Boolean) };
  } catch {
    return { ok: false, names: [], error: "hush list did not return the JSON this expects" };
  }
}

export function keyStatus(slug) {
  const name = postproxySecretName(slug);
  const inEnv = Boolean(process.env[KEY_ENV]);
  const hush = hushNames();
  return {
    tenant: slug,
    secretName: name,
    envPresent: inEnv,
    hushAvailable: hush.ok,
    hushStored: hush.ok ? hush.names.includes(name) : null,
    hushError: hush.ok ? null : hush.error,
  };
}

/** `ziggy keys pull <slug> --send <url>` → `hush pull --name ziggy.<slug>.postproxy --send <url> --json`. */
export function pullKey(slug, { send, passwordEnv, email, codeCmd } = {}) {
  const args = ["pull", "--name", postproxySecretName(slug), "--json"];
  if (send) args.push("--send", send);
  if (passwordEnv) args.push("--passwordenv", passwordEnv);
  if (email) args.push("--email", email);
  if (codeCmd) args.push("--code-cmd", codeCmd);
  const result = spawnSync(hushBin(), args, { encoding: "utf8" });
  if (result.error) throw new Error(result.error.code === "ENOENT" ? `hush is not installed (${hushBin()})` : result.error.message);
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || "").trim() || `hush pull exited ${result.status}`);
  return (result.stdout || "").trim();
}

/**
 * Run `argv` (a ziggy sub-command) with the tenant's key injected by hush.
 * `self` is the absolute path of the CLI entry (index.js). Output is redacted by hush.
 */
export function runUnderHush(slug, self, argv, { stdio = "inherit" } = {}) {
  const args = ["run", "--name", postproxySecretName(slug), "--env", KEY_ENV, "--redact", "--", nodeBin(), self, ...argv];
  const result = spawnSync(hushBin(), args, { stdio, encoding: "utf8" });
  if (result.error) throw new Error(result.error.code === "ENOENT" ? `hush is not installed (${hushBin()})` : result.error.message);
  return result;
}

/** Decide how a key-needing command proceeds. Pure; the caller performs the action. */
export function keyPlan(slug, { noHush = false } = {}) {
  if (process.env[KEY_ENV]) return { mode: "env" };
  if (noHush) return { mode: "missing", reason: `${KEY_ENV} is not set and --no-hush was given` };
  const status = keyStatus(slug);
  if (status.hushAvailable && status.hushStored) return { mode: "hush", secretName: status.secretName };
  if (!status.hushAvailable) {
    return { mode: "missing", reason: `${KEY_ENV} is not set and ${status.hushError}. Export the key or install hush.` };
  }
  return {
    mode: "missing",
    reason:
      `${KEY_ENV} is not set and hush has no secret named ${status.secretName}. ` +
      `Share the key as a Bitwarden Send and run: ziggy keys pull ${slug} --send <url>`,
  };
}
