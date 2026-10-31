const http = require('http');
const zlib = require('zlib');
const { parseBuffer, flatten, findAll } = require('./dmap');

function request(options) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        let body = raw;
        if (res.headers['content-encoding'] === 'gzip') {
          try { body = zlib.gunzipSync(raw); } catch (e) { body = raw; }
        }
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(new Error('timeout')); });
    req.end();
  });
}

function baseHeaders(ua) {
  return {
    'Accept': '*/*',
    'Accept-Encoding': 'gzip',
    'Client-DAAP-Version': '1.0',
    'Client-DAAP-Access-Index': '2',
    'User-Agent': ua || 'MyTunes Redux Reborn/2.0'
  };
}

class DaapClient {
  constructor({ host, port = 3689, password = '', ua }) {
    this.host = host;
    this.port = port;
    this.password = password;
    this.ua = ua;
    this.sessionId = null;
    this.databaseId = null;
  }

  async get(path) {
    const headers = baseHeaders(this.ua);
    const opts = { host: this.host, port: this.port, path, method: 'GET', headers };
    if (this.password) {
      const tok = Buffer.from(':' + this.password).toString('base64');
      headers['Authorization'] = 'Basic ' + tok;
    }
    return request(opts);
  }

  async serverInfo() {
    const r = await this.get('/server-info');
    if (r.status !== 200) throw new Error('server-info failed: ' + r.status);
    const items = parseBuffer(r.body);
    return flatten(items);
  }

  async login() {
    const r = await this.get('/login');
    if (r.status !== 200) throw new Error('login failed: ' + r.status);
    const items = parseBuffer(r.body);
    const f = flatten(items);
    this.sessionId = f['mlid'] || null;
    return f;
  }

  async databases() {
    const r = await this.get('/databases' + (this.sessionId ? '?session-id=' + this.sessionId : ''));
    if (r.status !== 200) throw new Error('databases failed: ' + r.status);
    const items = parseBuffer(r.body);
    const dbs = findAll(items, 'mlit').map((li) => flatten(li.value.children));
    if (dbs.length) this.databaseId = dbs[0]['miid'] || null;
    return dbs;
  }

  async containers(dbId) {
    const id = dbId || this.databaseId;
    const r = await this.get(`/databases/${id}/containers?session-id=${this.sessionId}`);
    if (r.status !== 200) return [];
    const items = parseBuffer(r.body);
    return findAll(items, 'mlit').map((li) => flatten(li.value.children));
  }

  async items(dbId, meta) {
    const id = dbId || this.databaseId;
    const r = await this.get(`/databases/${id}/items?session-id=${this.sessionId}`);
    if (r.status !== 200) throw new Error('items failed: ' + r.status);
    const items = parseBuffer(r.body);
    return findAll(items, 'mlit').map((li) => flatten(li.value.children));
  }

  async containerItems(dbId, containerId) {
    const id = dbId || this.databaseId;
    const r = await this.get(`/databases/${id}/containers/${containerId}/items?session-id=${this.sessionId}`);
    if (r.status !== 200) return [];
    const items = parseBuffer(r.body);
    return findAll(items, 'mlit').map((li) => flatten(li.value.children));
  }

  async download(dbId, itemId, format, destPath) {
    const id = dbId || this.databaseId;
    const ext = format || 'm4a';
    const r = await this.get(`/databases/${id}/items/${itemId}.${ext}?session-id=${this.sessionId}`);
    if (r.status !== 200) throw new Error('download failed: ' + r.status);
    const fs = require('fs');
    fs.writeFileSync(destPath, r.body);
    return destPath;
  }

  async logout() {
    if (!this.sessionId) return;
    try { await this.get('/logout?session-id=' + this.sessionId); } catch (e) {}
    this.sessionId = null;
  }
}

module.exports = { DaapClient };