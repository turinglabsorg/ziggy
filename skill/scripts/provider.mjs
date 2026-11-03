import { loadTenant } from './config.mjs';
import { createClient as postproxyClient } from './postproxy.mjs';
import { createZernioClient } from './zernio.mjs';

export function providerName(tenant) {
  const name = tenant.publishing?.provider || 'postproxy';
  if (!['postproxy', 'zernio'].includes(name)) throw new Error(`unknown publishing provider: ${name}`);
  return name;
}

export function providerKey(slug) {
  const tenant = loadTenant(slug);
  const provider = providerName(tenant);
  return {
    provider,
    env: provider === 'zernio' ? 'ZERNIO_API_KEY' : 'POSTPROXY_API_KEY',
    name: provider === 'zernio' ? tenant.zernio?.secretName || `ziggy.${slug}.zernio` : `ziggy.${slug}.postproxy`,
  };
}

export function createPublishingClient(tenant) {
  return providerName(tenant) === 'zernio' ? createZernioClient({ accountIds: tenant.zernio?.accountIds }) : postproxyClient();
}
