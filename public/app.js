const state = {
  conn: null,
  tracks: [],
  filtered: [],
  containers: [],
  activeContainer: null,
  dbId: null,
  selected: new Set()
};

const $ = (id) => document.getElementById(id);
const log = (msg) => {
  const el = $('log');
  const line = document.createElement('div');
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  el.prepend(line);
};

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  return res.json();
}

function formatTime(sec) {
  if (!sec) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getId(t) { return t['miid'] || t.miid; }

async function loadSettings() {
  const s = await api('/api/settings');
  $('downloadDirInput').value = s.downloadDir || '';
  if (s.lastConnection) {
    $('hostInput').value = s.lastConnection.host || '';
    $('portInput').value = s.lastConnection.port || 3689;
  }
  refreshProfiles();
}

async function refreshDiscover() {
  const list = await api('/api/discover');
  const sel = $('discoveredSelect');
  sel.innerHTML = '<option value="">-- select --</option>';
  list.forEach((d) => {
    const opt = document.createElement('option');
    opt.value = JSON.stringify(d);
    opt.textContent = `${d.name} (${d.host}:${d.port})`;
    sel.appendChild(opt);
  });
}

function applyDiscovered() {
  const v = $('discoveredSelect').value;
  if (!v) return;
  const d = JSON.parse(v);
  $('hostInput').value = d.host || '';
  $('portInput').value = d.port || 3689;
}

async function connect() {
  const host = $('hostInput').value.trim();
  const port = parseInt($('portInput').value, 10) || 3689;
  const password = $('passwordInput').value;
  const downloadDir = $('downloadDirInput').value.trim();
  if (!host) { $('status').textContent = 'Host required'; return; }
  $('status').textContent = 'Connecting…';
  const res = await api('/api/connect', { method: 'POST', body: { host, port, password } });
  if (!res.ok) { $('status').textContent = 'Error: ' + res.error; log('Connect failed: ' + res.error); return; }
  state.conn = { host, port, password };
  state.dbId = res.databases.length ? (res.databases[0]['miid'] || res.databases[0].miid) : null;
  state.tracks = res.tracks || [];
  state.containers = res.containers || [];
  state.activeContainer = null;
  $('status').textContent = `Connected: ${res.info['msts'] || res.info['mstt'] || 'OK'} — ${state.tracks.length} tracks`;
  log(`Connected to ${host}:${port}. ${state.tracks.length} tracks, ${state.containers.length} playlists.`);
  // save last connection
  await api('/api/settings', { method: 'POST', body: { lastConnection: { host, port }, downloadDir } });
  renderPlaylists();
  applyFilter();
}

function renderPlaylists() {
  const ul = $('playlistList');
  ul.innerHTML = '';
  const allLi = document.createElement('li');
  allLi.textContent = `All tracks (${state.tracks.length})`;
  allLi.className = state.activeContainer === null ? 'active' : '';
  allLi.onclick = () => { state.activeContainer = null; showTracks(state.tracks); };
  ul.appendChild(allLi);
  state.containers.forEach((c) => {
    const li = document.createElement('li');
    const name = c['minm'] || 'Playlist';
    li.textContent = name;
    li.className = state.activeContainer === c['miid'] ? 'active' : '';
    li.onclick = async () => {
      const id = c['miid'];
      state.activeContainer = id;
      const res = await api('/api/container-tracks', { method: 'POST', body: { ...state.conn, dbId: state.dbId, containerId: id } });
      if (res.ok) { showTracks(res.tracks); log(`Playlist "${name}": ${res.tracks.length} tracks`); }
      else log('Playlist load failed: ' + res.error);
      renderPlaylists();
    };
    ul.appendChild(li);
  });
}

function showTracks(tracks) {
  state.tracks = tracks;
  applyFilter();
}

function applyFilter() {
  const q = $('searchInput').value.trim().toLowerCase();
  const field = $('filterSelect').value;
  state.filtered = state.tracks.filter((t) => {
    if (!q) return true;
    const name = (t['dmap.itemname'] || t.itemname || '').toLowerCase();
    const artist = (t['daap.songartist'] || '').toLowerCase();
    const album = (t['daap.songalbum'] || '').toLowerCase();
    const genre = (t['daap.songgenre'] || '').toLowerCase();
    if (field === 'artist') return artist.includes(q);
    if (field === 'album') return album.includes(q);
    if (field === 'genre') return genre.includes(q);
    if (field === 'name') return name.includes(q);
    return name.includes(q) || artist.includes(q) || album.includes(q) || genre.includes(q);
  });
  renderTracks();
}

function renderTracks() {
  const tbody = $('trackBody');
  tbody.innerHTML = '';
  state.filtered.forEach((t) => {
    const id = getId(t);
    const tr = document.createElement('tr');
    const checked = state.selected.has(id);
    tr.innerHTML = `
      <td><input type="checkbox" data-id="${id}" ${checked ? 'checked' : ''} /></td>
      <td><img class="cover" src="${artworkUrl(t)}" loading="lazy" alt="" onerror="this.style.display='none'" /></td>
      <td>${escapeHtml(t['minm'] || '')}</td>
      <td>${escapeHtml(t['asar'] || '')}</td>
      <td>${escapeHtml(t['asal'] || '')}</td>
      <td>${escapeHtml(t['asgn'] || '')}</td>
      <td>${formatTime(t['astm'] ? Math.round(t['astm'] / 1000) : 0)}</td>
      <td>${formatSize(t['assz'])}</td>
      <td class="actions">
        <button data-dl="${id}">Download</button>
        <button data-open="${id}" class="ghost">Open</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('input[type=checkbox][data-id]').forEach((cb) => {
    cb.addEventListener('change', (e) => {
      const id = e.target.dataset.id;
      if (e.target.checked) state.selected.add(id); else state.selected.delete(id);
    });
  });
  tbody.querySelectorAll('button[data-dl]').forEach((btn) => {
    btn.addEventListener('click', () => downloadOne(btn.dataset.dl));
  });
  tbody.querySelectorAll('button[data-open]').forEach((btn) => {
    btn.addEventListener('click', () => openTrack(btn.dataset.open));
  });
}

function artworkUrl(t) {
  if (!state.conn || !state.dbId) return '';
  const id = getId(t);
  const params = new URLSearchParams({
    host: state.conn.host,
    port: state.conn.port,
    password: state.conn.password || '',
    dbId: state.dbId,
    itemId: id
  });
  return '/api/artwork?' + params.toString();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function downloadOne(id) {
  const t = state.tracks.find((x) => getId(x) == id);
  if (!t) return;
  const format = (t['asfm'] || 'm4a').toLowerCase().includes('mp3') ? 'mp3' : 'm4a';
  log(`Downloading ${t['minm'] || id}…`);
  const res = await api('/api/download', { method: 'POST', body: { ...state.conn, dbId: state.dbId, itemId: id, format, name: t['minm'] } });
  if (res.ok) { log(res.skipped ? `Already downloaded: ${res.path}` : `Saved: ${res.path}`); }
  else log(`Download failed: ${res.error}`);
}

async function downloadSelected() {
  const ids = [...state.selected];
  if (!ids.length) { log('No tracks selected'); return; }
  log(`Downloading ${ids.length} selected tracks…`);
  for (const id of ids) await downloadOne(id);
  log('Batch download complete');
}

async function openTrack(id) {
  const t = state.tracks.find((x) => getId(x) == id);
  if (!t) return;
  const format = (t['asfm'] || 'm4a').toLowerCase().includes('mp3') ? 'mp3' : 'm4a';
  const safeName = (t['minm'] || ('track-' + id)).replace(/[<>:"/\\|?*]/g, '_');
  const settings = await api('/api/settings');
  const dir = settings.downloadDir;
  const filePath = dir + '\\' + safeName + '.' + format;
  await api('/api/open', { method: 'POST', body: { path: filePath } });
  log(`Opened ${filePath}`);
}

async function refreshProfiles() {
  const res = await api('/api/profiles');
  const sel = $('profileSelect');
  sel.innerHTML = '<option value="">-- select profile --</option>';
  (res.profiles || []).forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = p.name || (p.host + ':' + p.port);
    sel.appendChild(opt);
  });
}

async function loadProfile() {
  const idx = parseInt($('profileSelect').value, 10);
  if (isNaN(idx)) return;
  const res = await api('/api/profiles');
  const p = (res.profiles || [])[idx];
  if (!p) return;
  $('hostInput').value = p.host || '';
  $('portInput').value = p.port || 3689;
  $('passwordInput').value = p.password || '';
  $('downloadDirInput').value = p.downloadDir || $('downloadDirInput').value;
  log('Loaded profile: ' + (p.name || p.host));
}

async function saveProfile() {
  const name = prompt('Profile name:');
  if (!name) return;
  const profile = {
    name,
    host: $('hostInput').value.trim(),
    port: parseInt($('portInput').value, 10) || 3689,
    password: $('passwordInput').value,
    downloadDir: $('downloadDirInput').value.trim()
  };
  await api('/api/profiles', { method: 'POST', body: profile });
  await refreshProfiles();
  log('Saved profile: ' + name);
}

async function deleteProfile() {
  const idx = parseInt($('profileSelect').value, 10);
  if (isNaN(idx)) return;
  await api('/api/profiles', { method: 'DELETE', body: { index: idx } });
  await refreshProfiles();
  log('Deleted profile');
}

// events
$('btnRefreshDiscover').addEventListener('click', refreshDiscover);
$('discoveredSelect').addEventListener('change', applyDiscovered);
$('btnConnect').addEventListener('click', connect);
$('btnSaveSettings').addEventListener('click', async () => {
  await api('/api/settings', { method: 'POST', body: { downloadDir: $('downloadDirInput').value.trim() } });
  log('Settings saved');
});
$('searchInput').addEventListener('input', applyFilter);
$('filterSelect').addEventListener('change', applyFilter);
$('btnDownloadSelected').addEventListener('click', downloadSelected);
$('selectAll').addEventListener('change', (e) => {
  if (e.target.checked) state.filtered.forEach((t) => state.selected.add(getId(t)));
  else state.filtered.forEach((t) => state.selected.delete(getId(t)));
  renderTracks();
});
$('btnTheme').addEventListener('click', () => {
  document.body.classList.toggle('light');
  const mode = document.body.classList.contains('light') ? 'light' : 'dark';
  localStorage.setItem('theme', mode);
  $('btnTheme').textContent = mode === 'light' ? 'Dark' : 'Light';
});
// restore theme
(function () {
  const saved = localStorage.getItem('theme');
  if (saved === 'light') document.body.classList.add('light');
  $('btnTheme').textContent = document.body.classList.contains('light') ? 'Dark' : 'Light';
})();

$('btnLoadProfile').addEventListener('click', loadProfile);
$('btnSaveProfile').addEventListener('click', saveProfile);
$('btnDeleteProfile').addEventListener('click', deleteProfile);

$('btnAbout').addEventListener('click', () => $('aboutModal').classList.remove('hidden'));
$('closeAbout').addEventListener('click', () => $('aboutModal').classList.add('hidden'));

loadSettings();
refreshDiscover();
setInterval(refreshDiscover, 8000);