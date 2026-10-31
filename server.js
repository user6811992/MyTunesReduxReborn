const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { DaapClient } = require('./lib/daap');
const { startBrowser } = require('./lib/mdns');
const config = require('./lib/config');

const PORT = process.env.PORT || 8765;
let discovered = [];
const browser = startBrowser('_daap._tcp', (svc) => {
  const key = svc.name + '|' + (svc.addresses || []).join(',');
  if (!discovered.find((d) => d.key === key)) {
    discovered.push({ key, ...svc });
  }
  // update existing
  const idx = discovered.findIndex((d) => d.name === svc.name);
  if (idx >= 0) discovered[idx] = { key, ...svc };
}, (e) => { /* ignore */ });

let airplayDiscovered = [];
const airplayBrowser = startBrowser('_airplay._tcp', (svc) => {
  const key = svc.name + '|' + (svc.addresses || []).join(',');
  if (!airplayDiscovered.find((d) => d.key === key)) airplayDiscovered.push({ key, ...svc });
  const idx = airplayDiscovered.findIndex((d) => d.name === svc.name);
  if (idx >= 0) airplayDiscovered[idx] = { key, ...svc };
}, (e) => {});

let chromecastDiscovered = [];
const chromecastBrowser = startBrowser('_googlecast._tcp', (svc) => {
  const key = svc.name + '|' + (svc.addresses || []).join(',');
  if (!chromecastDiscovered.find((d) => d.key === key)) chromecastDiscovered.push({ key, ...svc });
  const idx = chromecastDiscovered.findIndex((d) => d.name === svc.name);
  if (idx >= 0) chromecastDiscovered[idx] = { key, ...svc };
}, (e) => {});

function sendJson(res, code, obj) {
  const data = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

const PUBLIC = null; // placeholder, assets resolved at runtime

function appDir() {
  try {
    const sea = require('node:sea');
    if (sea.isSea()) return path.dirname(process.execPath);
  } catch (e) {}
  return path.join(__dirname, '..');
}

function readAsset(rel) {
  const normalized = rel.replace(/^[/\\]+/, '');
  try {
    const sea = require('node:sea');
    if (sea.isSea()) {
      const key = 'public/' + normalized;
      if (sea.getAssetKeys().includes(key)) {
        return Buffer.from(sea.getRawAsset(key));
      }
    }
  } catch (e) {}
  const fs = require('fs');
  const pathMod = require('path');
  return fs.readFileSync(pathMod.join(appDir(), 'public', normalized));
}

function serveStatic(req, res) {
  const parsed = new URL(req.url, 'http://localhost');
  let pathname = parsed.pathname;
  if (pathname === '/') pathname = '/index.html';
  const rel = pathname.replace(/^\/+/, '');
  if (rel.includes('..')) { res.writeHead(403); res.end(); return; }
  try {
    const data = readAsset(rel);
    const ext = path.extname(rel).toLowerCase();
    const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(data);
  } catch (e) {
    res.writeHead(404); res.end('Not found');
  }
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
      version: '2.3.0',
      codename: 'Horizon',
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

  if (p === '/api/ratings' && req.method === 'GET') {
    const f = path.join(__dirname, 'data', 'ratings.json');
    let data = {};
    try { if (fs.existsSync(f)) data = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) {}
    return sendJson(res, 200, { ratings: data });
  }
  if (p === '/api/ratings' && req.method === 'POST') {
    const body = await readBody(req);
    const f = path.join(__dirname, 'data', 'ratings.json');
    let data = {};
    try { if (fs.existsSync(f)) data = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) {}
    if (body.id) data[body.id] = { rating: body.rating || 0, plays: body.plays || data[body.id]?.plays || 0, updated: Date.now() };
    try { fs.writeFileSync(f, JSON.stringify(data, null, 2)); } catch (e) {}
    return sendJson(res, 200, { ok: true, ratings: data });
  }

  if (p === '/api/lyrics' && req.method === 'GET') {
    const q = parsed.searchParams;
    const artist = q.get('artist') || '';
    const title = q.get('title') || '';
    const https = require('https');
    const url = 'https://api.lyrics.ovh/v1/' + encodeURIComponent(artist) + '/' + encodeURIComponent(title);
    https.get(url, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => {
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString());
          sendJson(res, 200, { lyrics: j.lyrics || '' });
        } catch (e) {
          sendJson(res, 200, { lyrics: '' });
        }
      });
    }).on('error', () => sendJson(res, 200, { lyrics: '' }));
    return;
  }

  if (p === '/api/cover-search' && req.method === 'GET') {
    const q = parsed.searchParams;
    const artist = q.get('artist') || '';
    const album = q.get('album') || '';
    const https = require('https');
    const url = 'https://itunes.apple.com/search?term=' + encodeURIComponent(artist + ' ' + album) + '&entity=album&limit=1';
    https.get(url, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => {
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString());
          const art = (j.results && j.results[0] && j.results[0].artworkUrl100) || '';
          sendJson(res, 200, { artwork: art.replace('100x100', '600x600') });
        } catch (e) {
          sendJson(res, 200, { artwork: '' });
        }
      });
    }).on('error', () => sendJson(res, 200, { artwork: '' }));
    return;
  }

  if (p === '/api/scrobble' && req.method === 'POST') {
    const body = await readBody(req);
    const https = require('https');
    if (body.service === 'listenbrainz' && body.token) {
      const payload = JSON.stringify({
        listen_type: body.type === 'nowplaying' ? 'playing_now' : 'single',
        payload: [{
          track_metadata: {
            artist_name: body.artist || '',
            track_name: body.title || '',
            release_name: body.album || ''
          }
        }]
      });
      const reqOpts = {
        hostname: 'api.listenbrainz.org',
        path: '/1/submit-listens',
        method: 'POST',
        headers: {
          'Authorization': 'Token ' + body.token,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      };
      const r = https.request(reqOpts, (resp) => {
        const chunks = [];
        resp.on('data', (c) => chunks.push(c));
        resp.on('end', () => sendJson(res, 200, { ok: resp.statusCode < 300, status: resp.statusCode, body: Buffer.concat(chunks).toString() }));
      });
      r.on('error', (e) => sendJson(res, 500, { ok: false, error: e.message }));
      r.write(payload);
      r.end();
      return;
    }
    return sendJson(res, 400, { ok: false, error: 'unsupported service or missing token' });
  }

  if (p === '/api/smartplaylists' && req.method === 'GET') {
    const s = config.load();
    return sendJson(res, 200, { items: s.smartPlaylists || [] });
  }
  if (p === '/api/smartplaylists' && req.method === 'POST') {
    const body = await readBody(req);
    const s = config.load();
    if (!Array.isArray(s.smartPlaylists)) s.smartPlaylists = [];
    const idx = s.smartPlaylists.findIndex((x) => x.name === body.name);
    if (idx >= 0) s.smartPlaylists[idx] = body; else s.smartPlaylists.push(body);
    config.save(s);
    return sendJson(res, 200, { ok: true, items: s.smartPlaylists });
  }
  if (p === '/api/smartplaylists' && req.method === 'DELETE') {
    const body = await readBody(req);
    const s = config.load();
    if (Array.isArray(s.smartPlaylists)) {
      s.smartPlaylists.splice(body.index, 1);
      config.save(s);
    }
    return sendJson(res, 200, { ok: true, items: s.smartPlaylists || [] });
  }

  if (p === '/api/podcast' && req.method === 'POST') {
    const body = await readBody(req);
    const https = require('https');
    const http = require('http');
    const client = body.url && body.url.startsWith('https') ? https : http;
    client.get(body.url, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => {
        const xml = Buffer.concat(chunks).toString('utf8');
        const episodes = [];
        const itemRe = /<item>([\s\S]*?)<\/item>/g;
        let m;
        while ((m = itemRe.exec(xml)) !== null) {
          const block = m[1];
          const title = (block.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/) || [])[1] || 'Episode';
          const url = (block.match(/<enclosure[^>]*url="([^"]+)"/) || [])[1] || '';
          const pubDate = (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || '';
          if (url) episodes.push({ title: title.trim(), url, pubDate });
        }
        const feedTitle = (xml.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/) || [])[1] || 'Podcast';
        sendJson(res, 200, { title: feedTitle.trim(), episodes });
      });
    }).on('error', (e) => sendJson(res, 500, { error: e.message }));
    return;
  }

  if (p === '/api/scrobble-lastfm' && req.method === 'POST') {
    const body = await readBody(req);
    const crypto = require('crypto');
    const method = body.type === 'nowplaying' ? 'track.updateNowPlaying' : 'track.scrobble';
    const params = {
      method,
      api_key: body.apiKey,
      sk: body.sessionKey,
      artist: body.artist || '',
      track: body.title || '',
      album: body.album || '',
      format: 'json'
    };
    if (method === 'track.scrobble') params.timestamp = Math.floor(Date.now() / 1000);
    // signature
    const keys = Object.keys(params).sort();
    let sigBase = '';
    for (const k of keys) sigBase += k + params[k];
    sigBase += body.secret || '';
    const apiSig = crypto.createHash('md5').update(sigBase).digest('hex');
    params.api_sig = apiSig;
    const query = new URLSearchParams(params).toString();
    const https = require('https');
    const reqOpts = {
      hostname: 'ws.audioscrobbler.com',
      path: '/2.0/?' + query,
      method: 'POST'
    };
    const r = https.request(reqOpts, (resp) => {
      const chunks = [];
      resp.on('data', (c) => chunks.push(c));
      resp.on('end', () => sendJson(res, 200, { ok: resp.statusCode < 300, status: resp.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    r.on('error', (e) => sendJson(res, 500, { ok: false, error: e.message }));
    r.end();
    return;
  }

  if (p === '/api/airplay' && req.method === 'GET') {
    return sendJson(res, 200, airplayDiscovered.map((d) => ({
      name: d.name,
      host: (d.addresses && d.addresses[0]) || d.host,
      port: d.port || 7000
    })));
  }

  if (p === '/api/chromecast' && req.method === 'GET') {
    return sendJson(res, 200, chromecastDiscovered.map((d) => ({
      name: d.name,
      host: (d.addresses && d.addresses[0]) || d.host,
      port: d.port || 8009
    })));
  }

  if (p === '/api/podcasts' && req.method === 'GET') {
    const s = config.load();
    return sendJson(res, 200, { items: s.podcastSubscriptions || [] });
  }
  if (p === '/api/podcasts' && req.method === 'POST') {
    const body = await readBody(req);
    const s = config.load();
    if (!Array.isArray(s.podcastSubscriptions)) s.podcastSubscriptions = [];
    if (!s.podcastSubscriptions.find((x) => x.url === body.url)) s.podcastSubscriptions.push({ url: body.url, title: body.title || body.url });
    config.save(s);
    return sendJson(res, 200, { ok: true, items: s.podcastSubscriptions });
  }
  if (p === '/api/podcasts' && req.method === 'DELETE') {
    const body = await readBody(req);
    const s = config.load();
    if (Array.isArray(s.podcastSubscriptions)) {
      s.podcastSubscriptions.splice(body.index, 1);
      config.save(s);
    }
    return sendJson(res, 200, { ok: true, items: s.podcastSubscriptions || [] });
  }

  if (p === '/api/podcast-sync' && req.method === 'POST') {
    const s = config.load();
    const subs = s.podcastSubscriptions || [];
    const results = [];
    for (const sub of subs) {
      try {
        const https = require('https'); const http = require('http');
        const client = sub.url.startsWith('https') ? https : http;
        const xml = await new Promise((resolve, reject) => {
          client.get(sub.url, (r) => {
            const chunks = [];
            r.on('data', (c) => chunks.push(c));
            r.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
          }).on('error', reject);
        });
        const itemRe = /<item>([\s\S]*?)<\/item>/g;
        let m; const episodes = [];
        while ((m = itemRe.exec(xml)) !== null) {
          const block = m[1];
          const title = (block.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/) || [])[1] || 'Episode';
          const url = (block.match(/<enclosure[^>]*url="([^"]+)"/) || [])[1] || '';
          if (url) episodes.push({ title: title.trim(), url });
        }
        results.push({ title: sub.title, episodes: episodes.slice(0, 5) });
      } catch (e) {
        results.push({ title: sub.title, error: e.message });
      }
    }
    return sendJson(res, 200, { results });
  }

  if (p === '/api/replaygain' && req.method === 'GET') {
    const q = parsed.searchParams;
    const filePath = q.get('path');
    if (!filePath) { sendJson(res, 400, { error: 'path required' }); return; }
    try {
      const mm = require('music-metadata');
      const meta = await mm.parseFile(filePath);
      const rg = meta.common.replaygainAlbumGain || meta.common.replaygainTrackGain || null;
      sendJson(res, 200, { replayGain: rg, tags: meta.common });
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  if (p === '/api/scrobble-librefm' && req.method === 'POST') {
    const body = await readBody(req);
    const crypto = require('crypto');
    const method = body.type === 'nowplaying' ? 'track.updateNowPlaying' : 'track.scrobble';
    const params = {
      method,
      api_key: body.apiKey,
      sk: body.sessionKey,
      artist: body.artist || '',
      track: body.title || '',
      album: body.album || '',
      format: 'json'
    };
    if (method === 'track.scrobble') params.timestamp = Math.floor(Date.now() / 1000);
    const keys = Object.keys(params).sort();
    let sigBase = '';
    for (const k of keys) sigBase += k + params[k];
    sigBase += body.secret || '';
    const apiSig = crypto.createHash('md5').update(sigBase).digest('hex');
    params.api_sig = apiSig;
    const query = new URLSearchParams(params).toString();
    const https = require('https');
    const r = https.request({
      hostname: 'libre.fm',
      path: '/2.0/?' + query,
      method: 'POST'
    }, (resp) => {
      const chunks = [];
      resp.on('data', (c) => chunks.push(c));
      resp.on('end', () => sendJson(res, 200, { ok: resp.statusCode < 300, status: resp.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    r.on('error', (e) => sendJson(res, 500, { ok: false, error: e.message }));
    r.end();
    return;
  }

  sendJson(res, 404, { error: 'not found' });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) handleApi(req, res);
  else serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`MyTunes Redux Reborn running at http://localhost:${PORT}`);
  const { exec } = require('child_process');
  const settings = (function(){ try { return config.load(); } catch(e){ return {}; } })();
  const mode = settings.browserMode || 'edge';
  const edge = 'C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe';
  let cmd;
  if (mode === 'default' || !require('fs').existsSync(edge)) {
    cmd = process.platform === 'win32' ? `start http://localhost:${PORT}` : `open http://localhost:${PORT}`;
  } else {
    cmd = `start "" "${edge}" --app=http://localhost:${PORT} --window-size=1280,800`;
  }
  setTimeout(() => exec(cmd, () => {}), 800);
});

process.on('SIGINT', () => { try { browser.close(); } catch (e) {} try { airplayBrowser.close(); } catch (e) {} try { chromecastBrowser.close(); } catch (e) {} process.exit(0); });