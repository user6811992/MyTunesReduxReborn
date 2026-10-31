// Minimal DMAP/DAAP tagged-data parser.
// Data is a sequence of (4-byte code, 4-byte big-endian length, value bytes).

// Codes that contain nested (code,length,value) items.
const CONTAINER_CODES = new Set([
  'mlcl', 'mlit', 'msrv', 'mlog', 'mupd', 'mccr', 'mdcl', 'mbcl',
  'adbs', 'aply', 'apso', 'avdb', 'abal', 'abar', 'abgn', 'abcp',
  'abro', 'mstt', 'msdc'
]);

// Codes whose payload is a UTF-8 string.
const STRING_CODES = new Set([
  'minm', 'asal', 'asar', 'asgn', 'asfm', 'asco', 'asdc', 'ascm',
  'mstt', 'msts', 'msbr', 'mcna', 'msrvname'.slice(0,4) // placeholder
]);

function decodeString(buf) {
  let end = buf.length;
  while (end > 0 && buf[end - 1] === 0) end--;
  return buf.slice(0, end).toString('utf8');
}

function parseBuffer(buf, offset = 0, end = buf.length) {
  const items = [];
  let pos = offset;
  while (pos + 8 <= end) {
    const code = buf.slice(pos, pos + 4).toString('ascii');
    const len = buf.readUInt32BE(pos + 4);
    const valStart = pos + 8;
    const valEnd = valStart + len;
    if (valEnd > end) break;
    const valueBuf = buf.slice(valStart, valEnd);
    let value;
    if (CONTAINER_CODES.has(code)) {
      value = { code, children: parseBuffer(valueBuf, 0, valueBuf.length) };
    } else if (STRING_CODES.has(code) || code.startsWith('as') && len > 4) {
      // treat long daap string fields as strings
      value = { code, value: decodeString(valueBuf) };
    } else if (len === 1) {
      value = { code, value: valueBuf[0] };
    } else if (len === 2) {
      value = { code, value: valueBuf.readUInt16BE(0) };
    } else if (len === 4) {
      value = { code, value: valueBuf.readUInt32BE(0) };
    } else if (len === 8) {
      value = { code, value: Number(valueBuf.readBigUInt64BE(0)) };
    } else {
      // Heuristic: if mostly printable, decode as string
      const printable = valueBuf.toString('utf8');
      if (/^[\x20-\x7e\t\r\n]*\x00*$/.test(printable)) {
        value = { code, value: decodeString(valueBuf) };
      } else {
        value = { code, value: valueBuf };
      }
    }
    items.push({ code, value });
    pos = valEnd;
  }
  return items;
}

function flatten(items, out = {}) {
  for (const it of items) {
    if (it.value && it.value.children) {
      flatten(it.value.children, out);
    } else if (it.value && typeof it.value.value !== 'undefined') {
      out[it.code] = it.value.value;
    }
  }
  return out;
}

function findAll(items, code) {
  const res = [];
  for (const it of items) {
    if (it.code === code) res.push(it);
    if (it.value && it.value.children) res.push(...findAll(it.value.children, code));
  }
  return res;
}

module.exports = { parseBuffer, flatten, findAll, CONTAINER_CODES };