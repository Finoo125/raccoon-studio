// node --test runpod/proxy.test.mjs
//
// Spawns the real proxy.mjs against stub upstreams, so the shipped entry point
// is what gets exercised — bind, env parsing and all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const PROXY = fileURLToPath(new URL('./proxy.mjs', import.meta.url));
const SECRET = 'test-secret-do-not-use';
const PASS = 'hunter2';
const USER = 'raccoon';

const freePort = () =>
  new Promise((res) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
  });

const listen = (server, port) => new Promise((res) => server.listen(port, '127.0.0.1', res));

/** Stub Next: echoes what it was asked for. Stub ComfyUI: accepts any upgrade. */
async function upstreams(nextPort, comfyPort) {
  const seen = { ws: [] };
  const next = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ upstream: 'next', url: req.url, method: req.method }));
  });
  const comfy = http.createServer((_, res) => { res.writeHead(200); res.end('comfy'); });
  comfy.on('upgrade', (req, sock) => {
    seen.ws.push(req.url);
    sock.on('error', () => {}); // the client destroys the socket the moment it has the status line
    const key = req.headers['sec-websocket-key'] || '';
    sock.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${crypto
          .createHash('sha1')
          .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
          .digest('base64')}\r\n\r\n`,
    );
  });
  await listen(next, nextPort);
  await listen(comfy, comfyPort);
  return { seen, close: () => { next.close(); comfy.close(); } };
}

/** Boot the proxy, run fn, always tear down. */
async function withProxy(env, fn) {
  const [port, nextPort, comfyPort] = [await freePort(), await freePort(), await freePort()];
  const up = await upstreams(nextPort, comfyPort);
  const child = spawn(process.execPath, [PROXY], {
    env: {
      ...process.env,
      RACCOON_PROXY_PORT: String(port),
      RACCOON_NEXT_PORT: String(nextPort),
      RACCOON_COMFY_PORT: String(comfyPort),
      RACCOON_USERNAME: USER,
      RACCOON_PASSWORD: PASS,
      RACCOON_SESSION_SECRET: SECRET,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Kept because the credential banner is printed AFTER "listening", so tests
  // that read it need the whole stream, not just the readiness line.
  let stdout = '';
  child.stdout.on('data', (d) => { stdout += d; });
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('proxy did not start')), 10000);
    child.stdout.on('data', (d) => { if (String(d).includes('listening')) { clearTimeout(t); res(); } });
    child.on('exit', (c) => { clearTimeout(t); rej(new Error('proxy exited ' + c)); });
  });
  const base = `http://127.0.0.1:${port}`;
  const awaitLog = async (needle, ms = 5000) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (stdout.includes(needle)) return stdout;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`log never contained ${needle}:\n${stdout}`);
  };
  try { return await fn({ base, port, seen: up.seen, awaitLog }); }
  finally { child.kill(); up.close(); }
}

const get = (base, path, headers = {}) =>
  fetch(base + path, { headers, redirect: 'manual' });

const login = (base, username, password, headers = {}) =>
  fetch(base + '/login', {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams({ username, password }),
  });

const cookieFrom = (res) => (res.headers.get('set-cookie') || '').split(';')[0];

const mint = (msFromNow) => {
  const expiry = Date.now() + msFromNow;
  return `${expiry}.${crypto.createHmac('sha256', SECRET).update(String(expiry)).digest('hex')}`;
};

/** Raw upgrade handshake — the WHATWG WebSocket client cannot set a Cookie header. */
const upgrade = (port, path, cookie) =>
  new Promise((resolve) => {
    const sock = net.connect(port, '127.0.0.1', () => {
      sock.write(
        `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\n` +
          'Connection: Upgrade\r\nSec-WebSocket-Version: 13\r\n' +
          `Sec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\n` +
          (cookie ? `Cookie: ${cookie}\r\n` : '') +
          'Origin: https://evil.example\r\n\r\n',
      );
    });
    let buf = '';
    sock.on('data', (c) => {
      buf += c;
      if (buf.includes('\r\n\r\n')) { sock.destroy(); resolve(buf.split('\r\n')[0]); }
    });
    sock.on('error', () => resolve('ERROR'));
    sock.setTimeout(5000, () => { sock.destroy(); resolve('TIMEOUT'); });
  });

// ---------------------------------------------------------------------------

test('no cookie redirects a page request to /login', () =>
  withProxy({}, async ({ base }) => {
    const r = await get(base, '/');
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/login');
  }));

test('unauthenticated /api/* answers 401, not a redirect', () =>
  withProxy({}, async ({ base }) => {
    const r = await get(base, '/api/settings');
    assert.equal(r.status, 401, 'a fetch() redirected to HTML surfaces as a JSON parse error');
    assert.equal(JSON.parse(await r.text()).error, 'unauthorized');
  }));

test('the login page itself is reachable without a cookie', () =>
  withProxy({}, async ({ base }) => {
    const r = await get(base, '/login');
    assert.equal(r.status, 200);
    assert.match(await r.text(), /Raccoon Studio/);
  }));

test('wrong password is rejected and mints no cookie', () =>
  withProxy({}, async ({ base }) => {
    const r = await login(base, USER, 'wrong');
    assert.equal(r.status, 401);
    assert.equal(r.headers.get('set-cookie'), null);
  }));

test('wrong username is rejected too', () =>
  withProxy({}, async ({ base }) => {
    assert.equal((await login(base, 'admin', PASS)).status, 401);
  }));

test('correct password mints a cookie, and the next request is proxied', () =>
  withProxy({}, async ({ base }) => {
    const r = await login(base, USER, PASS);
    assert.equal(r.status, 302);
    const raw = r.headers.get('set-cookie');
    assert.match(raw, /HttpOnly/);
    assert.match(raw, /SameSite=Lax/);
    assert.match(raw, /Secure/, 'RunPod terminates TLS, so Secure must not be gated on req.encrypted');

    const proxied = await get(base, '/api/settings', { cookie: cookieFrom(r) });
    assert.equal(proxied.status, 200);
    assert.deepEqual(await proxied.json(), { upstream: 'next', url: '/api/settings', method: 'GET' });
  }));

test('a tampered cookie signature is rejected', () =>
  withProxy({}, async ({ base }) => {
    const good = mint(60_000);
    const bad = good.slice(0, -1) + (good.endsWith('a') ? 'b' : 'a');
    assert.equal((await get(base, '/', { cookie: `rs_session=${bad}` })).status, 302);
  }));

test('a cookie with a forged expiry is rejected', () =>
  withProxy({}, async ({ base }) => {
    const [, mac] = mint(60_000).split('.');
    const forged = `${Date.now() + 999_999_999}.${mac}`;
    assert.equal((await get(base, '/', { cookie: `rs_session=${forged}` })).status, 302);
  }));

test('an expired cookie is rejected even though its signature is valid', () =>
  withProxy({}, async ({ base }) => {
    assert.equal((await get(base, '/', { cookie: `rs_session=${mint(-1000)}` })).status, 302);
  }));

test('logout clears the cookie', () =>
  withProxy({}, async ({ base }) => {
    const r = await fetch(base + '/logout', { redirect: 'manual', headers: { cookie: `rs_session=${mint(60_000)}` } });
    assert.equal(r.status, 302);
    assert.match(r.headers.get('set-cookie'), /Max-Age=0/);
  }));

test('a websocket upgrade without a valid cookie is refused', () =>
  withProxy({}, async ({ port, seen }) => {
    assert.match(await upgrade(port, '/comfy-ws?clientId=x', null), /401/);
    assert.deepEqual(seen.ws, [], 'the upgrade must never reach ComfyUI');
  }));

test('an authenticated upgrade reaches ComfyUI at /ws with the query preserved', () =>
  withProxy({}, async ({ port, seen }) => {
    assert.match(await upgrade(port, '/comfy-ws?clientId=abc123', `rs_session=${mint(60_000)}`), /101/);
    assert.deepEqual(seen.ws, ['/ws?clientId=abc123'], 'clientId must survive or ComfyUI cannot route events back');
  }));

test('an upgrade on any other path is refused', () =>
  withProxy({}, async ({ port, seen }) => {
    assert.match(await upgrade(port, '/ws?clientId=x', `rs_session=${mint(60_000)}`), /404/);
    assert.deepEqual(seen.ws, []);
  }));

test('repeated failures from one x-forwarded-for lock that IP out', () =>
  withProxy({}, async ({ base }) => {
    const ip = { 'x-forwarded-for': '203.0.113.9' };
    for (let i = 0; i < 8; i++) assert.equal((await login(base, USER, 'wrong', ip)).status, 401);
    const locked = await login(base, USER, PASS, ip);
    assert.equal(locked.status, 429, 'the correct password must not bypass the lockout');
    // a different IP is unaffected — the whole internet must not share one bucket
    assert.equal((await login(base, USER, PASS, { 'x-forwarded-for': '198.51.100.4' })).status, 302);
  }));

test('rotating x-forwarded-for is still stopped by the global counter', () =>
  withProxy({}, async ({ base }) => {
    for (let i = 0; i < 50; i++) {
      await login(base, USER, 'wrong', { 'x-forwarded-for': `198.51.100.${i % 200}.` });
    }
    const r = await login(base, USER, PASS, { 'x-forwarded-for': '203.0.113.77' });
    assert.equal(r.status, 429, 'a forged header must not buy unlimited guesses');
  }));

// RunPod DROPS empty env values when a template is created, so shipping
// RACCOON_PASSWORD="" leaves no field in the deploy form for a user to fill in.
// The public template ships a visible placeholder instead — which must never be
// accepted as a password, or every pod deployed from it would share one.
for (const [label, value] of [
  ['unset', ''],
  ['only whitespace', '   '],
  ['the placeholder', 'change-me'],
  ['a padded, upper-case placeholder', '  CHANGE_ME  '],
  ['an angle-bracket placeholder', '<your password>'],
]) {
  test(`RACCOON_PASSWORD ${label}: a random password is generated, and the placeholder itself is refused`, () =>
    withProxy({ RACCOON_PASSWORD: value }, async ({ base, awaitLog }) => {
      const out = await awaitLog('generated one:');
      // The password line of the banner box: '│' then exactly six spaces.
      const printed = out.match(/│ {6}(\S+)/)?.[1];
      assert.ok(printed && printed.length >= 8, `no password in the banner:\n${out}`);

      const good = await login(base, USER, printed);
      assert.match(cookieFrom(good), /^rs_session=/, 'the printed password must work');

      if (value.trim()) {
        const bad = await login(base, USER, value.trim());
        assert.equal(bad.status, 401, 'the placeholder must never be a working password');
        assert.equal(cookieFrom(bad), '', 'a refused login must mint no cookie');
      }
    }));
}

test('a real password is used verbatim, and is not mistaken for a placeholder', () =>
  withProxy({ RACCOON_PASSWORD: 'passwordless-monkey-42' }, async ({ base }) => {
    const r = await login(base, USER, 'passwordless-monkey-42');
    assert.match(cookieFrom(r), /^rs_session=/);
  }));

// A password pasted into a console field with a stray space either side should
// still let its owner in, rather than locking them out of their own pod.
test('surrounding whitespace in RACCOON_PASSWORD is trimmed', () =>
  withProxy({ RACCOON_PASSWORD: '  hunter2  ' }, async ({ base }) => {
    const r = await login(base, USER, 'hunter2');
    assert.match(cookieFrom(r), /^rs_session=/);
  }));
