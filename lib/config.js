// MyTunes Redux Reborn
// Copyright (c) 2026 MyTunes Redux Reborn Contributors
// SPDX-License-Identifier: MIT
// See LICENSE file in the repository root.

const fs = require('fs');
const path = require('path');
const os = require('os');

function appDir() {
  // Packaged (SEA) builds and dev both store user data in an OS-appropriate,
  // writable location rather than next to the (possibly read-only) executable.
  if (process.env.MYTUNES_DATA_DIR) return process.env.MYTUNES_DATA_DIR;
  const home = os.homedir();
  switch (process.platform) {
    case 'win32':
      return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'MyTunesReduxReborn');
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', 'MyTunesReduxReborn');
    default:
      return path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'MyTunesReduxReborn');
  }
}
const DATA_DIR = appDir();
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const RATINGS_FILE = path.join(DATA_DIR, 'ratings.json');

function defaults() {
  return {
    downloadDir: path.join(os.homedir(), 'Music', 'MyTunesReduxReborn'),
    connections: [],
    lastConnection: null
  };
}

function ensureDir() {
  try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
}

function load() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
      return { ...defaults(), ...JSON.parse(raw) };
    }
  } catch (e) {}
  return defaults();
}

function save(settings) {
  try {
    ensureDir();
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } catch (e) {}
}

function loadRatings() {
  try {
    if (fs.existsSync(RATINGS_FILE)) return JSON.parse(fs.readFileSync(RATINGS_FILE, 'utf8'));
  } catch (e) {}
  return {};
}

function saveRatings(data) {
  try {
    ensureDir();
    fs.writeFileSync(RATINGS_FILE, JSON.stringify(data, null, 2));
  } catch (e) {}
}

module.exports = { load, save, defaults, DATA_DIR, SETTINGS_FILE, RATINGS_FILE, loadRatings, saveRatings, appDir };