const test = require('node:test');
const assert = require('node:assert');
const { parseBuffer, findAll, flatten } = require('../lib/dmap');

test('parses a simple DMAP container', () => {
  const nameBuf = Buffer.from('Hello\0', 'utf8');
  const code = Buffer.from('minm', 'ascii');
  const lenBuf = Buffer.alloc(4); lenBuf.writeUInt32BE(nameBuf.length, 0);
  const nameAtom = Buffer.concat([code, lenBuf, nameBuf]);

  const itemCode = Buffer.from('mlit', 'ascii');
  const itemLen = Buffer.alloc(4); itemLen.writeUInt32BE(nameAtom.length, 0);
  const itemAtom = Buffer.concat([itemCode, itemLen, nameAtom]);

  const listCode = Buffer.from('mlcl', 'ascii');
  const listLen = Buffer.alloc(4); listLen.writeUInt32BE(itemAtom.length, 0);
  const listAtom = Buffer.concat([listCode, listLen, itemAtom]);

  const items = parseBuffer(listAtom);
  const mlits = findAll(items, 'mlit');
  assert.strictEqual(mlits.length, 1);
  const f = flatten(mlits[0].value.children);
  assert.strictEqual(f['minm'], 'Hello');
});