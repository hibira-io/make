// Uploads app/ to a custom app in your Make account with the Make API.
//
//   MAKE_API_TOKEN=... node tools/deploy.mjs            update the app
//   MAKE_API_TOKEN=... node tools/deploy.mjs --create   create it first
//
// MAKE_API_TOKEN: Make > Profile > API access, with the sdk-apps:read and
//   sdk-apps:write scopes.
// MAKE_ZONE: your Make zone, such as eu1.make.com (default) or us1.make.com.
// MAKE_APP_NAME: the app's name in Make when it differs from app/app.json
//   (Make app names are unique, so yours may have a suffix such as hibira-xyz).
//
// Make names connections and webhooks itself; the names it gives are kept
// in .make-ids.json, so later runs update the same ones.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';

const token = process.env.MAKE_API_TOKEN;
if (!token) {
  console.error('Set MAKE_API_TOKEN (Make > Profile > API access, scopes sdk-apps:read and sdk-apps:write).');
  process.exit(1);
}
const zone = process.env.MAKE_ZONE || 'eu1.make.com';
const api = `https://${zone}/api/v2`;
const root = new URL('../app/', import.meta.url);
const text = (p) => readFileSync(new URL(p, root), 'utf8');
const json = (p) => JSON.parse(text(p));
const app = json('app.json');
const name = process.env.MAKE_APP_NAME || app.name;
const version = 1;
const idsFile = new URL(`../.make-ids.json`, import.meta.url);
const ids = existsSync(idsFile) ? JSON.parse(readFileSync(idsFile, 'utf8')) : {};
const mine = (ids[`${zone}/${name}`] ??= { connections: {}, webhooks: {} });
const save = () => writeFileSync(idsFile, JSON.stringify(ids, null, 2) + '\n');

async function call(method, path, body, type = 'application/json') {
  const res = await fetch(api + path, {
    method,
    headers: { Authorization: `Token ${token}`, ...(body !== undefined ? { 'Content-Type': type } : {}) },
    body: body === undefined || typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body),
  });
  const out = await res.text();
  if (res.status === 404 && method === 'GET') return null;
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${out.slice(0, 300)}`);
  try {
    return JSON.parse(out);
  } catch {
    return out;
  }
}
const section = (path, file) => call('PUT', path, text(file), 'application/jsonc');

const exists = await call('GET', `/sdk/apps/${name}/${version}`);
if (!exists) {
  if (!process.argv.includes('--create')) {
    console.error(`No app ${name} in ${zone}. Run with --create, or set MAKE_APP_NAME / MAKE_ZONE.`);
    process.exit(1);
  }
  await call('POST', '/sdk/apps', { name, label: app.label, description: app.description, theme: app.theme, language: app.language, audience: app.audience, private: true });
  console.log(`created app ${name}`);
}

await call('PATCH', `/sdk/apps/${name}/${version}/base`, text('base.iml.json'), 'application/jsonc');
console.log('base');

// Connections and webhooks: one folder each.
for (const local of readdirSync(new URL('connections/', root))) {
  const meta = json(`connections/${local}/connection.json`);
  let remote = mine.connections[local];
  if (!remote || !(await call('GET', `/sdk/apps/connections/${remote}`))) {
    remote = (await call('POST', `/sdk/apps/${name}/connections`, meta)).appConnection.name;
    mine.connections[local] = remote;
    save();
  }
  await section(`/sdk/apps/connections/${remote}/api`, `connections/${local}/api.iml.json`);
  await section(`/sdk/apps/connections/${remote}/parameters`, `connections/${local}/parameters.iml.json`);
  console.log(`connection ${local} -> ${remote}`);
}
for (const local of readdirSync(new URL('webhooks/', root))) {
  const meta = json(`webhooks/${local}/webhook.json`);
  let remote = mine.webhooks[local];
  if (!remote || !(await call('GET', `/sdk/apps/webhooks/${remote}`))) {
    remote = (await call('POST', `/sdk/apps/${name}/webhooks`, { ...meta, connection: mine.connections[meta.connection] })).appWebhook.name;
    mine.webhooks[local] = remote;
    save();
  }
  await section(`/sdk/apps/webhooks/${remote}/api`, `webhooks/${local}/api.iml.json`);
  await section(`/sdk/apps/webhooks/${remote}/parameters`, `webhooks/${local}/parameters.iml.json`);
  console.log(`webhook ${local} -> ${remote}`);
}

for (const module of readdirSync(new URL('modules/', root))) {
  const meta = json(`modules/${module}/module.json`);
  const base = `/sdk/apps/${name}/${version}/modules/${module}`;
  const refs = {
    connection: meta.connection ? mine.connections[meta.connection] : undefined,
    webhook: meta.webhook ? mine.webhooks[meta.webhook] : undefined,
  };
  if (await call('GET', base)) {
    await call('PATCH', base, { label: meta.label, description: meta.description, ...refs });
  } else {
    await call('POST', `/sdk/apps/${name}/${version}/modules`, { name: module, typeId: meta.typeId, label: meta.label, description: meta.description, ...refs });
  }
  for (const s of ['api', 'parameters', 'expect', 'interface', 'samples']) await section(`${base}/${s}`, `modules/${module}/${s}.iml.json`);
  console.log(`module ${module}`);
}

await call('PUT', `/sdk/apps/${name}/${version}/groups`, text('groups.json'), 'application/jsonc');
await call('PUT', `/sdk/apps/${name}/${version}/readme`, text('readme.md'), 'text/markdown');
if (existsSync(new URL('icon.png', root))) await call('PUT', `/sdk/apps/${name}/${version}/icon`, readFileSync(new URL('icon.png', root)), 'image/png');
console.log(`done: open ${app.label} under Custom apps on https://${zone}`);
