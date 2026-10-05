/**
 * Readiness checks: tools on PATH, the tenant's definition, fonts, renders, and whether the
 * Postproxy key is reachable — by name, never by value.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fontsDir, listCampaigns, listTenants, loadTenant, repoRoot, ziggyHome, loadConfig } from "./config.mjs";
import { installedFonts } from "./brand.mjs";
import { keyStatus } from "./secrets.mjs";
import { readManifest, hyperframesArgv } from "./video.mjs";
import { ffmpegBin } from "./assets.mjs";

function probe(bin, args = ["--version"], { timeout = 60000 } = {}) {
  const r = spawnSync(bin, args, { encoding: "utf8", timeout });
  if (r.error) return { ok: false, detail: r.error.code === "ENOENT" ? "not found" : r.error.message };
  return { ok: r.status === 0, detail: ((r.stdout || r.stderr || "").trim().split("\n")[0] || "").slice(0, 80) };
}

export function runDoctor({ tenant: slug, probeHyperframes = true } = {}) {
  const config = loadConfig();
  const checks = [];
  const add = (name, ok, detail, fix) => checks.push({ name, ok, detail, fix: ok ? undefined : fix });

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  add("node", nodeMajor >= 20, `v${process.versions.node}`, "Node.js 20+ is required (fetch, FormData, openAsBlob)");
  const ff = probe(ffmpegBin(), ["-version"]);
  add("ffmpeg", ff.ok, ff.detail, "brew install ffmpeg");
  if (probeHyperframes) {
    const [bin, ...pre] = hyperframesArgv(config.hyperframesVersion);
    const hf = probe(bin, [...pre, "--version"], { timeout: 180000 });
    add("hyperframes", hf.ok, hf.detail, "npm/npx must reach the registry once to cache the HyperFrames CLI");
  }
  const hush = probe(process.env.ZIGGY_HUSH_BIN || "hush", ["--version"]);
  add("hush", hush.ok, hush.detail, "install hush (github.com/turinglabsorg/hush) — keys are stored there");
  add("home", existsSync(ziggyHome()), ziggyHome(), "run: ziggy init");
  add("repo", existsSync(join(repoRoot(config), "tenants")), repoRoot(config), "set ZIGGY_REPO or config.repo to the ziggy checkout (it holds tenants/)");

  const tenants = (() => { try { return listTenants(config); } catch { return []; } })();
  add("tenants", tenants.length > 0, tenants.map((t) => t.slug).join(", ") || "none", "ziggy tenant add <slug> --name … --site https://…");

  const result = { ok: true, checks, tenant: null };
  if (slug) {
    const t = loadTenant(slug, config);
    const tc = [];
    const tadd = (name, ok, detail, fix) => tc.push({ name, ok, detail, fix: ok ? undefined : fix });
    tadd("brand.json", Boolean(t.brand), t.brand ? `${t.brand.name} · ${t.brand.palette?.bg} / ${t.brand.palette?.accent}` : "missing", `ziggy brand extract ${slug}`);
    const fonts = installedFonts(fontsDir(slug));
    tadd("fonts", fonts.length > 0, fonts.map((f) => f.split("/").pop()).join(", ") || "none", `ziggy brand fonts ${slug}`);
    const campaigns = listCampaigns(slug, config);
    tadd("campaigns", campaigns.length > 0, campaigns.join(", ") || "none", `add tenants/${slug}/campaigns/<name>/campaign.json`);
    for (const c of campaigns) {
      const m = readManifest(slug, c);
      tadd(`renders:${c}`, Boolean(m), m ? Object.keys(m.outputs).join(", ") : "not rendered", `ziggy video ${slug} ${c}`);
    }
    const key = keyStatus(slug);
    tadd("postproxy key", key.envPresent || key.hushStored === true, key.envPresent ? "POSTPROXY_API_KEY in env" : key.hushStored ? `hush:${key.secretName}` : key.hushError || `hush has no ${key.secretName}`, `ziggy keys pull ${slug} --send <bitwarden send url>`);
    tadd("autopilot", true, `${t.autopilot?.mode || "draft"}${t.autopilot?.agent === null ? " · no agent" : ""}`);
    result.tenant = { slug, checks: tc };
    result.ok = result.ok && tc.every((c) => c.ok);
  }
  result.ok = result.ok && checks.every((c) => c.ok);
  return result;
}

export function formatDoctor(report) {
  const line = (c) => `  ${c.ok ? "✓" : "✗"} ${c.name.padEnd(16)} ${c.detail || ""}${c.fix ? `\n      → ${c.fix}` : ""}`;
  const out = ["ziggy doctor", ...report.checks.map(line)];
  if (report.tenant) out.push(`\ntenant ${report.tenant.slug}`, ...report.tenant.checks.map(line));
  out.push(report.ok ? "\nok" : "\nsome checks failed");
  return out.join("\n");
}
