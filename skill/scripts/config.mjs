/**
 * Ziggy home, tenants and campaigns.
 *
 * Two layers, deliberately separate:
 *
 *   repo:     tenants/<slug>/{tenant.json, brand.json, campaigns/<name>/campaign.json}
 *             the versioned, non-secret definition of a tenant — what the brand looks like,
 *             what each campaign says. Ships with the repo so a tenant can be reproduced anywhere.
 *
 *   ~/.ziggy: config.json (defaults, repo path), tenants/<slug>/ (work dir: fonts, assets,
 *             HyperFrames projects, renders, posts.jsonl). Rebuildable; never committed.
 *
 * Secrets live in neither. They live in hush, by name (see secrets.mjs).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, chmodSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export const SLUG_RE = /^[a-z][a-z0-9-]{1,40}$/;

export function ziggyHome() {
  return resolve(process.env.ZIGGY_HOME || join(homedir(), ".ziggy"));
}

/** The repo root (holds tenants/). Resolution: $ZIGGY_REPO → config.json.repo → the installed copy's own repo. */
export function repoRoot(config = loadConfig()) {
  if (process.env.ZIGGY_REPO) return resolve(process.env.ZIGGY_REPO);
  if (config.repo) return resolve(config.repo);
  // skill/scripts/ → repo root, when running from a checkout
  const fromCheckout = resolve(HERE, "..", "..");
  if (existsSync(join(fromCheckout, "tenants"))) return fromCheckout;
  return join(ziggyHome(), "repo");
}

export function configPath() {
  return join(ziggyHome(), "config.json");
}

export function loadConfig() {
  const p = configPath();
  if (!existsSync(p)) return { version: 1 };
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch (error) {
    throw new Error(`config.json is not valid JSON (${p}): ${error.message}`);
  }
}

export function saveConfig(config) {
  mkdirSync(ziggyHome(), { recursive: true, mode: 0o700 });
  writeFileSync(configPath(), JSON.stringify({ version: 1, ...config }, null, 2) + "\n");
  chmodSync(configPath(), 0o600);
  return configPath();
}

export function assertSlug(slug) {
  if (!SLUG_RE.test(slug || "")) {
    throw new Error(`tenant slug must match ${SLUG_RE} (got ${JSON.stringify(slug)})`);
  }
  return slug;
}

/* ── repo-side tenant definition ─────────────────────────────────────────── */

export function tenantDir(slug, config) {
  return join(repoRoot(config), "tenants", assertSlug(slug));
}

export function listTenants(config = loadConfig()) {
  const dir = join(repoRoot(config), "tenants");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, "tenant.json")))
    .map((d) => loadTenant(d.name, config));
}

export function loadTenant(slug, config = loadConfig()) {
  const file = join(tenantDir(slug, config), "tenant.json");
  if (!existsSync(file)) throw new Error(`unknown tenant ${JSON.stringify(slug)} — add it with: ziggy tenant add ${slug} --name "…" --site https://…`);
  const tenant = JSON.parse(readFileSync(file, "utf8"));
  tenant.slug = slug;
  tenant.dir = dirname(file);
  const brandFile = join(tenant.dir, "brand.json");
  tenant.brand = existsSync(brandFile) ? JSON.parse(readFileSync(brandFile, "utf8")) : null;
  return tenant;
}

export function saveTenant(slug, tenant, config = loadConfig()) {
  const dir = tenantDir(slug, config);
  mkdirSync(join(dir, "campaigns"), { recursive: true });
  const { slug: _s, dir: _d, brand, ...rest } = tenant;
  writeFileSync(join(dir, "tenant.json"), JSON.stringify(rest, null, 2) + "\n");
  if (brand) writeFileSync(join(dir, "brand.json"), JSON.stringify(brand, null, 2) + "\n");
  return dir;
}

export function saveBrand(slug, brand, config = loadConfig()) {
  const dir = tenantDir(slug, config);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "brand.json");
  writeFileSync(file, JSON.stringify(brand, null, 2) + "\n");
  return file;
}

export function listCampaigns(slug, config = loadConfig()) {
  const dir = join(tenantDir(slug, config), "campaigns");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, "campaign.json")))
    .map((d) => d.name);
}

export function loadCampaign(slug, name, config = loadConfig()) {
  const file = join(tenantDir(slug, config), "campaigns", name, "campaign.json");
  if (!existsSync(file)) throw new Error(`unknown campaign ${JSON.stringify(name)} for tenant ${slug} (expected ${file})`);
  const campaign = JSON.parse(readFileSync(file, "utf8"));
  campaign.name = name;
  campaign.dir = dirname(file);
  return campaign;
}

export function saveCampaign(slug, name, campaign, config = loadConfig()) {
  const dir = join(tenantDir(slug, config), "campaigns", name);
  mkdirSync(dir, { recursive: true });
  const { name: _n, dir: _d, ...rest } = campaign;
  writeFileSync(join(dir, "campaign.json"), JSON.stringify(rest, null, 2) + "\n");
  return dir;
}

/* ── ~/.ziggy work dir per tenant ────────────────────────────────────────── */

export function workDir(slug, ...parts) {
  const dir = join(ziggyHome(), "tenants", assertSlug(slug), ...parts);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function fontsDir(slug) {
  return workDir(slug, "brand", "fonts");
}

export function assetsDir(slug) {
  return workDir(slug, "assets");
}

export function videosDir(slug, campaign) {
  return workDir(slug, "videos", campaign);
}

export function rendersDir(slug, campaign) {
  return workDir(slug, "renders", campaign);
}

/** Append-only publish log: one JSON line per Postproxy post created or published. */
export function logPost(slug, record) {
  const file = join(workDir(slug), "posts.jsonl");
  appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...record }) + "\n");
  return file;
}

export function readPostLog(slug) {
  const file = join(workDir(slug), "posts.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

/**
 * One record per post we created: the log also holds `event` lines (publish, delete,
 * reschedule) for the same ids, which carry no campaign and must not count as posts.
 */
export function readCreatedPosts(slug) {
  const seen = new Set();
  return readPostLog(slug).filter((r) => r.postId && !r.event && !seen.has(r.postId) && seen.add(r.postId));
}

/** hush secret name for a tenant's Postproxy key: letters, digits, '.', '_', '-' only. */
export function postproxySecretName(slug) {
  return `ziggy.${assertSlug(slug)}.postproxy`;
}
