const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { DaapClient } = require('./lib/daap');
const { startBrowser } = require('./lib/mdns');
const config = require('./lib/config');

const PORT = process.env.PORT || 8765;
const PUBLIC = path.join(__dirname, 'public');

let discovered = [];
const browser = startBrowser((svc) => {
  const key = svc.name + '|' + (svc.addresses || []).join(',');
  if (!discovered.find((d) => d.key === key)) {
    discovered.push({ key, ...svc });
  }
  // update existing
  const idx = discovered.findIndex((d) => d.name === svc.name);
  if (idx >= 0) discovered[idx] = { key, ...svc };
}, (e) => { /* ignore */ });

function sendJson(res, code, obj) {
  const data = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

function serveStatic(req, res) {
  const parsed = new URL(req.url, 'http://localhost');
  let pathname = parsed.pathname;
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.join(PUBLIC, pathname);
  if (!filePath.startsWith(PUBLIC)) { res.writeHead(403); res.end(); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); }
      catch (e) { resolve({}); }
    });
  });
}

async function handleApi(req, res) {
  const parsed = new URL(req.url, 'http://localhost');
  const p = parsed.pathname;

  if (p === '/api/settings' && req.method === 'GET') {
    return sendJson(res, 200, config.load());
  }
  if (p === '/api/settings' && req.method === 'POST') {
    const body = await readBody(req);
    const cur = config.load();
    const next = { ...cur, ...body };
    config.save(next);
    return sendJson(res, 200, next);
  }

  if (p === '/api/discover' && req.method === 'GET') {
    return sendJson(res, 200, discovered.map((d) => ({
      name: d.name,
      host: (d.addresses && d.addresses[0]) || d.host,
      port: d.port || 3689
    })));
  }

  if (p === '/api/connect' && req.method === 'POST') {
    const body = await readBody(req);
    const client = new DaapClient({ host: body.host, port: body.port || 3689, password: body.password || '' });
    try {
      const info = await client.serverInfo();
      const login = await client.login();
      const dbs = await client.databases();
      const containers = dbs.length ? await client.containers(dbs[0]['dmap.itemid']) : [];
      let tracks = [];
      if (dbs.length) tracks = await client.items(dbs[0]['dmap.itemid']);
      await client.logout();
      return sendJson(res, 200, { ok: true, info, login, databases: dbs, containers, tracks });
    } catch (e) {
      try { await client.logout(); } catch (_) {}
      return sendJson(res, 500, { ok: false, error: e.message });
    }
  }

  if (p === '/api/tracks' && req.method === 'POST') {
    const body = await readBody(req);
    const client = new DaapClient({ host: body.host, port: body.port || 3689, password: body.password || '' });
    try {
      await client.serverInfo();
      await client.login();
      const tracks = await client.items(body.dbId);
      await client.logout();
      return sendJson(res, 200, { ok: true, tracks });
    } catch (e) {
      try { await client.logout(); } catch (_) {}
      return sendJson(res, 500, { ok: false, error: e.message });
    }
  }

  if (p === '/api/container-tracks' && req.method === 'POST') {
    const body = await readBody(req);
    const client = new DaapClient({ host: body.host, port: body.port || 3689, password: body.password || '' });
    try {
      await client.serverInfo();
      await client.login();
      const tracks = await client.containerItems(body.dbId, body.containerId);
      await client.logout();
      return sendJson(res, 200, { ok: true, tracks });
    } catch (e) {
      try { await client.logout(); } catch (_) {}
      return sendJson(res, 500, { ok: false, error: e.message });
    }
  }

  if (p === '/api/download' && req.method === 'POST') {
    const body = await readBody(req);
    const settings = config.load();
    const dir = body.destDir || settings.downloadDir;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const safeName = (body.name || ('track-' + body.itemId)).replace(/[<>:"/\\|?*]/g, '_');
    const ext = body.format || 'm4a';
    const dest = path.join(dir, safeName + '.' + ext);
    if (fs.existsSync(dest) && !body.overwrite) {
      return sendJson(res, 200, { ok: true, path: dest, skipped: true });
    }
    const client = new DaapClient({ host: body.host, port: body.port || 3689, password: body.password || '' });
    try {
      await client.serverInfo();
      await client.login();
      await client.download(body.dbId, body.itemId, ext, dest);
      await client.logout();
      return sendJson(res, 200, { ok: true, path: dest });
    } catch (e) {
      try { await client.logout(); } catch (_) {}
      return sendJson(res, 500, { ok: false, error: e.message });
    }
  }

  if (p === '/api/open' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body.path) return sendJson(res, 400, { ok: false, error: 'path required' });
    const { exec } = require('child_process');
    const cmd = process.platform === 'win32' ? `start "" "${body.path}"` : `open "${body.path}"`;
    exec(cmd, () => {});
    return sendJson(res, 200, { ok: true });
  }

  if (p === '/api/open-itunes' && req.method === 'POST') {
    const body = await readBody(req);
    const { exec } = require('child_process');
    const ps = `powershell -NoProfile -Command "try { $it = New-Object -ComObject iTunes.Application; $it.PlayFile('${(body.path || '').replace(/'/g, "''")}'); } catch { Write-Host $_ }"`;
    exec(ps, () => {});
    return sendJson(res, 200, { ok: true });
  }

  if (p === '/api/about' && req.method === 'GET') {
    return sendJson(res, 200, {
      name: 'MyTunes Redux Reborn',
      version: '2.0.0',
      codename: 'Reborn',
      description: 'A modern, legitimate reimagining of myTunes Redux for browsing/downloading from DAAP-compatible shares you are authorized to access.'
    });
  }

  if (p === '/api/profiles' && req.method === 'GET') {
    const s = config.load();
    return sendJson(res, 200, { profiles: s.connections || [] });
  }
  if (p === '/api/profiles' && req.method === 'POST') {
    const body = await readBody(req);
    const s = config.load();
    if (!Array.isArray(s.connections)) s.connections = [];
    const idx = s.connections.findIndex((c) => c.name === body.name);
    if (idx >= 0) s.connections[idx] = body; else s.connections.push(body);
    config.save(s);
    return sendJson(res, 200, { ok: true, profiles: s.connections });
  }
  if (p === '/api/profiles' && req.method === 'DELETE') {
    const body = await readBody(req);
    const s = config.load();
    if (Array.isArray(s.connections)) {
      s.connections = s.connections.filter((_, i) => i !== body.index);
      config.save(s);
    }
    return sendJson(res, 200, { ok: true, profiles: s.connections || [] });
  }

  if (p === '/api/artwork' && req.method === 'GET') {
    const q = parsed.searchParams;
    const host = q.get('host');
    const port = parseInt(q.get('port') || '3689', 10);
    const password = q.get('password') || '';
    const dbId = q.get('dbId');
    const itemId = q.get('itemId');
    if (!host || !dbId || !itemId) { res.writeHead(400); res.end(); return; }
    const client = new DaapClient({ host, port, password });
    try {
      await client.serverInfo();
      await client.login();
      const r = await client.get(`/databases/${dbId}/items/${itemId}.jpg?session-id=${client.sessionId}`);
      await client.logout();
      if (r.status !== 200 || !r.body || !r.body.length) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': r.headers['content-type'] || 'image/jpeg', 'Content-Length': r.body.length });
      res.end(r.body);
      return;
    } catch (e) {
      try { await client.logout(); } catch (_) {}
      res.writeHead(404); res.end(); return;
    }
  }

  if (p === '/api/interfaces' && req.method === 'GET') {
    const os = require('os');
    const nets = os.networkInterfaces();
    const out = [];
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) out.push({ name, address: net.address, netmask: net.netmask });
      }
    }
    return sendJson(res, 200, { interfaces: out });
  }

  if (p === '/api/scan' && req.method === 'POST') {
    const body = await readBody(req);
    const net = require('net');
    const os = require('os');
    const port = body.port || 3689;
    const timeout = body.timeout || 300;
    const targets = [];
    // Determine subnets from interfaces unless provided
    let subnets = body.subnets;
    if (!subnets) {
      const nets = os.networkInterfaces();
      const set = new Set();
      for (const name of Object.keys(nets)) {
        for (const n of nets[name] || []) {
          if (n.family === 'IPv4' && !n.internal) {
            const parts = n.address.split('.');
            set.add(parts.slice(0, 3).join('.'));
          }
        }
      }
      subnets = [...set];
    }
    for (const sn of subnets) {
      for (let i = 1; i <= 254; i++) targets.push(sn + '.' + i);
    }
    const results = [];
    // concurrency-limited scan
    const concurrency = 64;
    let index = 0;
    async function worker() {
      while (index < targets.length) {
        const ip = targets[index++];
        await new Promise((resolve) => {
          const sock = new net.Socket();
          let done = false;
          const finish = (open) => {
            if (done) return; done = true;
            if (open) results.push({ ip, port });
            sock.destroy();
            resolve();
          };
          sock.setTimeout(timeout);
          sock.on('connect', () => finish(true));
          sock.on('timeout', () => finish(false));
          sock.on('error', () => finish(false));
          sock.connect(port, ip);
        });
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));
    return sendJson(res, 200, { port, results, scanned: targets.length });
  }

  sendJson(res, 404, { error: 'not found' });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) handleApi(req, res);
  else serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`MyTunes Redux Reborn running at http://localhost:${PORT}`);
});

process.on('SIGINT', () => { try { browser.close(); } catch (e) {} process.exit(0); });