// Checks the app's files and runs its code with test/iml.mjs, offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash, createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { evaluate, run, respond, moduleApi, webhookApi } from './iml.mjs';

const dir = new URL('../app/', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, dir), 'utf8'));
const modules = readdirSync(new URL('modules/', dir));
const SECTIONS = ['module.json', 'api.iml.json', 'parameters.iml.json', 'expect.iml.json', 'interface.iml.json', 'samples.iml.json'];

test('every module has its files, and groups list every module once', () => {
  for (const m of modules) for (const f of SECTIONS) assert.ok(existsSync(new URL(`modules/${m}/${f}`, dir)), `${m}/${f}`);
  const grouped = read('groups.json').flatMap((g) => g.modules);
  assert.deepEqual([...grouped].sort(), [...modules].sort());
});

test('module outputs match their interfaces and samples', () => {
  for (const m of modules) {
    const api = read(`modules/${m}/api.iml.json`);
    const names = read(`modules/${m}/interface.iml.json`).map((f) => f.name);
    const output = m === 'watchEvents' ? read('webhooks/events/api.iml.json').output : api.response?.output;
    assert.ok(output, `${m} has an output`);
    assert.deepEqual(Object.keys(output).sort(), [...names].sort(), m);
    for (const k of Object.keys(read(`modules/${m}/samples.iml.json`))) assert.ok(names.includes(k), `${m} sample ${k}`);
  }
});

test('the secret is a password field and never sent', () => {
  const params = read('connections/hibira/parameters.iml.json');
  assert.equal(params.find((p) => p.name === 'secret').type, 'password');
  for (const m of modules) {
    const text = readFileSync(new URL(`modules/${m}/api.iml.json`, dir), 'utf8');
    for (const [, e] of text.matchAll(/\{\{([^}]*connection\.secret[^}]*)\}\}/g)) assert.match(e, /^sha256\(.*, 'hex', connection\.secret\)$/, m);
  }
});

// A server that records the request and answers like the HTTP API.
async function capture(answer = {}) {
  const seen = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    seen.push({ method: req.method, url: new URL(req.url, 'http://x'), body, headers: req.headers });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(answer));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { seen, baseUrl: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

const connection = { appId: '3', key: '278d425bdf160c739803', secret: '7ad3773142a6692b25b8', baseUrl: '' };

function expected(method, path, query, secret) {
  const q = [...query.entries()].filter(([k]) => k !== 'auth_signature').sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&');
  return createHmac('sha256', secret).update(`${method}\n${path}\n${q}`).digest('hex');
}

test('Trigger an event: JSON body, body_md5 and signature', async () => {
  const s = await capture({});
  try {
    const r = await run(moduleApi('triggerEvent'), {
      connection: { ...connection, baseUrl: s.baseUrl },
      baseUrl: s.baseUrl,
      parameters: { channels: ['orders', 'private-user-1'], event: 'order-shipped', data: '{"id":42,"name":"東京"}' },
    });
    const req = s.seen[0];
    assert.equal(req.method, 'POST');
    assert.equal(req.url.pathname, '/apps/3/events');
    assert.equal(req.headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(req.body), { name: 'order-shipped', channels: ['orders', 'private-user-1'], data: '{"id":42,"name":"東京"}' });
    assert.equal(req.url.searchParams.get('body_md5'), createHash('md5').update(req.body).digest('hex'));
    assert.ok(Math.abs(Number(req.url.searchParams.get('auth_timestamp')) - Date.now() / 1000) < 5);
    assert.equal(req.url.searchParams.get('auth_signature'), expected('POST', '/apps/3/events', req.url.searchParams, connection.secret));
    assert.deepEqual(r.output, { channels: ['orders', 'private-user-1'], event: 'order-shipped', sent: true });
  } finally {
    s.close();
  }
});

test('List occupied channels: optional prefix and info are signed when sent', async () => {
  const s = await capture({ channels: { 'presence-room-1': { user_count: 2 }, 'presence-room-2': { user_count: 1 } } });
  try {
    const opts = { connection: { ...connection, baseUrl: s.baseUrl }, baseUrl: s.baseUrl };
    const all = await run(moduleApi('listChannels'), { ...opts, parameters: {} });
    const some = await run(moduleApi('listChannels'), { ...opts, parameters: { prefix: 'presence-room-', limit: 1 } });
    const [a, b] = s.seen;
    assert.equal(a.url.searchParams.has('filter_by_prefix'), false);
    assert.equal(a.url.searchParams.has('info'), false);
    assert.equal(a.url.searchParams.get('auth_signature'), expected('GET', '/apps/3/channels', a.url.searchParams, connection.secret));
    assert.equal(b.url.searchParams.get('filter_by_prefix'), 'presence-room-');
    assert.equal(b.url.searchParams.get('info'), 'user_count');
    assert.equal(b.url.searchParams.get('auth_signature'), expected('GET', '/apps/3/channels', b.url.searchParams, connection.secret));
    assert.equal(all.output.length, 2);
    assert.deepEqual(some.output, [{ name: 'presence-room-1', userCount: 2 }]);
  } finally {
    s.close();
  }
});

test('Get a channel asks user_count only for presence channels', async () => {
  const s = await capture({ occupied: true, subscription_count: 3 });
  try {
    const opts = { connection: { ...connection, baseUrl: s.baseUrl }, baseUrl: s.baseUrl };
    await run(moduleApi('getChannel'), { ...opts, parameters: { channel: 'orders' } });
    await run(moduleApi('getChannel'), { ...opts, parameters: { channel: 'presence-room-1' } });
    assert.equal(s.seen[0].url.searchParams.get('info'), 'subscription_count');
    assert.equal(s.seen[1].url.searchParams.get('info'), 'subscription_count,user_count');
    for (const r of s.seen) assert.equal(r.url.searchParams.get('auth_signature'), expected('GET', r.url.pathname, r.url.searchParams, connection.secret));
  } finally {
    s.close();
  }
});

test('Make an API call signs the path, sorted query and body_md5', async () => {
  const s = await capture({ channels: {} });
  try {
    const opts = { connection: { ...connection, baseUrl: s.baseUrl }, baseUrl: s.baseUrl };
    const get = await run(moduleApi('makeApiCall'), { ...opts, parameters: { url: '/channels', method: 'GET', query: 'info=user_count&filter_by_prefix=presence-' } });
    const body = '{"name":"e","channels":["orders"],"data":"{}"}';
    await run(moduleApi('makeApiCall'), { ...opts, parameters: { url: '/events', method: 'POST', body } });
    const [a, b] = s.seen;
    assert.equal(a.method, 'GET');
    assert.equal(a.url.pathname, '/apps/3/channels');
    assert.equal(a.url.searchParams.get('filter_by_prefix'), 'presence-');
    assert.equal(a.url.searchParams.has('body_md5'), false);
    assert.equal(a.url.searchParams.get('auth_signature'), expected('GET', '/apps/3/channels', a.url.searchParams, connection.secret));
    assert.equal(get.output.statusCode, 200);
    assert.deepEqual(get.output.body, { channels: {} });
    assert.equal(b.method, 'POST');
    assert.equal(b.body, body);
    assert.equal(b.headers['content-type'], 'application/json');
    assert.equal(b.url.searchParams.get('body_md5'), createHash('md5').update(body).digest('hex'));
    assert.equal(b.url.searchParams.get('auth_signature'), expected('POST', '/apps/3/events', b.url.searchParams, connection.secret));
  } finally {
    s.close();
  }
});

test('the webhook makes one bundle per event', () => {
  const body = {
    time_ms: 1793260000000,
    events: [
      { name: 'channel_occupied', channel: 'orders' },
      { name: 'member_added', channel: 'presence-room-1', user_id: '42' },
      { name: 'client_event', channel: 'private-x', event: 'client-typing', data: '{}', socket_id: '1.2', user_id: '7' },
    ],
  };
  const api = webhookApi();
  const bundles = respond(api, { body });
  assert.equal(bundles.length, 3);
  assert.equal(bundles[1].userId, '42');
  assert.equal(bundles[2].event, 'client-typing');
  assert.equal(bundles[0].timeMs, 1793260000000);
  assert.deepEqual(evaluate(api.respond, {}), { status: 200, body: { ok: true } });
});
