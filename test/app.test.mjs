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
  assert.equal(bundles[0].time.toISOString(), '2026-10-29T07:46:40.000Z');
  assert.deepEqual(evaluate(api.respond, {}), { status: 200, body: { ok: true } });
});

test('Request an approval: JSON body, push target, body_md5 and signature', async () => {
  const s = await capture({ approval_id: 'apr_1', status: 'pending', title: 'Ship?', options: ['Ship', 'Hold'], url: 'https://hibira.io/approve/apr_1/t' });
  try {
    const opts = { connection: { ...connection, baseUrl: s.baseUrl }, baseUrl: s.baseUrl };
    const r = await run(moduleApi('requestApproval'), { ...opts, parameters: { title: 'Ship?', options: ['Ship', 'Hold'], pushTarget: 'users', pushTo: ['u1'] } });
    const req = s.seen[0];
    assert.equal(req.method, 'POST');
    assert.equal(req.url.pathname, '/apps/3/approvals');
    const body = JSON.parse(req.body);
    assert.deepEqual(body.options, ['Ship', 'Hold']);
    assert.deepEqual(body.push_users, ['u1']);
    assert.equal(body.push_interests, null);
    assert.equal(body.agent, 'Make');
    assert.equal(body.expires_in_minutes, 60);
    assert.equal(req.url.searchParams.get('body_md5'), createHash('md5').update(req.body).digest('hex'));
    assert.equal(req.url.searchParams.get('auth_signature'), expected('POST', '/apps/3/approvals', req.url.searchParams, connection.secret));
    assert.equal(r.output.approvalId, 'apr_1');
    assert.equal(r.output.approved, false);
    assert.equal(r.output.url, 'https://hibira.io/approve/apr_1/t');
  } finally {
    s.close();
  }
});

test('Get an approval signs the wait parameter', async () => {
  const s = await capture({ approval_id: 'apr_1', status: 'approved', choice: 'Ship' });
  try {
    const opts = { connection: { ...connection, baseUrl: s.baseUrl }, baseUrl: s.baseUrl };
    const r = await run(moduleApi('getApproval'), { ...opts, parameters: { approvalId: 'apr_1', wait: 25 } });
    await run(moduleApi('getApproval'), { ...opts, parameters: { approvalId: 'apr_1' } });
    const [a, b] = s.seen;
    assert.equal(a.url.pathname, '/apps/3/approvals/apr_1');
    assert.equal(a.url.searchParams.get('wait'), '25');
    assert.equal(b.url.searchParams.get('wait'), '0');
    for (const q of [a, b]) assert.equal(q.url.searchParams.get('auth_signature'), expected('GET', '/apps/3/approvals/apr_1', q.url.searchParams, connection.secret));
    assert.equal(r.output.approved, true);
    assert.equal(r.output.choice, 'Ship');
  } finally {
    s.close();
  }
});

test('Send a push notification uses the Push connection and one target list', async () => {
  const s = await capture({ publishId: 'pub-1' });
  try {
    const push = { instanceId: 'inst-1', primaryKey: 'push-key', baseUrl: s.baseUrl };
    const r = await run(moduleApi('sendPushNotification'), { connection: push, baseUrl: s.baseUrl, parameters: { target: 'interests', to: ['orders'], title: 'Shipped', body: 'Order #42 is on its way', link: 'https://example.jp/o/42' } });
    const req = s.seen[0];
    assert.equal(req.url.pathname, '/publish_api/v1/instances/inst-1/publishes/interests');
    assert.equal(req.headers.authorization, 'Bearer push-key');
    const body = JSON.parse(req.body);
    assert.deepEqual(body.interests, ['orders']);
    assert.equal(body.users, null);
    assert.deepEqual(body.web.notification, { title: 'Shipped', body: 'Order #42 is on its way', deep_link: 'https://example.jp/o/42' });
    assert.deepEqual(body.apns.aps.alert, { title: 'Shipped', body: 'Order #42 is on its way' });
    assert.deepEqual(r.output, { publishId: 'pub-1', target: 'interests', to: ['orders'] });
  } finally {
    s.close();
  }
});

test('the push secret key is a password field', () => {
  const params = read('connections/hibiraPush/parameters.iml.json');
  assert.equal(params.find((p) => p.name === 'primaryKey').type, 'password');
});

const ROOM = { room: 'presale', title: 'Drop', state: 'open', waiting: 5, admitted: 10, issued: 15, admit_per_minute: 50, burst: 50, pass_ttl_seconds: 1800, return_urls: [], channel: 'hibira-waitroom-presale' };

test('Waiting rooms: get, create or update, admit and verify are signed', async () => {
  const s = await capture(ROOM);
  try {
    const opts = { connection: { ...connection, baseUrl: s.baseUrl }, baseUrl: s.baseUrl };
    const got = await run(moduleApi('getWaitingRoom'), { ...opts, parameters: { room: 'presale' } });
    await run(moduleApi('updateWaitingRoom'), { ...opts, parameters: { room: 'presale', admitPerMinute: 50, state: 'paused', startsAt: '2026-12-04T03:00:00.000Z', returnUrls: ['https://shop.example.com/drop'] } });
    await run(moduleApi('updateWaitingRoom'), { ...opts, parameters: { room: 'presale', state: '' } });
    await run(moduleApi('admitWaitingRoom'), { ...opts, parameters: { room: 'presale', count: 100 } });
    await run(moduleApi('verifyWaitingRoomPass'), { ...opts, parameters: { room: 'presale', pass: 'abc.def' } });
    const [get, create, update, admit, verify] = s.seen;
    assert.equal(get.method, 'GET');
    assert.equal(get.url.pathname, '/apps/3/waiting_rooms/presale');
    assert.deepEqual(JSON.parse(create.body), { admit_per_minute: 50, state: 'paused', starts_at: '2026-12-04T03:00:00.000Z', title: null, burst: null, pass_ttl_seconds: null, return_urls: ['https://shop.example.com/drop'] });
    assert.ok(Object.values(JSON.parse(update.body)).every((v) => v === null), 'empty fields are left unchanged');
    assert.equal(admit.url.pathname, '/apps/3/waiting_rooms/presale/admit');
    assert.deepEqual(JSON.parse(admit.body), { count: 100 });
    assert.equal(verify.url.pathname, '/apps/3/waiting_rooms/presale/verify');
    assert.deepEqual(JSON.parse(verify.body), { pass: 'abc.def' });
    for (const r of s.seen) {
      if (r.method === 'POST') assert.equal(r.url.searchParams.get('body_md5'), createHash('md5').update(r.body).digest('hex'));
      assert.equal(r.url.searchParams.get('auth_signature'), expected(r.method, r.url.pathname, r.url.searchParams, connection.secret));
    }
    assert.equal(got.output.waiting, 5);
    assert.equal(got.output.admitPerMinute, 50);
    assert.equal(got.output.channel, 'hibira-waitroom-presale');
  } finally {
    s.close();
  }
});

test('Verify a waiting room pass outputs the claims', async () => {
  const s = await capture({ valid: true, number: 42, ticket_id: 'd79fe789a38b8631b5', expires_at: '2027-01-15T08:30:00Z' });
  try {
    const r = await run(moduleApi('verifyWaitingRoomPass'), { connection: { ...connection, baseUrl: s.baseUrl }, baseUrl: s.baseUrl, parameters: { room: 'presale', pass: 'x.y' } });
    assert.deepEqual(r.output, { room: 'presale', valid: true, number: 42, ticketId: 'd79fe789a38b8631b5', expiresAt: '2027-01-15T08:30:00Z' });
  } finally {
    s.close();
  }
});
