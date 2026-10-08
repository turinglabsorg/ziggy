/**
 * Shared fixtures: a Postproxy look-alike on localhost that records every request (and parses
 * multipart bodies), a throwaway ZIGGY_HOME/ZIGGY_REPO, and a fake `hush` on PATH.
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const API_KEY = "test-key-0123456789abcdef";

export async function startMockPostproxy({ profiles, posts = {}, comments = {}, chats = {}, stats = {} } = {}) {
  const calls = [];
  const state = {
    profiles: profiles || [
      { id: "prof_x", name: "@brand", platform: "twitter", status: "active", profile_group_id: "grp_1" },
      { id: "prof_ig", name: "Brand", platform: "instagram", status: "active", profile_group_id: "grp_1" },
    ],
    posts: { ...posts },
    comments: { ...comments },
    chats: { ...chats },
    stats,
    nextId: 1,
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const auth = req.headers.authorization;
    const send = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (auth !== `Bearer ${API_KEY}`) return send(401, { error: "unauthorized" });

    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    const ct = req.headers["content-type"] || "";
    let body = null, fields = null;
    if (ct.includes("multipart/form-data")) {
      const form = await new Response(raw, { headers: { "content-type": ct } }).formData();
      fields = {};
      for (const [k, v] of form.entries()) {
        const val = typeof v === "string" ? v : { filename: v.name, type: v.type, size: v.size };
        if (k.endsWith("[]")) (fields[k] ||= []).push(val); else fields[k] = val;
      }
    } else if (raw.length) {
      try { body = JSON.parse(raw.toString("utf8")); } catch { body = raw.toString("utf8"); }
    }
    const call = { method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body, fields };
    calls.push(call);

    const m = (re) => url.pathname.match(re);
    let mm;
    if (req.method === "POST" && url.pathname === "/v1/systemone") {
      // a Jev look-alike: literal scores from the message text, enough to drive the routing
      const text = String(body?.state?.message || "");
      const scores = {
        escalate: /refund|money|lawyer|press/i.test(text) ? 0.95 : 0.04,
        spam: /free crypto|click here|followers/i.test(text) ? 0.97 : 0.03,
        needs_reply: /\?/.test(text) ? 0.93 : /^[\p{Extended_Pictographic}\s!]+$/u.test(text) ? 0.02 : 0.5,
      };
      return send(200, { answers: Object.fromEntries(Object.keys(body.questions || {}).map((k) => [k, { noul: scores[k] }])), usage: { input_tokens: 120 } });
    }
    if (req.method === "GET" && url.pathname === "/api/profiles") return send(200, { data: state.profiles });
    if (req.method === "GET" && url.pathname === "/api/posts/stats") return send(200, { data: state.stats.posts || [] });
    if (req.method === "GET" && url.pathname === "/api/posts") return send(200, { data: Object.values(state.posts) });
    if (req.method === "POST" && url.pathname === "/api/posts") {
      const id = `post_${state.nextId++}`;
      const draft = fields ? fields["post[draft]"] === "true" : Boolean(body?.post?.draft);
      const profiles = fields ? fields["profiles[]"] : body.profiles;
      const platforms = profiles.map((p) => { const prof = state.profiles.find((x) => x.id === p || x.platform === p); return { platform: prof?.platform || p, profile_id: prof?.id || p, status: draft ? "pending" : "published", permalink: draft ? null : `https://example.social/${id}` }; });
      state.posts[id] = { id, status: draft ? "draft" : "processed", body: fields ? fields["post[body]"] : body.post.body, platforms, scheduled_at: fields ? fields["post[scheduled_at]"] || null : body.post.scheduled_at || null };
      return send(201, { data: state.posts[id] });
    }
    if ((mm = m(/^\/api\/posts\/([^/]+)\/publish$/)) && req.method === "POST") {
      const p = state.posts[mm[1]]; if (!p) return send(404, { error: "not found" });
      p.status = "processed"; p.platforms.forEach((pl) => { pl.status = "published"; pl.permalink = `https://example.social/${p.id}`; });
      return send(200, { data: p });
    }
    if ((mm = m(/^\/api\/posts\/([^/]+)\/comments$/)) && req.method === "GET") return send(200, { data: state.comments[mm[1]] || [] });
    if ((mm = m(/^\/api\/posts\/([^/]+)\/comments$/)) && req.method === "POST") {
      const c = { id: `cmt_${state.nextId++}`, body: body.body, parent_id: body.parent_id || null, status: "pending", is_own: true };
      (state.comments[mm[1]] ||= []).push(c);
      return send(201, { data: c });
    }
    if ((mm = m(/^\/api\/posts\/([^/]+)\/comments\/([^/]+)\/(hide|unhide|like|unlike)$/)) && req.method === "POST") return send(200, { data: { id: mm[2], hidden: mm[3] === "hide" } });
    if ((mm = m(/^\/api\/posts\/([^/]+)\/comments\/([^/]+)\/private_reply$/)) && req.method === "POST") return send(201, { data: { id: `msg_${state.nextId++}`, text: body.text, comment_id: mm[2] } });
    if ((mm = m(/^\/api\/posts\/([^/]+)$/)) && req.method === "GET") { const p = state.posts[mm[1]]; return p ? send(200, { data: p }) : send(404, { error: "not found" }); }
    if ((mm = m(/^\/api\/posts\/([^/]+)$/)) && req.method === "DELETE") { const p = state.posts[mm[1]]; if (!p) return send(404, { error: "not found" }); delete state.posts[mm[1]]; return send(200, { data: { id: mm[1], deleted: true } }); }
    if ((mm = m(/^\/api\/profiles\/([^/]+)\/stats$/))) return send(200, { data: state.stats.profiles?.[mm[1]] || [] });
    if ((mm = m(/^\/api\/profiles\/([^/]+)\/chats$/)) && req.method === "GET") return send(200, { data: state.chats[mm[1]] || [] });
    if ((mm = m(/^\/api\/chats\/([^/]+)\/messages$/)) && req.method === "POST") return send(201, { data: { id: `msg_${state.nextId++}`, body: body.body, status: "pending" } });
    send(404, { error: `no route ${req.method} ${url.pathname}` });
  });

  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return { baseUrl, calls, state, close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

/** A fresh ZIGGY_HOME + ZIGGY_REPO with one tenant and (optionally) one campaign + fake renders. */
export function makeWorld({ slug = "acme", withBrand = true, withCampaign = true, withRenders = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "ziggy-test-"));
  const home = join(root, "home"), repo = join(root, "repo");
  const tdir = join(repo, "tenants", slug);
  mkdirSync(join(tdir, "campaigns", "launch"), { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(tdir, "tenant.json"), JSON.stringify({ name: "Acme", site: "https://acme.example/", language: "en", postproxy: {}, autopilot: { mode: "draft" } }));
  writeFileSync(join(tdir, "playbook.md"), "# Acme playbook\nBe nice. Escalate money.\n");
  if (withBrand) {
    writeFileSync(join(tdir, "brand.json"), JSON.stringify({
      name: "Acme", site: "https://acme.example/", tagline: "Things, observed.",
      palette: { bg: "#07080b", fg: "#ece6da", muted: "#8c8678", line: "#24231f", accent: "#ff5a1f" },
      fonts: { display: { family: "Unbounded", weights: [300, 600] }, text: { family: "Geist", weights: [300, 400] }, mono: { family: "Geist Mono", weights: [400, 500] } },
      wordmark: { text: "Acme Corp", parts: [{ text: "Acme", weight: 300 }, { text: "Corp", weight: 600 }], transform: "uppercase", letterSpacing: "0.06em", accentDot: true },
      mark: { svg: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><circle cx='16' cy='16' r='9' fill='none' stroke='#ECE6DA' stroke-width='2'/></svg>", source: "favicon-data-uri" },
      stars: true,
    }));
  }
  if (withCampaign) {
    writeFileSync(join(tdir, "campaigns", "launch", "campaign.json"), JSON.stringify({
      template: "teaser", language: "en", duration: 7.5,
      copy: { teaser: "Someone is keeping watch.", tagline: "Things, observed.", url: "acme.example" },
      audio: { bed: "ambient", volume: 0.7 },
      posts: {
        twitter: { body: "Acme is live. acme.example", media: "x" },
        instagram_reel: { body: "Acme is live.", media: "reel", cover: true, first_comment: "More at acme.example" },
        instagram_post: { body: "Acme is live.", media: "post-still", alt_text: "Acme wordmark" },
      },
    }));
  }
  if (withRenders) {
    const rdir = join(home, "tenants", slug, "renders", "launch");
    mkdirSync(rdir, { recursive: true });
    const outputs = {};
    for (const [v, [w, h]] of Object.entries({ reel: [1080, 1920], x: [1920, 1080], post: [1080, 1350] })) {
      const video = join(rdir, `${slug}-launch-${v}-${w}x${h}.mp4`), still = join(rdir, `${slug}-launch-${v}-${w}x${h}.png`);
      writeFileSync(video, Buffer.alloc(2048, 1)); writeFileSync(still, Buffer.alloc(1024, 2));
      outputs[v] = { video, still, w, h };
    }
    writeFileSync(join(rdir, "manifest.json"), JSON.stringify({ tenant: slug, campaign: "launch", outputs }));
  }
  return { root, home, repo, slug, env: { ...process.env, ZIGGY_HOME: home, ZIGGY_REPO: repo }, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** A fake `hush` that answers `list --json` with NAMES and runs the child with ENV injected. */
export function fakeHush(dir, { names = [], secretValue = API_KEY } = {}) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "hush");
  writeFileSync(file, `#!/usr/bin/env node
const args = process.argv.slice(2);
const names = ${JSON.stringify(names)};
if (args[0] === "--version") { console.log("hush fake 0.0.0"); process.exit(0); }
if (args[0] === "list") { console.log(JSON.stringify({ secrets: names.map((n) => ({ name: n })) })); process.exit(0); }
if (args[0] === "pull") { const n = args[args.indexOf("--name") + 1]; console.log(JSON.stringify({ event: "stored", name: n, sender: "self", replaced: false })); process.exit(0); }
if (args[0] === "run") {
  const name = args[args.indexOf("--name") + 1];
  const env = args[args.indexOf("--env") + 1];
  const sep = args.indexOf("--");
  if (!names.includes(name)) { console.error("hush: no such secret " + name); process.exit(3); }
  const { spawnSync } = require("node:child_process");
  const r = spawnSync(args[sep + 1], args.slice(sep + 2), { stdio: "inherit", env: { ...process.env, [env]: ${JSON.stringify(secretValue)} } });
  process.exit(r.status ?? 1);
}
console.error("fake hush: unknown " + args.join(" ")); process.exit(2);
`);
  chmodSync(file, 0o755);
  return file;
}

/** A fake agent that prints a decision; reads the prompt from stdin so the test can assert on it. */
export function fakeAgent(dir, decision, { echoPromptTo } = {}) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "agent.mjs");
  writeFileSync(file, `import { readFileSync, writeFileSync } from "node:fs";
const prompt = readFileSync(0, "utf8");
${echoPromptTo ? `writeFileSync(${JSON.stringify(echoPromptTo)}, prompt);` : ""}
const d = ${JSON.stringify(decision)};
const body = prompt.includes("MONEY") ? { action: "escalate", reason: "money" } : d;
console.log(JSON.stringify({ type: "result", result: "Sure. " + JSON.stringify(body) }));
`);
  return [process.execPath, file];
}

/**
 * Run the CLI without blocking the event loop. The mock Postproxy lives in the test process, so a
 * `spawnSync` here would deadlock: the child waits for a response the parent can't send.
 */
export function runCli(args, env, { timeout = 60000 } = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [join(import.meta.dirname, "..", "index.js"), ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
    child.on("close", (status, signal) => { clearTimeout(timer); resolvePromise({ status, signal, stdout, stderr }); });
  });
}
