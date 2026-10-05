/**
 * The clock behind autopilot: a launchd agent (macOS) or a crontab line (Linux) that runs
 * `ziggy autopilot <slug> --quiet` every N seconds. The key never enters the schedule: the
 * autopilot wraps itself in `hush run` at start, and `hush run` only needs the local age identity
 * (Bitwarden is for depositing, not for using), so unattended runs work without a session.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { workDir } from "./config.mjs";

export function label(slug) {
  return `org.turinglabs.ziggy.${slug}`;
}

export function plistPath(slug) {
  return join(homedir(), "Library", "LaunchAgents", `${label(slug)}.plist`);
}

function which(bin) {
  const r = spawnSync("sh", ["-c", `command -v ${bin}`], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

export function plistFor({ slug, interval, ziggyBin, hushBin, logFile, extraPath }) {
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${esc(label(slug))}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${esc(ziggyBin)}</string>
    <string>autopilot</string>
    <string>${esc(slug)}</string>
    <string>--quiet</string>
  </array>
  <key>StartInterval</key><integer>${interval}</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${esc(logFile)}</string>
  <key>StandardErrorPath</key><string>${esc(logFile)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${esc(extraPath)}</string>${hushBin ? `
    <key>ZIGGY_HUSH_BIN</key><string>${esc(hushBin)}</string>` : ""}
    <key>HOME</key><string>${esc(homedir())}</string>
  </dict>
</dict>
</plist>
`;
}

export function cronLineFor({ slug, interval, ziggyBin, logFile }) {
  const minutes = Math.max(1, Math.round(interval / 60));
  const spec = minutes >= 60 ? `0 */${Math.max(1, Math.round(minutes / 60))} * * *` : `*/${minutes} * * * *`;
  return `${spec} ${ziggyBin} autopilot ${slug} --quiet >> ${logFile} 2>&1`;
}

export function installWatch({ slug, interval = 900, ziggyBin = which("ziggy"), dryRun = false }) {
  if (!ziggyBin) throw new Error("ziggy is not on PATH — run skill/install.sh first, or pass --bin <path>");
  const logFile = join(workDir(slug, "inbox"), "autopilot.log");
  const hushBin = which("hush");
  const extraPath = [join(homedir(), ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].join(":");
  if (platform() === "darwin") {
    const plist = plistFor({ slug, interval, ziggyBin, hushBin, logFile, extraPath });
    const path = plistPath(slug);
    if (dryRun) return { kind: "launchd", path, plist, loaded: false };
    mkdirSync(join(homedir(), "Library", "LaunchAgents"), { recursive: true });
    if (existsSync(path)) spawnSync("launchctl", ["bootout", `gui/${process.getuid()}`, path], { encoding: "utf8" });
    writeFileSync(path, plist);
    const r = spawnSync("launchctl", ["bootstrap", `gui/${process.getuid()}`, path], { encoding: "utf8" });
    return { kind: "launchd", path, loaded: r.status === 0, error: r.status === 0 ? null : (r.stderr || r.stdout || "").trim() };
  }
  const line = cronLineFor({ slug, interval, ziggyBin, logFile });
  if (dryRun) return { kind: "cron", line, loaded: false };
  const current = spawnSync("crontab", ["-l"], { encoding: "utf8" });
  const existing = current.status === 0 ? current.stdout.split("\n").filter((l) => !l.includes(`autopilot ${slug} `)) : [];
  const r = spawnSync("crontab", ["-"], { input: [...existing, line, ""].join("\n"), encoding: "utf8" });
  return { kind: "cron", line, loaded: r.status === 0, error: r.status === 0 ? null : (r.stderr || "").trim() };
}

export function uninstallWatch({ slug }) {
  if (platform() === "darwin") {
    const path = plistPath(slug);
    if (!existsSync(path)) return { kind: "launchd", removed: false };
    spawnSync("launchctl", ["bootout", `gui/${process.getuid()}`, path], { encoding: "utf8" });
    unlinkSync(path);
    return { kind: "launchd", removed: true, path };
  }
  const current = spawnSync("crontab", ["-l"], { encoding: "utf8" });
  if (current.status !== 0) return { kind: "cron", removed: false };
  const kept = current.stdout.split("\n").filter((l) => !l.includes(`autopilot ${slug} `));
  spawnSync("crontab", ["-"], { input: kept.join("\n") + "\n", encoding: "utf8" });
  return { kind: "cron", removed: true };
}

export function watchStatus({ slug }) {
  const logFile = join(workDir(slug, "inbox"), "autopilot.log");
  const runsFile = join(workDir(slug, "inbox"), "runs.jsonl");
  const runs = existsSync(runsFile) ? readFileSync(runsFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  if (platform() === "darwin") {
    const path = plistPath(slug);
    const r = spawnSync("launchctl", ["print", `gui/${process.getuid()}/${label(slug)}`], { encoding: "utf8" });
    return { kind: "launchd", installed: existsSync(path), loaded: r.status === 0, path, logFile, lastRun: runs.at(-1) || null, runs: runs.length };
  }
  const current = spawnSync("crontab", ["-l"], { encoding: "utf8" });
  const installed = current.status === 0 && current.stdout.includes(`autopilot ${slug} `);
  return { kind: "cron", installed, loaded: installed, logFile, lastRun: runs.at(-1) || null, runs: runs.length };
}
