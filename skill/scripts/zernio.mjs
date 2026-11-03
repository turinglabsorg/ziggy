import { createReadStream, openAsBlob, statSync } from 'node:fs';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import { mimeFor } from './postproxy.mjs';

export function normalizeZernioPost(p) {
  if (!p?._id) throw new Error('Zernio returned no post id; check remote posts before retrying');
  return { id: p._id, status: p.status, body: p.content, scheduled_at: p.scheduledFor,
    platforms: (p.platforms || []).map(a => ({ platform: a.platform, profile_id: typeof a.accountId === 'object' ? a.accountId._id : a.accountId,
      status: a.status, permalink: a.platformPostUrl || null, error: a.error || null })) };
}

export function createZernioClient({ accountIds = [], baseUrl = process.env.ZIGGY_ZERNIO_BASE_URL || 'https://zernio.com/api/v1/', apiKey = process.env.ZERNIO_API_KEY, fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error('ZERNIO_API_KEY is not set; use the tenant hush key');
  const allowed = new Set(accountIds);
  async function request(method, path, json, extraHeaders = {}) {
    const res = await fetchImpl(new URL(path, baseUrl.endsWith('/') ? baseUrl : baseUrl + '/'), {
      method, headers: { Authorization: `Bearer ${apiKey}`, ...(json ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders },
      ...(json ? { body: JSON.stringify(json) } : {}), signal: AbortSignal.timeout(180000),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`Zernio ${res.status}: ${body.error || body.code || 'request failed'}`);
    return body;
  }
  function assertTargets(ids) {
    if (!ids?.length || !allowed.size || ids.some(id => !allowed.has(id))) throw new Error('Zernio requires explicit tenant.zernio.accountIds; refusing an unpinned account');
  }
  async function getPost(id) {
    const p = normalizeZernioPost((await request('GET', `posts/${encodeURIComponent(id)}`)).post);
    assertTargets(p.platforms.map(a => a.profile_id));
    return p;
  }
  async function upload(path) {
    if (/^https:\/\//i.test(path)) return path;
    if (/^http:/i.test(path)) throw new Error('Zernio media URLs must use HTTPS');
    const contentType = mimeFor(path);
    const { uploadUrl, publicUrl } = await request('POST', 'media/presign', { filename: basename(path), contentType, size: statSync(path).size });
    if (!uploadUrl || !publicUrl) throw new Error('Zernio returned an incomplete upload URL');
    const res = await fetchImpl(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: await openAsBlob(path), signal: AbortSignal.timeout(180000) });
    if (!res.ok) throw new Error(`Zernio media upload failed: ${res.status}`);
    return publicUrl;
  }
  function validateRequest({ profiles, media = [], platforms = {}, thread } = {}) {
    assertTargets(profiles);
    if (profiles.length !== 1 || Object.keys(platforms).length !== 1 || !platforms.instagram) throw new Error('Zernio currently supports one Instagram target per post in Ziggy');
    const params = platforms.instagram;
    if (!['post', 'reel', 'story'].includes(params.format)) throw new Error('unsupported Zernio Instagram format');
    const unsupported = Object.keys(params).filter(k => k !== 'format');
    if (unsupported.length || thread?.length) throw new Error(`unsupported Zernio options: ${unsupported.join(', ') || 'thread'}`);
    if (!media.length) throw new Error('Instagram requires media');
    if (params.format === 'reel' && (media.length !== 1 || !/\.(mp4|mov)(\?|$)/i.test(media[0]))) throw new Error('Zernio reels require one MP4 or MOV video');
  }
  return {
    validateRequest,
    async listProfiles() {
      const r = await request('GET', 'accounts');
      return (r.accounts || []).filter(a => allowed.has(a._id)).map(a => ({ id: a._id, platform: a.platform, name: a.username || a.displayName || a._id,
        status: a.isActive === false ? 'inactive' : 'active', profile_group_id: a.profileId?._id || a.profileId }));
    },
    getPost,
    async createPost({ body = '', profiles, media = [], platforms = {}, draft = false, scheduledAt, thread } = {}) {
      validateRequest({ profiles, media, platforms, thread });
      const params = platforms.instagram;
      const mediaItems = [];
      const fingerprints = [];
      for (const path of media) {
        const hash = createHash('sha256');
        if (/^https:\/\//i.test(path)) hash.update(path);
        else for await (const chunk of createReadStream(path)) hash.update(chunk);
        fingerprints.push(hash.digest('hex'));
        mediaItems.push({ url: await upload(path), type: /\.(mp4|mov)(\?|$)/i.test(path) ? 'video' : 'image' });
      }
      const platformSpecificData = params.format === 'story' ? { contentType: 'story' } : {};
      const payload = { content: body, platforms: [{ platform: 'instagram', accountId: profiles[0], platformSpecificData }], mediaItems,
        isDraft: draft, ...(!draft ? scheduledAt ? { scheduledFor: scheduledAt } : { publishNow: true } : {}) };
      const fingerprint = JSON.stringify({ body, profiles, media: fingerprints, format: params.format, draft, scheduledAt });
      const key = `ziggy-${createHash('sha256').update(fingerprint).digest('hex')}`;
      const p = normalizeZernioPost((await request('POST', 'posts', payload, { 'Idempotency-Key': key })).post);
      assertTargets(p.platforms.map(a => a.profile_id));
      return p;
    },
    async publishPost(id) {
      const p = await getPost(id);
      if (p.status !== 'draft') throw new Error(`Zernio post ${id} is ${p.status}, not draft; refusing duplicate publication`);
      return normalizeZernioPost((await request('PUT', `posts/${encodeURIComponent(id)}`, { isDraft: false, publishNow: true })).post);
    },
    async deletePost(id) {
      const p = await getPost(id);
      if (!['draft', 'scheduled'].includes(p.status)) throw new Error('only drafts and scheduled posts can be deleted through Ziggy');
      return request('DELETE', `posts/${encodeURIComponent(id)}`);
    },
    async reschedulePost(id, when) {
      const p = await getPost(id);
      if (!['draft', 'scheduled'].includes(p.status)) throw new Error('only drafts and scheduled posts can be rescheduled');
      if (!Number.isFinite(Date.parse(when)) || Date.parse(when) <= Date.now()) throw new Error('schedule must be a future ISO timestamp');
      return normalizeZernioPost((await request('PUT', `posts/${encodeURIComponent(id)}`, { isDraft: false, scheduledFor: when })).post);
    },
  };
}
