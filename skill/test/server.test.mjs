import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { keyEnvFor, serve } from "../scripts/server.mjs";
import { API_KEY, makeWorld, startMockPostproxy } from "./helpers.mjs";

const world = makeWorld({ withRenders: false });
after(world.cleanup);
process.env.ZIGGY_HOME = world.home;
process.env.ZIGGY_REPO = world.repo;

const quiet = () => {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("the per-tenant key variable name uppercases and sanitizes the slug", () => {
  assert.equal(keyEnvFor("ragusa"), "POSTPROXY_API_KEY_RAGUSA");
  assert.equal(keyEnvFor("my-brand.v2"), "POSTPROXY_API_KEY_MY_BRAND_V2");
});

test("serve runs daily + report per tenant at boot and then on its timers", async () => {
  const calls = [];
  const spawnImpl = async ({ slug, cmd }) => {
    calls.push({ slug, cmd });
    return { ok: true, code: 0, stdout: `${cmd} done`, stderr: "" };
  };
  const r = serve({ slugs: ["acme"], dailyEveryS: 0.05, reportEveryS: 0.07, port: 0, spawnImpl, log: quiet });
  assert.equal(r.address(), null, "port 0 disables the health endpoint");
  await r.boot;
  assert.deepEqual(calls.map((c) => c.cmd).sort(), ["daily", "report"]);
  await sleep(280);
  await r.stop();
  const later = calls.filter((c) => c.cmd === "daily").length;
  assert.ok(later >= 3, `daily re-runs on its timer (${later})`);
  assert.equal(r.state.acme.daily.error, null);
  assert.ok(r.state.acme.report.lastOk);
});

test("a failing run is recorded and the loop goes on", async () => {
  const spawnImpl = async ({ cmd }) => ({ ok: cmd !== "daily", code: cmd === "daily" ? 1 : 0, stdout: "", stderr: "boom\nmore" });
  const r = serve({ slugs: ["acme"], dailyEveryS: 0.05, reportEveryS: 0.05, port: 0, spawnImpl, log: quiet });
  await r.boot;
  await sleep(120);
  await r.stop();
  assert.equal(r.state.acme.daily.error, "boom");
  assert.equal(r.state.acme.report.error, null);
});

test("GET /healthz reports the tenants' last runs", async () => {
  const spawnImpl = async () => ({ ok: true, code: 0, stdout: "", stderr: "" });
  const r = serve({ slugs: ["acme"], dailyEveryS: 3600, reportEveryS: 3600, port: 0, spawnImpl, log: quiet });
  await r.boot;
  // port 0 disables http — re-serve with a fixed free port to exercise the endpoint
  await r.stop();
  const s = serve({ slugs: ["acme"], dailyEveryS: 3600, reportEveryS: 3600, port: 18080, spawnImpl, log: quiet });
  await s.boot;
  const res = await fetch("http://127.0.0.1:18080/healthz");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(body.tenants.acme.daily.lastOk);
  const missing = await fetch("http://127.0.0.1:18080/nope");
  assert.equal(missing.status, 404);
  await s.stop();
});

test("the report hook receives the report text per tenant", async () => {
  const file = join(world.root, "hook-out.txt");
  process.env.ZIGGY_REPORT_HOOK = `printf '%s\\n' "$ZIGGY_REPORT_TENANT: $ZIGGY_REPORT_TEXT" >> ${file}`;
  try {
    const spawnImpl = async ({ cmd }) => ({ ok: true, code: 0, stdout: cmd === "report" ? "the report body" : "", stderr: "" });
    const r = serve({ slugs: ["acme"], once: true, spawnImpl, log: quiet });
    await r.boot;
    await r.stop();
    await sleep(50);
    assert.equal(readFileSync(file, "utf8"), "acme: the report body\n");
  } finally {
    delete process.env.ZIGGY_REPORT_HOOK;
    rmSync(file, { force: true });
  }
});

test("with several tenants the hook fires once with every digest combined", async () => {
  const file = join(world.root, "hook-out.txt");
  // a second tenant in the test world
  const bdir = join(world.repo, "tenants", "beta");
  mkdirSync(bdir, { recursive: true });
  writeFileSync(join(bdir, "tenant.json"), JSON.stringify({ name: "Beta", site: "https://beta.example/", language: "en" }));
  process.env.ZIGGY_REPORT_HOOK = `printf '%s\\n' "$ZIGGY_REPORT_TENANT: $ZIGGY_REPORT_TEXT" >> ${file}`;
  try {
    const spawnImpl = async ({ slug, cmd }) => ({ ok: true, code: 0, stdout: cmd === "report" ? `report of ${slug}` : "", stderr: "" });
    const r = serve({ slugs: ["acme", "beta"], once: true, spawnImpl, log: quiet });
    await r.boot;
    await r.stop();
    await sleep(50);
    // one hook call, not two: the tenants' digests in a single message
    assert.equal(readFileSync(file, "utf8"), "acme,beta: report of acme\n\nreport of beta\n");
  } finally {
    delete process.env.ZIGGY_REPORT_HOOK;
    rmSync(file, { force: true });
  }
});

test("key isolation: the per-slug variable wins, a shared one passes only when serving one tenant", async () => {
  const mock = await startMockPostproxy({ posts: {} });
  try {
    const { defaultSpawn } = await import("../scripts/server.mjs");
    process.env.ZIGGY_POSTPROXY_BASE_URL = mock.baseUrl;
    process.env.POSTPROXY_API_KEY = "wrong-key";
    process.env[keyEnvFor("acme")] = API_KEY;
    try {
      const one = await defaultSpawn({ slug: "acme", cmd: "status", slugs: ["acme", "other"] });
      assert.equal(one.ok, true, one.stderr);
      delete process.env[keyEnvFor("acme")];
      const shared = await defaultSpawn({ slug: "acme", cmd: "status", slugs: ["acme"] });
      assert.equal(shared.ok, true, "one tenant alone may use the shared POSTPROXY_API_KEY");
      const mixed = await defaultSpawn({ slug: "acme", cmd: "status", slugs: ["acme", "other"] });
      assert.equal(mixed.ok, false, "with several tenants the shared key never leaks into a child");
    } finally {
      delete process.env.POSTPROXY_API_KEY;
      delete process.env[keyEnvFor("acme")];
      delete process.env.ZIGGY_POSTPROXY_BASE_URL;
    }
  } finally {
    await mock.close();
  }
});
