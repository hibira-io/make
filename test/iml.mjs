// A small stand-in for Make's IML, enough to run this app's communication
// code in Node: {{expressions}} with + and ==, property access, and the
// built-in functions the app uses. It checks the signing logic against a
// real server; it is not Make, so check a new module in Make as well.
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const fns = {
  md5: (text) => createHash('md5').update(String(text)).digest('hex'),
  sha256: (text, encoding = 'hex', key) =>
    (key === undefined ? createHash('sha256') : createHmac('sha256', String(key))).update(String(text)).digest(encoding),
  createJSON: (v) => JSON.stringify(v),
  formatDate: (d, format) => {
    if (format !== 'X') throw new Error(`formatDate: only 'X' is implemented, got ${format}`);
    return String(Math.floor(d.getTime() / 1000));
  },
  ifempty: (a, b) => (a === undefined || a === null || a === '' ? b : a),
  toArray: (o) => Object.entries(o ?? {}).map(([key, value]) => ({ key, value })),
  indexOf: (s, sub) => String(s ?? '').indexOf(sub),
  __if: (c, a, b) => (c ? a : b),
};

function expr(source, scope) {
  const js = source.replace(/\bif\(/g, '__if(');
  const names = [...Object.keys(fns), ...Object.keys(scope)];
  // eslint-disable-next-line no-new-func
  return new Function(...names, `return (${js});`)(...Object.values(fns), ...Object.values(scope));
}

/** Evaluates IML in a JSON value, dropping keys that come out undefined. */
export function evaluate(value, scope) {
  if (typeof value === 'string') {
    const whole = value.match(/^\{\{([\s\S]*)\}\}$/);
    if (whole && !whole[1].includes('}}')) return expr(whole[1], scope);
    return value.replace(/\{\{([\s\S]*?)\}\}/g, (_, e) => {
      const v = expr(e, scope);
      return v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    });
  }
  if (Array.isArray(value)) return value.map((v) => evaluate(v, scope));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const r = evaluate(v, scope);
      if (r !== undefined) out[k] = r;
    }
    return out;
  }
  return value;
}

const read = (p) => JSON.parse(readFileSync(new URL(`../app/${p}`, import.meta.url), 'utf8'));

/** Runs one communication object the way Make does, for the parts this app uses. */
export async function run(api, { connection, parameters = {}, baseUrl }) {
  const scope = { connection, parameters, now: new Date(), undefined };
  scope.temp = evaluate(api.temp ?? {}, scope);
  const url = evaluate(api.url, scope);
  const qs = evaluate(api.qs ?? {}, scope);
  const headers = evaluate(api.headers ?? {}, scope);
  const method = api.method ?? 'GET';
  let body;
  if (api.body !== undefined) {
    const b = evaluate(api.body, scope);
    body = api.type === 'text' ? String(b) : JSON.stringify(b);
    if (api.type !== 'text') headers['Content-Type'] ??= 'application/json';
  }
  const full = new URL(url.startsWith('/') ? baseUrl + url : url);
  for (const [k, v] of Object.entries(qs)) full.searchParams.set(k, String(v));
  const res = await fetch(full, { method, headers, body });
  const text = await res.text();
  let resBody;
  try {
    resBody = JSON.parse(text);
  } catch {
    resBody = text;
  }
  const rscope = { ...scope, body: resBody, statusCode: res.status };
  if (res.status >= 400) {
    const message = evaluate((api.response?.error ?? read('base.iml.json').response.error).message, rscope);
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return { status: res.status, body: resBody, request: { url: full, body }, output: respond(api.response, rscope) };
}

/** Applies response iterate / limit / output. */
export function respond(response, scope) {
  if (!response?.output) return scope.body;
  if (!response.iterate) return evaluate(response.output, scope);
  const items = evaluate(response.iterate, scope) ?? [];
  const limit = response.limit !== undefined ? Number(evaluate(response.limit, scope)) : Infinity;
  return items.slice(0, limit).map((item) => evaluate(response.output, { ...scope, item }));
}

export function moduleApi(name) {
  return read(`modules/${name}/api.iml.json`);
}

export function connectionApi() {
  return read('connections/hibira/api.iml.json');
}

export function webhookApi() {
  return read('webhooks/events/api.iml.json');
}
