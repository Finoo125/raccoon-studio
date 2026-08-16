#!/usr/bin/env node
// Raccoon Studio — RunPod login portal + reverse proxy.
//
// The only published port. Next (3000) and ComfyUI (8188) stay on loopback, so
// authentication can live entirely out here and the application stays unchanged.
//
// Stdlib only, by design: node is already in the image for Next, so this costs
// no dependency and no extra runtime.
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';

const PORT = Number(process.env.RACCOON_PROXY_PORT || 8080);
const NEXT = { host: '127.0.0.1', port: Number(process.env.RACCOON_NEXT_PORT || 3000) };
const COMFY = { host: '127.0.0.1', port: Number(process.env.RACCOON_COMFY_PORT || 8188) };

const USER = process.env.RACCOON_USERNAME || 'raccoon';
// A public template with a fixed default password would give every deployment on
// earth the same credentials. Generate-and-log means a pod is never unprotected
// and never predictable.
const GENERATED = !process.env.RACCOON_PASSWORD;
const PASS = process.env.RACCOON_PASSWORD || crypto.randomBytes(9).toString('base64url');
// No secret => a new one per boot, so a restart logs everyone out. That is the
// safe default; set RACCOON_SESSION_SECRET to keep sessions across restarts.
const SECRET = process.env.RACCOON_SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const MAX_AGE_S = 30 * 24 * 3600;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_IP = 8;
const MAX_GLOBAL = 50; // x-forwarded-for is client-forgeable, so cap the total too

// ---------------------------------------------------------------- credentials

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest();
// Compare digests, never raw strings: timingSafeEqual throws on a length
// mismatch, and digests are equal-length by construction.
const sameSecret = (a, b) => crypto.timingSafeEqual(sha256(a), sha256(b));

const sign = (v) => crypto.createHmac('sha256', SECRET).update(String(v)).digest('hex');

const mintCookie = () => {
  const expiry = Date.now() + MAX_AGE_S * 1000;
  return `${expiry}.${sign(expiry)}`;
};

const validCookie = (raw) => {
  if (!raw) return false;
  const dot = raw.lastIndexOf('.');
  if (dot < 1) return false;
  const expiry = raw.slice(0, dot);
  const mac = raw.slice(dot + 1);
  const want = sign(expiry);
  if (mac.length !== want.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return false;
  return Number(expiry) > Date.now();
};

const readCookie = (req, name) => {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
};

const authed = (req) => validCookie(readCookie(req, 'rs_session'));

// RunPod terminates TLS and forwards plain HTTP, so req.socket.encrypted is
// always false here — gating Secure on it would silently drop the flag.
const setCookie = (value, maxAge) =>
  `rs_session=${value}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${maxAge}`;

// ------------------------------------------------------------- rate limiting

// Behind RunPod's proxy every visitor shares req.socket.remoteAddress, so keying
// on it puts the whole internet in one bucket and lets any attacker lock the
// owner out. Use the leftmost x-forwarded-for entry instead — and because that
// header is forgeable, keep a global counter beside it.
const clientIp = (req) => {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
};

const perIp = new Map();
let global_ = { n: 0, since: Date.now() };

const bump = (bucket) => {
  if (Date.now() - bucket.since > WINDOW_MS) { bucket.n = 0; bucket.since = Date.now(); }
  bucket.n++;
  return bucket;
};

const lockedOut = (ip) => {
  const b = perIp.get(ip);
  const ipHit = b && Date.now() - b.since <= WINDOW_MS && b.n >= MAX_PER_IP;
  const globalHit = Date.now() - global_.since <= WINDOW_MS && global_.n >= MAX_GLOBAL;
  return Boolean(ipHit || globalHit);
};

const recordFailure = (ip) => {
  if (!perIp.has(ip)) perIp.set(ip, { n: 0, since: Date.now() });
  bump(perIp.get(ip));
  bump(global_);
  if (perIp.size > 10000) perIp.clear(); // ponytail: crude cap, an LRU if it ever matters
};

const clearFailures = (ip) => perIp.delete(ip);

// ------------------------------------------------------------------ login UI

const LOGIN_HTML = (error) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Raccoon Studio</title>
<style>
 :root{color-scheme:dark}
 *{box-sizing:border-box}
 body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b0d;
      color:#e8e6e3;font:15px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif}
 form{width:min(360px,92vw);padding:32px;background:#141417;border:1px solid #26262b;border-radius:14px}
 h1{margin:0 0 4px;font-size:19px;letter-spacing:-.01em}
 p.sub{margin:0 0 22px;color:#8b8b93;font-size:13px}
 label{display:block;margin:14px 0 6px;font-size:12px;color:#a5a5ad;text-transform:uppercase;letter-spacing:.06em}
 input{width:100%;padding:10px 12px;background:#0b0b0d;color:#e8e6e3;
       border:1px solid #33333a;border-radius:8px;font-size:14px}
 input:focus{outline:none;border-color:#ffa64d}
 button{width:100%;margin-top:22px;padding:11px;border:0;border-radius:8px;cursor:pointer;
        font-size:14px;font-weight:600;color:#1a1206;
        background:linear-gradient(135deg,#ffa64d,#ff8a3d)}
 .err{margin-top:16px;padding:9px 12px;border-radius:8px;font-size:13px;
      background:#2a1416;border:1px solid #5c2126;color:#ff9b9b}
</style></head><body>
<form method="POST" action="/login">
  <h1>Raccoon Studio</h1>
  <p class="sub">This pod is password protected.</p>
  <label for="u">Username</label>
  <input id="u" name="username" autocomplete="username" autofocus value="${USER.replace(/"/g, '&quot;')}">
  <label for="p">Password</label>
  <input id="p" name="password" type="password" autocomplete="current-password">
  <button type="submit">Sign in</button>
  ${error ? `<div class="err">${error}</div>` : ''}
</form></body></html>`;

const send = (res, code, type, body, extra = {}) => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', ...extra });
  res.end(body);
};

const readBody = (req, limit = 64 * 1024) =>
  new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => {
      s += c;
      if (s.length > limit) { reject(new Error('body too large')); req.destroy(); }
    });
    req.on('end', () => resolve(s));
    req.on('error', reject);
  });

// -------------------------------------------------------------------- server

const server = http.createServer(async (req, res) => {
  const path = (req.url || '/').split('?')[0];

  if (path === '/login' && req.method === 'GET') {
    if (authed(req)) return send(res, 302, 'text/plain', '', { location: '/' });
    return send(res, 200, 'text/html; charset=utf-8', LOGIN_HTML(''));
  }

  if (path === '/login' && req.method === 'POST') {
    const ip = clientIp(req);
    if (lockedOut(ip)) return send(res, 429, 'text/html; charset=utf-8', LOGIN_HTML('Too many attempts. Try again later.'));
    let form;
    try { form = new URLSearchParams(await readBody(req)); } catch { return send(res, 413, 'text/plain', 'too large'); }
    const ok = sameSecret(form.get('username') || '', USER) && sameSecret(form.get('password') || '', PASS);
    if (!ok) {
      recordFailure(ip);
      return send(res, 401, 'text/html; charset=utf-8', LOGIN_HTML('Wrong username or password.'));
    }
    clearFailures(ip);
    return send(res, 302, 'text/plain', '', { location: '/', 'set-cookie': setCookie(mintCookie(), MAX_AGE_S) });
  }

  if (path === '/logout') {
    return send(res, 302, 'text/plain', '', { location: '/login', 'set-cookie': setCookie('', 0) });
  }

  if (!authed(req)) {
    // A fetch() redirected to an HTML login page surfaces as a JSON parse error
    // rather than "logged out", so API callers get a status they can read.
    if (path.startsWith('/api/') || path.startsWith('/rvn/')) {
      return send(res, 401, 'application/json', JSON.stringify({ error: 'unauthorized' }));
    }
    return send(res, 302, 'text/plain', '', { location: '/login' });
  }

  const fwd = http.request(
    { ...NEXT, path: req.url, method: req.method, headers: { ...req.headers, 'x-forwarded-proto': 'https' } },
    (up) => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res); // stream, never buffer: SSE and multi-GB transfers both pass here
    },
  );
  fwd.on('error', (e) => {
    if (res.headersSent) return res.destroy();
    send(res, 502, 'text/plain', `upstream unavailable: ${e.message}\n`);
  });
  req.pipe(fwd);
});

// A multi-GB model upload over a home connection outlives node's 300s default,
// which would kill the transfer mid-flight.
server.requestTimeout = 0;
server.headersTimeout = 0;
server.timeout = 0;
server.keepAliveTimeout = 72_000;

// ------------------------------------------------------------ ws passthrough

// A masked, empty ping. Frames from a client MUST be masked, and this proxy is
// the client as far as ComfyUI is concerned.
const maskedPing = () => Buffer.concat([Buffer.from([0x89, 0x80]), crypto.randomBytes(4)]);

server.on('upgrade', (req, sock, head) => {
  if (!authed(req)) {
    sock.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    return;
  }
  const url = req.url || '';
  if (!url.startsWith('/comfy-ws')) {
    sock.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    return;
  }
  // /comfy-ws?clientId=… -> /ws?clientId=… ; the query must survive or ComfyUI
  // cannot route events back to this client.
  const target = '/ws' + url.slice('/comfy-ws'.length);

  const lines = [`GET ${target} HTTP/1.1`, `Host: ${COMFY.host}:${COMFY.port}`];
  for (const [k, v] of Object.entries(req.headers)) {
    const lk = k.toLowerCase();
    // ComfyUI 403s a mismatched Origin; cookies are ours, not its business.
    if (lk === 'origin' || lk === 'host' || lk === 'cookie') continue;
    lines.push(`${k}: ${v}`);
  }

  const up = net.connect(COMFY.port, COMFY.host, () => {
    up.write(lines.join('\r\n') + '\r\n\r\n');
    if (head && head.length) up.write(head);
    up.pipe(sock);
    sock.pipe(up);
  });

  // RunPod's proxy drops idle sockets, and a quiet ComfyUI is a common idle
  // state. Ping *upstream* rather than injecting a frame into the downstream
  // pipe: the browser sends nothing on this socket, so there is no writer to
  // interleave with, and ComfyUI's pong travels back through the pipe at a
  // proper frame boundary, keeping both directions warm.
  const ping = setInterval(() => { if (!up.destroyed) up.write(maskedPing()); }, 30_000);
  const shut = () => { clearInterval(ping); up.destroy(); sock.destroy(); };
  up.on('error', shut);
  up.on('close', shut);
  sock.on('error', shut);
  sock.on('close', shut);
});

// The published service must bind 0.0.0.0 — binding loopback is the documented
// top cause of a RunPod 502.
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[proxy] listening on 0.0.0.0:${PORT} -> next ${NEXT.port}, comfyui ${COMFY.port}`);
  console.log(`[proxy] username: ${USER}`);
  if (GENERATED) {
    console.log('');
    console.log('  ┌─────────────────────────────────────────────────────────┐');
    console.log('  │  RACCOON_PASSWORD was not set — generated one for you:  │');
    console.log(`  │      ${PASS.padEnd(49)}│`);
    console.log('  │  Set RACCOON_PASSWORD in the template to choose it.     │');
    console.log('  └─────────────────────────────────────────────────────────┘');
    console.log('');
  }
  if (!process.env.RACCOON_SESSION_SECRET) {
    console.log('[proxy] no RACCOON_SESSION_SECRET — sessions end at restart.');
  }
});
