import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { PostproxyError, createClient, normalizeComment, pickProfile, summarizePost } from "../scripts/postproxy.mjs";
import { API_KEY, startMockPostproxy } from "./helpers.mjs";

let mock;
const dir = mkdtempSync(join(tmpdir(), "ziggy-pp-"));
before(async () => { mock = await startMockPostproxy(); });
after(async () => { await mock.close(); rmSync(dir, { recursive: true, force: true }); });

const client = () => createClient({ baseUrl: mock.baseUrl, apiKey: API_KEY });

test("the key travels only in the Authorization header", async () => {
  const profiles = await client().listProfiles();
  assert.equal(profiles.length, 2);
  const call = mock.calls.at(-1);
  assert.equal(call.path, "/api/profiles");
  assert.equal(JSON.stringify(call).includes(API_KEY), false, "no key in path, query or body");
});

test("a wrong key is a PostproxyError with the status, never a silent empty result", async () => {
  const bad = createClient({ baseUrl: mock.baseUrl, apiKey: "nope" });
  await assert.rejects(bad.listProfiles(), (e) => e instanceof PostproxyError && e.status === 401);
});

test("createClient refuses to start without a key", () => {
  const saved = process.env.POSTPROXY_API_KEY;
  delete process.env.POSTPROXY_API_KEY;
  assert.throws(() => createClient({ baseUrl: mock.baseUrl }), /POSTPROXY_API_KEY is not set/);
  if (saved) process.env.POSTPROXY_API_KEY = saved;
});

test("local media → multipart with bracketed fields, platform params and a cover file", async () => {
  const video = join(dir, "reel.mp4"); writeFileSync(video, Buffer.alloc(4096, 7));
  const cover = join(dir, "cover.jpg"); writeFileSync(cover, Buffer.alloc(512, 9));
  const post = await client().createPost({
    body: "hello", profiles: ["prof_ig"], media: [video], draft: true,
    platforms: { instagram: { format: "reel", first_comment: "more", cover_file: cover, collaborators: ["a", "b"] } },
  });
  assert.equal(post.status, "draft");
  const f = mock.calls.at(-1).fields;
  assert.equal(f["post[body]"], "hello");
  assert.equal(f["post[draft]"], "true");
  assert.deepEqual(f["profiles[]"], ["prof_ig"]);
  assert.equal(f["media[]"][0].filename, "reel.mp4");
  assert.equal(f["media[]"][0].type, "video/mp4");
  assert.equal(f["media[]"][0].size, 4096);
  assert.equal(f["platforms[instagram][format]"], "reel");
  assert.equal(f["platforms[instagram][first_comment]"], "more");
  assert.equal(f["platforms[instagram][cover_file]"].filename, "cover.jpg");
  assert.deepEqual(f["platforms[instagram][collaborators][]"], ["a", "b"]);
});

test("a thread travels with local media as indexed form fields", async () => {
  const video = join(dir, "tweet.mp4"); writeFileSync(video, Buffer.alloc(128, 3));
  await client().createPost({
    body: "the claim", profiles: ["prof_x"], media: [video],
    thread: [{ body: "https://example.com/story" }],
    platforms: { twitter: {} },
  });
  const f = mock.calls.at(-1).fields;
  assert.equal(f["post[body]"], "the claim");
  assert.equal(f["thread[0][body]"], "https://example.com/story");
  assert.equal(JSON.stringify(f).includes("https://example.com/story"), true);
});

test("remote media → JSON body with draft/scheduled_at", async () => {
  await client().createPost({ body: "x", profiles: ["twitter"], media: ["https://cdn.example/v.mp4"], platforms: { twitter: {} }, scheduledAt: "2030-01-01T10:00:00Z" });
  const b = mock.calls.at(-1).body;
  assert.equal(b.post.body, "x");
  assert.equal(b.post.scheduled_at, "2030-01-01T10:00:00Z");
  assert.deepEqual(b.media, ["https://cdn.example/v.mp4"]);
});

test("publish, get, comments, hide, stats and DMs hit the documented routes", async () => {
  const c = client();
  const draft = await c.createPost({ body: "d", profiles: ["prof_ig"], media: ["https://cdn.example/i.jpg"], draft: true });
  const pub = await c.publishPost(draft.id);
  assert.equal(pub.status, "processed");
  assert.equal(pub.platforms[0].status, "published");
  const got = await c.getPost(draft.id);
  assert.equal(got.id, draft.id);
  mock.state.comments[draft.id] = [{ id: "cmt_1", text: "love it", author: { username: "fan" }, replies: [{ id: "cmt_2", text: "me too", username: "fan2" }] }];
  const comments = await c.listComments(draft.id, "prof_ig");
  assert.equal(mock.calls.at(-1).query.profile_id, "prof_ig");
  const n = normalizeComment(comments[0]);
  assert.equal(n.body, "love it"); assert.equal(n.author, "fan"); assert.equal(n.replies[0].author, "fan2");
  const r = await c.createComment(draft.id, "prof_ig", { body: "thanks!", parentId: "cmt_1" });
  assert.equal(r.parent_id, "cmt_1");
  assert.deepEqual(mock.calls.at(-1).body, { body: "thanks!", parent_id: "cmt_1" });
  await c.hideComment(draft.id, "prof_ig", "cmt_1");
  assert.match(mock.calls.at(-1).path, /\/comments\/cmt_1\/hide$/);
  await c.postStats({ postIds: [draft.id, "post_9"], profiles: ["instagram"] });
  assert.equal(mock.calls.at(-1).query.post_ids, `${draft.id},post_9`);
  await c.profileStats("prof_ig");
  assert.equal(mock.calls.at(-1).path, "/api/profiles/prof_ig/stats");
  await c.listChats("prof_ig");
  assert.equal(mock.calls.at(-1).path, "/api/profiles/prof_ig/chats");
  const msg = await c.sendMessage("chat_1", { body: "hi" });
  assert.equal(msg.body, "hi");
});

test("pickProfile prefers active profiles of the platform, optionally in a group", () => {
  const profiles = [{ id: "a", platform: "instagram", status: "expired" }, { id: "b", platform: "instagram", status: "active", profile_group_id: "g2" }, { id: "c", platform: "twitter", status: "active" }];
  assert.equal(pickProfile(profiles, "instagram").id, "b");
  assert.equal(pickProfile(profiles, "instagram", { groupId: "g1" }), null);
  assert.match(summarizePost({ id: "p", status: "processed", platforms: [{ platform: "twitter", status: "published", permalink: "https://x.com/a/status/1" }] }), /x\.com/);
});

test("pickProfile with profileIds never crosses tenants on a shared account", () => {
  // a shared Postproxy account holds both tenants' profiles: exact ids must win over order
  const profiles = [
    { id: "OLU4ab", platform: "instagram", status: "active", profile_group_id: "gR", name: "Ragusa Buzz" },
    { id: "j3Ulwd", platform: "instagram", status: "active", profile_group_id: "gA", name: "Alien Watch" },
    { id: "mxU8Vn", platform: "tiktok", status: "active", profile_group_id: "gA", name: "alienwtch" },
  ];
  assert.equal(pickProfile(profiles, "instagram", { profileIds: ["DaUWBa", "j3Ulwd", "mxU8Vn"] }).id, "j3Ulwd");
  assert.equal(pickProfile(profiles, "tiktok", { profileIds: ["DaUWBa", "j3Ulwd", "mxU8Vn"] }).id, "mxU8Vn");
  assert.equal(pickProfile(profiles, "instagram", { profileIds: ["OLU4ab"] }).id, "OLU4ab");
  assert.equal(pickProfile(profiles, "linkedin", { profileIds: ["DaUWBa", "j3Ulwd"] }), null);
});
