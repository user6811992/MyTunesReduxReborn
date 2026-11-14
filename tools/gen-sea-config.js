// MyTunes Redux Reborn
// Copyright (c) 2026 MyTunes Redux Reborn Contributors
// SPDX-License-Identifier: MIT
// See LICENSE file in the repository root.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pub = path.join(root, 'public');
const assets = {};

function walk(dir, prefix) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    const key = prefix ? prefix + '/' + e.name : e.name;
    if (e.isDirectory()) walk(full, key);
    else assets['public/' + key.replace(/\\/g, '/')] = path.relative(root, full).replace(/\\/g, '/');
  }
}
walk(pub, '');

const cfg = {
  main: 'sea-main.js',
  output: 'sea-prep.blob',
  disableExperimentalSEAWarning: true,
  assets
};
fs.writeFileSync(path.join(root, 'sea-config.json'), JSON.stringify(cfg, null, 2));
console.log('Generated sea-config.json with', Object.keys(assets).length, 'assets');