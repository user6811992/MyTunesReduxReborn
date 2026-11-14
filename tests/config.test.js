// MyTunes Redux Reborn
// Copyright (c) 2026 MyTunes Redux Reborn Contributors
// SPDX-License-Identifier: MIT
// See LICENSE file in the repository root.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mtrr-'));
process.env.MYTUNES_DATA_DIR = tmp;

const config = require('../lib/config');

test('config load returns defaults when no file', () => {
  const s = config.load();
  assert.strictEqual(s.connections.length, 0);
  assert.ok(s.downloadDir);
});

test('config save/load round trips', () => {
  const s = config.load();
  s.connections.push({ name: 'x', host: 'h', port: 3689 });
  config.save(s);
  const s2 = config.load();
  assert.strictEqual(s2.connections.length, 1);
  assert.strictEqual(s2.connections[0].name, 'x');
});

test('ratings round trip', () => {
  config.saveRatings({ a: { rating: 5, plays: 2, updated: 1 } });
  const r = config.loadRatings();
  assert.strictEqual(r.a.rating, 5);
});