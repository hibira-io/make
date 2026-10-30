// Runs the app's modules (through test/iml.mjs) against a real
// Hibira-compatible server, with a pusher-js client on the other side. Needs:
//   HIBIRA_E2E_APP_ID, HIBIRA_E2E_KEY, HIBIRA_E2E_SECRET, HIBIRA_E2E_HOST
//   (HIBIRA_E2E_PORT, HIBIRA_E2E_TLS=false for a local server)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import Pusher from 'pusher-js';
import { run, moduleApi, connectionApi } from './iml.mjs';

const env = process.env;
const skip = ['APP_ID', 'KEY', 'SECRET', 'HOST'].some((k) => !env[`HIBIRA_E2E_${k}`]) && 'set HIBIRA_E2E_APP_ID, _KEY, _SECRET and _HOST';
const tls = env.HIBIRA_E2E_TLS !== 'false';
const port = Number(env.HIBIRA_E2E_PORT || (tls ? 443 : 80));
const baseUrl = `${tls ? 'https' : 'http'}://${env.HIBIRA_E2E_HOST}:${port}`;
const connection = { appId: env.HIBIRA_E2E_APP_ID, key: env.HIBIRA_E2E_KEY, secret: env.HIBIRA_E2E_SECRET, baseUrl };
const call = (name, parameters) => run(moduleApi(name), { connection, baseUrl, parameters });

const until = (fn, what, ms = 5000) =>
  new Promise((resolve, reject) => {
    const start = Date.now();
    const poll = () => (fn() ? resolve() : Date.now() - start > ms ? reject(new Error(`timed out: ${what}`)) : setTimeout(poll, 25));
    poll();
  });

test('modules against the server', { skip }, async () => {
  // Connection test, then with a wrong secret.
  assert.equal((await run(connectionApi(), { connection, baseUrl, parameters: connection })).status, 200);
  await assert.rejects(run(connectionApi(), { connection, baseUrl, parameters: { ...connection, secret: 'wrong' } }), /^Error: \[401\] /);

  const id = Math.random().toString(36).slice(2, 8);
  const room = `presence-make-${id}`;
  const pusher = new Pusher(env.HIBIRA_E2E_KEY, {
    cluster: 'hkg',
    wsHost: env.HIBIRA_E2E_HOST,
    wsPort: port,
    wssPort: port,
    forceTLS: tls,
    enabledTransports: ['ws'],
    channelAuthorization: {
      customHandler: ({ socketId, channelName }, cb) => {
        const channel_data = JSON.stringify({ user_id: 'u-42', user_info: { name: 'Ann' } });
        const sig = createHmac('sha256', env.HIBIRA_E2E_SECRET).update(`${socketId}:${channelName}:${channel_data}`).digest('hex');
        cb(null, { auth: `${env.HIBIRA_E2E_KEY}:${sig}`, channel_data });
      },
    },
  });
  after(() => pusher.disconnect());
  const got = [];
  const pub = pusher.subscribe(`make-${id}`);
  pub.bind('order-shipped', (d) => got.push(d));
  const pres = pusher.subscribe(room);
  await until(() => pub.subscribed && pres.subscribed, 'subscribed');

  const sent = await call('triggerEvent', { channels: [`make-${id}`], event: 'order-shipped', data: JSON.stringify({ id: 42, city: '東京' }) });
  assert.equal(sent.output.sent, true);
  await until(() => got.length, 'event');
  assert.deepEqual(got[0], { id: 42, city: '東京' });

  const ch = await call('getChannel', { channel: room });
  assert.deepEqual(ch.output, { name: room, occupied: true, subscriptionCount: 1, userCount: 1 });
  const plain = await call('getChannel', { channel: `make-${id}` });
  assert.equal(plain.output.occupied, true);

  const listed = await call('listChannels', { prefix: `presence-make-${id}` });
  assert.deepEqual(listed.output, [{ name: room, userCount: 1 }]);
  const any = await call('listChannels', {});
  assert.ok(any.output.some((c) => c.name === `make-${id}`));

  const users = await call('listUsers', { channel: room });
  assert.deepEqual(users.output, [{ id: 'u-42' }]);
});
