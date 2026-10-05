#!/usr/bin/env node

/**
 * ziggy — per-tenant social media manager.
 *
 *   brand → assets → videos (HyperFrames) → posts (Postproxy) → inbox → autopilot
 *
 * Output goes to stdout for the agent to read; `--json` on most commands prints machine-readable
 * results. Secrets never pass through here: see scripts/secrets.mjs.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertSlug, configPath, listCampaigns, listTenants, loadCampaign, loadConfig, loadTenant, readPostLog, saveBrand, saveCampaign, saveConfig, saveTenant, tenantDir, ziggyHome, fontsDir, workDir } from "./scripts/config.mjs";
import { downloadFonts, extractBrand, installedFonts } from "./scripts/brand.mjs";
import { produceAssets } from "./scripts/assets.mjs";
import { produce, resolveVariants, scaffold, check as hfCheck, listTemplates } from "./scripts/video.mjs";
import { KEY_ENV, keyPlan, keyStatus, pullKey, runUnderHush } from "./scripts/secrets.mjs";
import { createClient, summarizePost, postPermalinks } from "./scripts/postproxy.mjs";
import { POST_KINDS, awaitPosts, buildRequest, publishCampaign, publishDrafts } from "./scripts/publish.mjs";
import { pullInbox, pullStats, reply, hide, dm, readActions } from "./scripts/inbox.mjs";
import { runAutopilot, readQueue, policyOf } from "./scripts/autopilot.mjs";
import { installWatch, uninstallWatch, watchStatus } from "./scripts/watch.mjs";
import { formatDoctor, runDoctor } from "./scripts/doctor.mjs";

const SELF = fileURLToPath(import.meta.url);
const args = process.argv.slice(2);
const command = args[0] || "help";

function flag(name, fallback) {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  const v = args[i + 1];
  if (v === undefined || v.startsWith("--")) return true;
  return v;
}
const has = (name) => args.includes(name);
const json = has("--json");
const quiet = has("--quiet");
const positional = () => {
  const out = [];
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith("--")) { const v = args[i + 1]; if (v !== undefined && !v.startsWith("--") && !["--json", "--quiet", "--live", "--dry-run", "--force", "--render", "--no-hush", "--install", "--uninstall", "--status", "--feed-video", "--no-dms", "--probe", "--skip-check", "--watch"].includes(args[i])) i++; continue; }
    out.push(args[i]);
  }
  return out;
};
// progress lines go to stderr under --json so stdout stays machine-readable
const say = (s) => { if (quiet) return; if (json) console.error(s); else console.log(s); };
const out = (data, text) => { if (json) console.log(JSON.stringify(data, null, 2)); else say(typeof text === "function" ? text(data) : text ?? JSON.stringify(data, null, 2)); };
const fail = (message, code = 1) => { console.error(`ziggy: ${message}`); process.exit(code); };

function help() {
  console.log(`ziggy — per-tenant social media manager (brand → HyperFrames videos → Postproxy → inbox → autopilot)

Setup
  ziggy init [--repo <path>]                       create ~/.ziggy, point it at this checkout (holds tenants/)
  ziggy doctor [<tenant>] [--json] [--no-probe]    tools, repo, tenant readiness, key reachability (by name)

Tenants (definitions live in <repo>/tenants/<slug>/, work in ~/.ziggy/tenants/<slug>/)
  ziggy tenants [--json]
  ziggy tenant add <slug> --name "…" --site https://… [--lang en]
  ziggy tenant show <slug> [--json]
  ziggy brand extract <slug> [--force] [--json]    site → brand.json (palette, fonts, wordmark, mark, tagline)
  ziggy brand fonts <slug>                         download the brand's Google families (woff2) for rendering
  ziggy assets <slug> [--json]                     profile mark 1000/400 + X header 1500×500 (+@2x)

Campaigns (tenants/<slug>/campaigns/<name>/campaign.json)
  ziggy campaigns <slug>
  ziggy campaign add <slug> <name> [--template teaser]
  ziggy copy <slug> <name> [--json]                show + validate the per-platform copy
  ziggy video <slug> <name> [--variants reel,x,post] [--quality high] [--dry-run] [--skip-check]
                                                    scaffold HyperFrames projects, check, render, capture stills
  ziggy post <slug> <name> [--live] [--at <ISO>] [--only twitter,instagram_reel] [--dry-run] [--watch]
                                                    create the posts as DRAFTS (default) or publish/schedule
  ziggy publish <slug> <postId…> [--watch]          publish reviewed drafts
  ziggy status <slug> [<postId…>] [--json]          post status + permalinks (defaults to the tenant's log)

Inbox & engagement
  ziggy profiles <slug> [--json]
  ziggy inbox <slug> [--all] [--no-dms] [--json]    new comments on our posts + inbound DM threads
  ziggy stats <slug> [--json]                       per-post and per-profile engagement
  ziggy reply <slug> <postId> <commentId> --text "…" [--profile prof_…]
  ziggy hide <slug> <postId> <commentId> [--profile prof_…]
  ziggy dm <slug> <chatId> --text "…"
  ziggy autopilot <slug> [--dry-run] [--json]       answer the inbox per the tenant playbook + policy
  ziggy queue <slug> [--json]                       what autopilot left for a human
  ziggy watch <slug> --install [--interval 900] | --uninstall | --status
                                                    schedule autopilot (launchd on macOS, cron elsewhere)

Keys (hush — never pasted, never printed)
  ziggy keys status <slug>
  ziggy keys pull <slug> --send <bitwarden-send-url> [--passwordenv VAR]
  ziggy keys run <slug> -- <ziggy args…>            run any command with the tenant's key injected

Any command that needs the key (post, publish, status, profiles, inbox, stats, reply, hide, dm,
autopilot) wraps itself in \`hush run\` when ${KEY_ENV} is not already set.`);
}

/* ── key-needing commands re-exec under hush ─────────────────────────────── */

const NEEDS_KEY = new Set(["post", "publish", "status", "profiles", "inbox", "stats", "reply", "hide", "dm", "autopilot"]);

function ensureKey(slug) {
  const plan = keyPlan(slug, { noHush: has("--no-hush") });
  if (plan.mode === "env") return;
  if (plan.mode === "hush") {
    const r = runUnderHush(slug, SELF, [...args, "--no-hush"]);
    process.exit(r.status ?? 1);
  }
  fail(plan.reason, 2);
}

/* ── commands ─────────────────────────────────────────────────────────────── */

async function main() {
  const pos = positional();
  switch (command) {
    case "help": case "--help": case "-h": return help();

    case "init": {
      const repo = flag("--repo") || resolve(dirname(SELF), "..");
      const path = saveConfig({ ...loadConfig(), repo: resolve(String(repo)) });
      mkdirSync(join(ziggyHome(), "tenants"), { recursive: true });
      return out({ config: path, repo: resolve(String(repo)) }, `wrote ${path}\nrepo: ${resolve(String(repo))}`);
    }

    case "doctor": {
      const report = runDoctor({ tenant: pos[0], probeHyperframes: !has("--no-probe") });
      out(report, formatDoctor);
      process.exit(report.ok ? 0 : 1);
    }

    case "tenants": {
      const list = listTenants();
      return out(list.map((t) => ({ slug: t.slug, name: t.name, site: t.site, campaigns: listCampaigns(t.slug) })), (d) => d.map((t) => `${t.slug.padEnd(14)} ${t.name}  ${t.site}  [${t.campaigns.join(", ") || "no campaigns"}]`).join("\n") || "(no tenants)");
    }

    case "tenant": {
      const [sub, slug] = pos;
      if (sub === "add") {
        assertSlug(slug);
        const name = flag("--name"), site = flag("--site");
        if (!name || !site || name === true || site === true) fail("tenant add needs --name and --site");
        const dir = saveTenant(slug, { name, site: new URL(site).toString(), language: flag("--lang", "en"), postproxy: {}, autopilot: { mode: "draft", dms: false, skipAuthors: [] } });
        writeFileSync(join(dir, "playbook.md"), defaultPlaybook(name));
        return out({ slug, dir }, `created ${dir}\nnext: ziggy brand extract ${slug} && ziggy brand fonts ${slug}`);
      }
      if (sub === "show") {
        const t = loadTenant(slug);
        return out({ ...t, campaigns: listCampaigns(slug) }, (d) => `${d.slug}: ${d.name} · ${d.site} · ${d.language}\nbrand: ${d.brand ? `${d.brand.name} · bg ${d.brand.palette.bg} · accent ${d.brand.palette.accent} · ${d.brand.fonts?.display?.family}` : "none"}\ncampaigns: ${d.campaigns.join(", ") || "none"}\nautopilot: ${JSON.stringify(policyOf(d))}`);
      }
      fail("usage: ziggy tenant add|show <slug>");
      break;
    }

    case "brand": {
      const [sub, slug] = pos;
      const t = loadTenant(slug);
      if (sub === "extract") {
        if (t.brand && !has("--force")) fail(`${slug} already has brand.json — pass --force to overwrite`);
        const brand = await extractBrand(t.site);
        const file = saveBrand(slug, brand);
        return out({ file, brand }, `wrote ${file}\n${brand.name} · ${brand.palette.bg} / ${brand.palette.fg} / accent ${brand.palette.accent}\nfonts: ${["display", "text", "mono"].map((r) => brand.fonts[r]?.family || "—").join(" · ")}\nwordmark: ${brand.wordmark.parts.map((p) => `${p.text}(${p.weight})`).join(" ")}\nmark: ${brand.mark ? brand.mark.source : "none"}\nreview the file, then: ziggy brand fonts ${slug}`);
      }
      if (sub === "fonts") {
        if (!t.brand) fail(`no brand.json — run: ziggy brand extract ${slug}`);
        const files = await downloadFonts(t.brand, fontsDir(slug));
        return out(files, (d) => Object.entries(d).map(([f, p]) => `${f.padEnd(14)} ${p}`).join("\n"));
      }
      fail("usage: ziggy brand extract|fonts <slug>");
      break;
    }

    case "assets": {
      const t = loadTenant(pos[0]);
      if (!t.brand) fail(`no brand.json — run: ziggy brand extract ${t.slug}`);
      if (!installedFonts(fontsDir(t.slug)).length) fail(`no fonts — run: ziggy brand fonts ${t.slug}`);
      const r = produceAssets(t, { version: loadConfig().hyperframesVersion, log: say });
      return out(r, (d) => Object.entries(d).map(([k, v]) => `${k.padEnd(12)} ${v}`).join("\n"));
    }

    case "campaigns": {
      const slug = pos[0];
      loadTenant(slug);
      return out(listCampaigns(slug), (d) => d.join("\n") || "(no campaigns)");
    }

    case "campaign": {
      const [sub, slug, name] = pos;
      if (sub !== "add") fail("usage: ziggy campaign add <slug> <name> [--template teaser]");
      const t = loadTenant(slug);
      if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(name || "")) fail("campaign name: lowercase letters, digits, dashes");
      const template = flag("--template", "teaser");
      if (!listTemplates().includes(template)) fail(`unknown template ${template}; known: ${listTemplates().join(", ")}`);
      const host = new URL(t.site).hostname;
      const dir = saveCampaign(slug, name, {
        template, language: t.language || "en", duration: 7.5,
        intent: `First teaser for ${t.name}.`,
        copy: { teaser: "Someone is keeping watch.", tagline: t.brand?.tagline || "", url: host },
        audio: { bed: "ambient", volume: 0.7 },
        posts: {
          twitter: { body: `${t.name} is live.\n${t.brand?.tagline || ""}\n${host}`.trim(), media: "x" },
          instagram_reel: { body: `${t.name} is live.\n\n${t.brand?.tagline || ""}\n\n${host} · link in bio`, media: "reel", cover: true, first_comment: "" },
          instagram_post: { body: `${t.name} is live.\n\n${t.brand?.tagline || ""}\n\n${host} · link in bio`, media: "post-still", alt_text: `${t.name} wordmark on a dark background.` },
        },
      });
      return out({ dir }, `created ${dir}/campaign.json — edit the copy, then: ziggy video ${slug} ${name}`);
    }

    case "copy": {
      const [slug, name] = pos;
      const c = loadCampaign(slug, name);
      const rows = Object.entries(c.posts || {}).map(([kind, spec]) => ({ kind, enabled: spec.enabled !== false, chars: (spec.body || "").length, limit: POST_KINDS[kind]?.limits.chars || null, media: spec.media, body: spec.body }));
      return out(rows, (d) => d.map((r) => `── ${r.kind}${r.enabled ? "" : " (disabled)"} · ${r.chars}${r.limit ? `/${r.limit}` : ""} chars · media ${r.media}${r.limit && r.chars > r.limit ? "  ✗ too long" : ""}\n${r.body}\n`).join("\n"));
    }

    case "video": {
      const [slug, name] = pos;
      const t = loadTenant(slug);
      const c = loadCampaign(slug, name);
      if (!installedFonts(fontsDir(slug)).length) fail(`no fonts — run: ziggy brand fonts ${slug}`);
      const variants = resolveVariants(c, flag("--variants") && flag("--variants") !== true ? String(flag("--variants")).split(",") : null);
      const manifest = produce({ tenant: t, campaign: c, variants, quality: flag("--quality", "high"), version: loadConfig().hyperframesVersion, log: say, skipCheck: has("--skip-check"), dryRun: has("--dry-run") });
      return out(manifest, (m) => Object.entries(m.outputs).map(([v, o]) => `${v.padEnd(6)} ${o.video || o.project}${o.still ? `\n       still ${o.still}` : ""}`).join("\n"));
    }

    case "keys": {
      const [sub, slug] = pos;
      assertSlug(slug);
      if (sub === "status") return out(keyStatus(slug), (s) => `${s.secretName}: ${s.envPresent ? "in env" : s.hushStored ? "stored in hush" : s.hushError ? `hush unavailable (${s.hushError})` : "not stored"}`);
      if (sub === "pull") {
        const send = flag("--send");
        if (!send || send === true) fail("keys pull needs --send <bitwarden send url>");
        const res = pullKey(slug, { send, passwordEnv: flag("--passwordenv"), email: flag("--email"), codeCmd: flag("--code-cmd") });
        return console.log(res);
      }
      if (sub === "run") {
        const sep = args.indexOf("--");
        if (sep === -1) fail("usage: ziggy keys run <slug> -- <ziggy args…>");
        const r = runUnderHush(slug, SELF, [...args.slice(sep + 1), "--no-hush"]);
        process.exit(r.status ?? 1);
      }
      fail("usage: ziggy keys status|pull|run <slug>");
      break;
    }

    /* ── key-needing commands ── */
    case "profiles": {
      const t = loadTenant(pos[0]); ensureKey(t.slug);
      const list = await createClient().listProfiles();
      return out(list, (d) => d.map((p) => `${p.id.padEnd(16)} ${(p.platform || "").padEnd(10)} ${p.name}  [${p.status}]  group=${p.profile_group_id}`).join("\n") || "(no profiles)");
    }

    case "post": {
      const [slug, name] = pos;
      const t = loadTenant(slug); const c = loadCampaign(slug, name); ensureKey(slug);
      const live = has("--live");
      const at = flag("--at");
      const only = flag("--only") && flag("--only") !== true ? String(flag("--only")).split(",") : null;
      const results = await publishCampaign({ tenant: t, campaign: c, live, scheduledAt: at && at !== true ? at : undefined, only, log: say, dryRun: has("--dry-run") });
      if (has("--dry-run")) return out(results, (d) => d.map((r) => `${r.kind} → ${r.profile}\n${JSON.stringify(r.request, null, 2)}`).join("\n"));
      const ids = results.map((r) => r.post.id);
      let posts = results.map((r) => r.post);
      if (live && has("--watch")) posts = await awaitPosts({ postIds: ids });
      const data = results.map((r, i) => ({ kind: r.kind, profile: r.profile, post: posts[i], permalinks: postPermalinks(posts[i]) }));
      return out(data, (d) => d.map((r) => `${r.kind} (${r.profile})\n  ${summarizePost(r.post)}`).join("\n") + (live ? "" : `\n\ndrafts only — review, then: ziggy publish ${slug} ${ids.join(" ")}`));
    }

    case "publish": {
      const [slug, ...ids] = pos;
      const t = loadTenant(slug); ensureKey(slug);
      if (!ids.length) fail("usage: ziggy publish <slug> <postId…>");
      let posts = await publishDrafts({ tenant: t, postIds: ids, log: () => {} });
      if (has("--watch")) posts = await awaitPosts({ postIds: ids });
      return out(posts.map((p) => ({ post: p, permalinks: postPermalinks(p) })), (d) => d.map((r) => summarizePost(r.post)).join("\n"));
    }

    case "status": {
      const [slug, ...ids] = pos;
      loadTenant(slug); ensureKey(slug);
      const client = createClient();
      const want = ids.length ? ids : [...new Set(readPostLog(slug).map((r) => r.postId).filter(Boolean))].slice(-12);
      const posts = [];
      for (const id of want) posts.push(await client.getPost(id));
      return out(posts.map((p) => ({ post: p, permalinks: postPermalinks(p) })), (d) => d.map((r) => summarizePost(r.post)).join("\n") || "(no posts yet)");
    }

    case "inbox": {
      const t = loadTenant(pos[0]); ensureKey(t.slug);
      const r = await pullInbox({ tenant: t, markSeen: !has("--all"), includeDms: !has("--no-dms"), log: say });
      const items = has("--all") ? r.comments.all : r.comments.new;
      return out({ ...r, comments: { new: r.comments.new, all: has("--all") ? r.comments.all : undefined } }, () => [
        ...items.map((c) => `💬 ${c.platform} ${c.postId} · @${c.author || "?"} (${c.id})${c.depth ? " ↳" : ""}\n   ${c.body}`),
        ...r.chats.filter((ch) => has("--all") || ch.isNew).map((ch) => `✉️  ${ch.platform} chat ${ch.id} · @${ch.participant || "?"}${ch.unread ? ` (${ch.unread} unread)` : ""}\n   ${ch.lastMessage || ""}`),
        ...(r.errors.length ? [`\nerrors:\n  ${r.errors.join("\n  ")}`] : []),
      ].join("\n") || "inbox empty");
    }

    case "stats": {
      const t = loadTenant(pos[0]); ensureKey(t.slug);
      const r = await pullStats({ tenant: t });
      return out(r, (d) => [
        ...d.profiles.map((p) => `${p.platform.padEnd(10)} ${p.name}: ${fmtStats(p.stats)}`),
        ...(Array.isArray(d.posts) ? d.posts.map((s) => `post ${s.post_id || s.id || ""} ${s.platform || ""}: ${fmtStats(s.stats || s)}`) : []),
        ...(d.errors.length ? [`errors: ${d.errors.join("; ")}`] : []),
      ].join("\n") || "(no stats yet)");
    }

    case "reply": {
      const [slug, postId, commentId] = pos;
      const t = loadTenant(slug); ensureKey(slug);
      const text = flag("--text");
      if (!postId || !commentId || !text || text === true) fail("usage: ziggy reply <slug> <postId> <commentId> --text \"…\" [--profile prof_…]");
      const profileId = await resolveProfileId(t, flag("--profile"), "instagram");
      const r = await reply({ tenant: t, postId, profileId, commentId, text });
      return out(r, `replied (${r?.status || "sent"})`);
    }

    case "hide": {
      const [slug, postId, commentId] = pos;
      const t = loadTenant(slug); ensureKey(slug);
      const profileId = await resolveProfileId(t, flag("--profile"), "instagram");
      const r = await hide({ tenant: t, postId, profileId, commentId });
      return out(r, "hidden");
    }

    case "dm": {
      const [slug, chatId] = pos;
      const t = loadTenant(slug); ensureKey(slug);
      const text = flag("--text");
      if (!chatId || !text || text === true) fail("usage: ziggy dm <slug> <chatId> --text \"…\"");
      const r = await dm({ tenant: t, chatId, text });
      return out(r, "sent");
    }

    case "autopilot": {
      const t = loadTenant(pos[0]); ensureKey(t.slug);
      const report = await runAutopilot({ tenant: t, dryRun: has("--dry-run"), log: say });
      return out(report, (r) => `autopilot ${r.tenant} (${r.mode}${has("--dry-run") ? ", dry run" : ""}): ${r.handled.length} handled, ${r.queued.length} queued for a human, ${r.errors.length} error(s)` + (r.errors.length ? `\n  ${r.errors.join("\n  ")}` : ""));
    }

    case "queue": {
      const slug = pos[0]; loadTenant(slug);
      const q = readQueue(slug);
      return out(q, (d) => d.map((e) => `${e.at} ${e.item?.type || "item"} ${e.item?.id || ""} @${e.item?.author || e.item?.participant || "?"} → ${e.decision?.action}: ${e.decision?.text || e.decision?.reason || ""}\n   ${e.item?.body || e.item?.lastMessage || ""}`).join("\n") || "(queue empty)");
    }

    case "actions": {
      const slug = pos[0]; loadTenant(slug);
      return out(readActions(slug), (d) => d.map((a) => `${a.at} ${a.action} by ${a.by}${a.text ? `: ${a.text}` : ""}`).join("\n") || "(no actions)");
    }

    case "watch": {
      const slug = pos[0]; loadTenant(slug);
      if (has("--install")) {
        const r = installWatch({ slug, interval: Number(flag("--interval", 900)), ziggyBin: flag("--bin") && flag("--bin") !== true ? String(flag("--bin")) : undefined, dryRun: has("--dry-run") });
        return out(r, (d) => d.kind === "launchd" ? `${d.loaded ? "loaded" : "wrote"} ${d.path}${d.error ? `\n${d.error}` : ""}${d.plist ? `\n${d.plist}` : ""}` : `${d.loaded ? "installed" : "cron line"}: ${d.line}${d.error ? `\n${d.error}` : ""}`);
      }
      if (has("--uninstall")) return out(uninstallWatch({ slug }), (d) => d.removed ? `removed ${d.path || "cron entry"}` : "nothing installed");
      return out(watchStatus({ slug }), (d) => `${d.kind}: ${d.installed ? "installed" : "not installed"}${d.loaded ? ", loaded" : ""}\nlog: ${d.logFile}\nruns: ${d.runs}${d.lastRun ? ` · last ${d.lastRun.at} (${d.lastRun.handled} handled, ${d.lastRun.queued} queued)` : ""}`);
    }

    default:
      fail(`unknown command ${JSON.stringify(command)} — try: ziggy help`);
  }
}

async function resolveProfileId(tenant, explicit, platform) {
  if (explicit && explicit !== true) return String(explicit);
  const profiles = await createClient().listProfiles();
  const p = profiles.find((pr) => pr.platform === platform && (pr.status ?? "active") === "active" && (!tenant.postproxy?.profileGroupId || pr.profile_group_id === tenant.postproxy.profileGroupId));
  if (!p) fail(`no active ${platform} profile — pass --profile prof_…`);
  return p.id;
}

function fmtStats(s) {
  if (!s || typeof s !== "object") return "—";
  const keys = ["followers_count", "impressions", "views_7d", "reach_7d", "likes", "comments", "saved", "shares", "total_interactions_7d", "profile_views_7d"];
  const parts = keys.filter((k) => s[k] != null).map((k) => `${k}=${s[k]}`);
  return parts.join(" ") || JSON.stringify(s).slice(0, 160);
}

function defaultPlaybook(name) {
  return `# ${name} — social playbook

Voice: calm, curious, factual. Short sentences. No hype, no exclamation marks in a row.
Language: answer in the language of the person; default English.

## Always
- Thank people who add a source, a correction or a sighting; invite them to send more.
- Answer questions about the project with what the site actually says. Never invent dates, numbers or claims.
- Point to the site when the answer lives there.

## Never
- Argue about whether aliens exist. Stay on observations and sources.
- Promise features, timelines or partnerships.
- Reply to spam, slurs or bait — hide the clearly abusive ones, skip the rest.

## Escalate to a human
- Press, partnerships, legal or copyright, anything about money, anything you are not sure about.
`;
}

main().catch((error) => fail(error.message));
