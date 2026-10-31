const fs = require('fs');
const path = require('path');

function appDir() {
  try {
    const sea = require('node:sea');
    if (sea.isSea()) return path.dirname(process.execPath);
  } catch (e) {}
  return path.join(__dirname, '..');
}
const DATA_DIR = path.join(appDir(), 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

function defaults() {
  return {
    downloadDir: path.join(require('os').homedir(), 'Music', 'MyTunesReduxReborn'),
    connections: [],
    lastConnection: null
  };
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
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } catch (e) {}
}

module.exports = { load, save, defaults, DATA_DIR, SETTINGS_FILE };