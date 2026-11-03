import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createZernioClient } from '../scripts/zernio.mjs';
import { makeWorld, fakeHush, runCli, API_KEY } from './helpers.mjs';

async function setup(t) {
  const w = makeWorld(); t.after(w.cleanup);
  const configPath = join(w.repo, 'tenants/acme/tenant.json');
  const config = JSON.parse(readFileSync(configPath));
  writeFileSync(configPath, JSON.stringify({ ...config, publishing: { provider: 'zernio' }, zernio: { accountIds: ['ig_owned'], secretName: 'ziggy.acme.zernio' } }));
  const campaignPath = join(w.repo, 'tenants/acme/campaigns/launch/campaign.json');
  const campaign = JSON.parse(readFileSync(campaignPath));
  campaign.posts = { instagram_reel: { body: 'Approved caption #Acme', media: 'reel' } };
  writeFileSync(campaignPath, JSON.stringify(campaign));
  const calls = []; const posts = {}; let uploads = 0;
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.url === '/storage') {
      assert.equal(req.headers.authorization, undefined); uploads++;
      calls.push({ path: req.url, bytes: raw.length }); res.end(); return;
    }
    assert.equal(req.headers.authorization, `Bearer ${API_KEY}`);
    const body = raw.length ? JSON.parse(raw) : null;
    calls.push({ method: req.method, path: req.url, body, idempotencyKey: req.headers['idempotency-key'] });
    if (req.url === '/v1/accounts') return send(200, { accounts: [
      { _id: 'ig_other', platform: 'instagram', username: 'Other tenant', isActive: true },
      { _id: 'ig_owned', platform: 'instagram', username: 'Acme', isActive: true },
    ] });
    if (req.url === '/v1/media/presign') return send(200, { uploadUrl: base + '/storage', publicUrl: 'https://media.example/reel.mp4' });
    if (req.url === '/v1/posts' && req.method === 'POST') {
      const old = Object.values(posts).find(p => p.key === req.headers['idempotency-key']);
      if (old) return send(200, { post: old });
      const id = `post_${Object.keys(posts).length + 1}`;
      const p = { _id: id, key: req.headers['idempotency-key'], content: body.content,
        status: body.isDraft ? 'draft' : body.scheduledFor ? 'scheduled' : 'published', scheduledFor: body.scheduledFor,
        platforms: [{ accountId: body.platforms[0].accountId, platform: 'instagram', status: body.publishNow ? 'published' : 'pending', platformPostUrl: body.publishNow ? 'https://instagram.com/reel/approved/' : null }] };
      posts[id] = p; return send(201, { post: p });
    }
    const id = req.url.split('/').pop();
    if (req.method === 'GET' && posts[id]) return send(200, { post: posts[id] });
    if (req.method === 'PUT' && posts[id]) {
      Object.assign(posts[id], { status: body.publishNow ? 'published' : 'scheduled', scheduledFor: body.scheduledFor });
      if (body.publishNow) Object.assign(posts[id].platforms[0], { status: 'published', platformPostUrl: 'https://instagram.com/reel/approved/' });
      return send(200, { post: posts[id] });
    }
    if (req.method === 'DELETE' && posts[id]) { delete posts[id]; return send(200, { success: true }); }
    send(404, { error: 'not found' });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const hush = fakeHush(join(w.root, 'bin'), { names: ['ziggy.acme.zernio'] });
  const env = { ...w.env, ZIGGY_ZERNIO_BASE_URL: base + '/v1/', ZIGGY_HUSH_BIN: hush };
  delete env.POSTPROXY_API_KEY; delete env.ZERNIO_API_KEY;
  const client = createZernioClient({ baseUrl: base + '/v1/', apiKey: API_KEY, accountIds: ['ig_owned'] });
  return { w, calls, posts, client, env, uploadCount: () => uploads };
}

test('Zernio CLI uses hush, filters accounts, uploads and publishes approved reel with permalink', async t => {
  const { env, calls, uploadCount } = await setup(t);
  const profiles = await runCli(['profiles', 'acme', '--json'], env);
  assert.equal(profiles.status, 0, profiles.stderr);
  assert.deepEqual(JSON.parse(profiles.stdout).map(p => p.id), ['ig_owned']);
  const post = await runCli(['post', 'acme', 'launch', '--live', '--watch', '--json'], env);
  assert.equal(post.status, 0, post.stderr);
  const data = JSON.parse(post.stdout);
  assert.equal(data[0].permalinks[0].url, 'https://instagram.com/reel/approved/');
  assert.equal(uploadCount(), 1);
  const request = calls.find(c => c.path === '/v1/posts' && c.method === 'POST');
  assert.equal(request.body.content, 'Approved caption #Acme');
  assert.equal(request.body.platforms[0].accountId, 'ig_owned');
  assert.equal(request.body.publishNow, true);
  assert.equal(request.body.isDraft, false);
  assert.match(request.idempotencyKey, /^ziggy-/);
  const status = await runCli(['status', 'acme', '--json'], env);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout)[0].post.status, 'published');
});

test('Zernio draft promotion checks ownership and never republishes a published post', async t => {
  const { env, calls } = await setup(t);
  const draft = await runCli(['post', 'acme', 'launch', '--json'], env);
  assert.equal(draft.status, 0, draft.stderr);
  const id = JSON.parse(draft.stdout)[0].post.id;
  assert.equal(calls.find(c => c.method === 'POST' && c.path === '/v1/posts').body.publishNow, undefined);
  const promoted = await runCli(['publish', 'acme', id, '--watch', '--json'], env);
  assert.equal(promoted.status, 0, promoted.stderr);
  const again = await runCli(['publish', 'acme', id], env);
  assert.notEqual(again.status, 0);
  assert.equal(calls.filter(c => c.method === 'PUT').length, 1);
});

test('Zernio refuses unpinned accounts and unsupported options before uploads', async t => {
  const { client, calls } = await setup(t);
  const request = { profiles: ['ig_other'], media: ['https://media.example/reel.mp4'], platforms: { instagram: { format: 'reel' } } };
  await assert.rejects(client.createPost(request), /unpinned/);
  await assert.rejects(client.createPost({ ...request, profiles: ['ig_owned'], platforms: { instagram: { format: 'reel', cover_file: '/tmp/cover.jpg' } } }), /unsupported/);
  await assert.rejects(client.createPost({ ...request, profiles: ['ig_owned'], media: ['https://media.example/photo.jpg'] }), /video/);
  assert.equal(calls.length, 0);
});

test('Zernio schedules, reschedules and deletes drafts with ownership checks', async t => {
  const { client, posts, calls } = await setup(t);
  const post = await client.createPost({ profiles: ['ig_owned'], media: ['https://media.example/reel.mp4'], platforms: { instagram: { format: 'reel' } }, scheduledAt: '2099-01-01T10:00:00Z' });
  assert.equal(post.status, 'scheduled');
  assert.equal(calls.find(c => c.method === 'POST').body.publishNow, undefined);
  const moved = await client.reschedulePost(post.id, '2099-01-02T10:00:00Z');
  assert.equal(moved.scheduled_at, '2099-01-02T10:00:00Z');
  await assert.rejects(client.reschedulePost(post.id, '2000-01-01T10:00:00Z'), /future/);
  posts.foreign = { _id: 'foreign', status: 'draft', platforms: [{ accountId: 'ig_other', platform: 'instagram' }] };
  await assert.rejects(client.deletePost('foreign'), /unpinned/);
  await client.deletePost(post.id);
  assert.equal(posts[post.id], undefined);
});

test('unsupported Zernio commands refuse instead of using Postproxy', async t => {
  const { env, calls } = await setup(t);
  const r = await runCli(['inbox', 'acme'], env);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Zernio does not yet support inbox/);
  assert.equal(calls.length, 0);
});

test('Zernio dry-run validates unsupported settings without creating uploads', async t => {
  const { w, env, calls } = await setup(t);
  const path = join(w.repo, 'tenants/acme/campaigns/launch/campaign.json');
  const campaign = JSON.parse(readFileSync(path));
  campaign.posts.instagram_reel.cover = true;
  writeFileSync(path, JSON.stringify(campaign));
  const r = await runCli(['post', 'acme', 'launch', '--live', '--dry-run'], env);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /unsupported Zernio options/);
  assert.equal(calls.filter(c => c.method === 'POST').length, 0);
});

test('Zernio retries use the same idempotency key; changing the media changes the key', async t => {
  const { w, client, calls } = await setup(t);
  const media = join(w.root, 'test.mp4'); writeFileSync(media, 'video version one');
  const request = { body: 'Approved', profiles: ['ig_owned'], media: [media], platforms: { instagram: { format: 'reel' } } };
  const first = await client.createPost(request);
  const again = await client.createPost(request);
  assert.equal(first.id, again.id);
  writeFileSync(media, 'video version two');
  const changed = await client.createPost(request);
  assert.notEqual(first.id, changed.id);
  const keys = calls.filter(c => c.path === '/v1/posts').map(c => c.idempotencyKey);
  assert.equal(keys[0], keys[1]); assert.notEqual(keys[0], keys[2]);
});

test('Zernio upload rejection stops before post creation and never sends the API key to storage', async t => {
  const { w } = await setup(t);
  const media = join(w.root, 'test.mp4'); writeFileSync(media, 'video');
  const calls = [];
  const client = createZernioClient({ accountIds: ['ig_owned'], apiKey: API_KEY, fetchImpl: async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('media/presign')) return Response.json({ uploadUrl: 'https://storage.example/upload', publicUrl: 'https://media.example/test.mp4' });
    assert.equal(init.headers.Authorization, undefined);
    return new Response('rejected', { status: 403 });
  } });
  await assert.rejects(client.createPost({ profiles: ['ig_owned'], media: [media], platforms: { instagram: { format: 'reel' } } }), /upload failed: 403/);
  assert.equal(calls.length, 2);
});
