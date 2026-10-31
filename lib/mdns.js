// Best-effort multicast DNS browser for _daap._tcp.local.
// Returns an array of { name, host, port, addresses } via callback events.

const dgram = require('dgram');

function encodeName(name) {
  const parts = name.split('.');
  const bufs = [];
  for (const p of parts) {
    const b = Buffer.from(p, 'utf8');
    bufs.push(Buffer.from([b.length]), b);
  }
  bufs.push(Buffer.from([0]));
  return Buffer.concat(bufs);
}

function parseName(buf, offset) {
  let name = '';
  let pos = offset;
  let jumped = false;
  let nextPos = offset;
  const seen = new Set();
  while (true) {
    if (pos >= buf.length) break;
    const len = buf[pos];
    if (len === 0) { pos++; break; }
    if ((len & 0xc0) === 0xc0) {
      const ptr = ((len & 0x3f) << 8) | buf[pos + 1];
      if (!jumped) nextPos = pos + 2;
      jumped = true;
      pos = ptr;
      continue;
    }
    pos++;
    name += buf.slice(pos, pos + len).toString('utf8') + '.';
    pos += len;
  }
  if (!jumped) nextPos = pos;
  return { name: name.replace(/\.$/, ''), nextPos };
}

function startBrowser(onService, onError) {
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const services = new Map();
  sock.on('error', (e) => { if (onError) onError(e); });
  sock.on('message', (msg) => {
    try {
      // DNS header: 12 bytes
      let qd = msg.readUInt16BE(4);
      let an = msg.readUInt16BE(6);
      let ns = msg.readUInt16BE(8);
      let ar = msg.readUInt16BE(10);
      let pos = 12;
      // skip questions
      for (let i = 0; i < qd; i++) {
        const r = parseName(msg, pos); pos = r.nextPos;
        pos += 4; // qtype + qclass
      }
      const answers = [];
      const total = an + ns + ar;
      for (let i = 0; i < total; i++) {
        const r = parseName(msg, pos); pos = r.nextPos;
        const type = msg.readUInt16BE(pos); pos += 2;
        const cls = msg.readUInt16BE(pos); pos += 2;
        const ttl = msg.readUInt32BE(pos); pos += 4;
        const rdlen = msg.readUInt16BE(pos); pos += 2;
        const rdataStart = pos;
        const rdata = msg.slice(pos, pos + rdlen);
        answers.push({ name: r.name, type, cls, ttl, rdata, rdataStart });
        pos += rdlen;
      }
      // Collect PTR targets
      for (const a of answers) {
        if (a.type === 12) { // PTR
          const t = parseName(msg, a.rdataStart);
          const inst = t.name;
          if (!services.has(inst)) services.set(inst, { name: inst, host: null, port: null, addresses: [] });
        }
      }
      // SRV
      for (const a of answers) {
        if (a.type === 33) { // SRV
          const priority = a.rdata.readUInt16BE(0);
          const weight = a.rdata.readUInt16BE(2);
          const port = a.rdata.readUInt16BE(4);
          const t = parseName(msg, a.rdataStart + 6);
          const host = t.name;
          // find matching service by name (a.name)
          let svc = services.get(a.name);
          if (!svc) { svc = { name: a.name, host, port, addresses: [] }; services.set(a.name, svc); }
          svc.host = host; svc.port = port;
          if (onService) onService({ ...svc });
        }
      }
      // A
      for (const a of answers) {
        if (a.type === 1) {
          const ip = a.rdata[0] + '.' + a.rdata[1] + '.' + a.rdata[2] + '.' + a.rdata[3];
          // attach to any service whose host matches a.name
          for (const svc of services.values()) {
            if (svc.host === a.name) {
              if (!svc.addresses.includes(ip)) svc.addresses.push(ip);
              if (onService) onService({ ...svc });
            }
          }
        }
      }
    } catch (e) {
      // ignore parse errors
    }
  });

  sock.bind(5353, () => {
    try { sock.addMembership('224.0.0.251'); } catch (e) {}
    try { sock.setMulticastTTL(255); } catch (e) {}
    // send query
    const qname = encodeName('_daap._tcp.local');
    const header = Buffer.alloc(12);
    header.writeUInt16BE(0, 0); // id
    header.writeUInt16BE(0x0100, 2); // flags standard query
    header.writeUInt16BE(1, 4); // qdcount
    // qtype PTR (12), qclass IN (1)
    const q = Buffer.concat([qname, Buffer.from([0, 12, 0, 1])]);
    const packet = Buffer.concat([header, q]);
    try { sock.send(packet, 0, packet.length, 5353, '224.0.0.251'); } catch (e) {}
  });

  // periodic re-query
  const interval = setInterval(() => {
    const qname = encodeName('_daap._tcp.local');
    const header = Buffer.alloc(12);
    header.writeUInt16BE(0, 0);
    header.writeUInt16BE(0x0100, 2);
    header.writeUInt16BE(1, 4);
    const q = Buffer.concat([qname, Buffer.from([0, 12, 0, 1])]);
    const packet = Buffer.concat([header, q]);
    try { sock.send(packet, 0, packet.length, 5353, '224.0.0.251'); } catch (e) {}
  }, 5000);

  return {
    close() { clearInterval(interval); try { sock.close(); } catch (e) {} }
  };
}

module.exports = { startBrowser };