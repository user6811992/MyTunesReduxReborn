const state = {
  conn: null,
  tracks: [],
  filtered: [],
  containers: [],
  activeContainer: null,
  dbId: null,
  selected: new Set(),
  ratings: {}
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
  $('browserModeSelect').value = s.browserMode || 'edge';
  if (s.lastConnection) {
    $('hostInput').value = s.lastConnection.host || '';
    $('portInput').value = s.lastConnection.port || 3689;
  }
  refreshProfiles();
  const r = await api('/api/ratings');
  state.ratings = r.ratings || {};
  renderSmartViews();
  // scrobble token
  const tok = localStorage.getItem('lbToken') || '';
  $('lbTokenInput').value = tok;
  $('lfmApiKeyInput').value = localStorage.getItem('lfmApiKey') || '';
  $('lfmSecretInput').value = localStorage.getItem('lfmSecret') || '';
  $('lfmSessionInput').value = localStorage.getItem('lfmSession') || '';
  refreshAirplay();
  refreshSmartPlaylists();
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
  renderSmartViews();
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

function renderSmartViews() {
  const ul = $('smartViewList');
  ul.innerHTML = '';
  const views = [
    { name: 'Top Rated (4+)', fn: (t) => (state.ratings[getId(t)]?.rating || 0) >= 4 },
    { name: 'Most Played', fn: (t) => (state.ratings[getId(t)]?.plays || 0) > 0, sort: (a,b) => (state.ratings[getId(b)]?.plays||0) - (state.ratings[getId(a)]?.plays||0) },
    { name: 'Unrated', fn: (t) => !(state.ratings[getId(t)]?.rating) },
    { name: 'All Tracks', fn: () => true }
  ];
  views.forEach((v) => {
    const li = document.createElement('li');
    li.textContent = v.name;
    li.onclick = () => {
      let list = state.tracks.filter(v.fn);
      if (v.sort) list = list.sort(v.sort);
      showTracks(list);
      log('Smart view: ' + v.name + ' (' + list.length + ')');
    };
    ul.appendChild(li);
  });
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
    const rating = (state.ratings[id] && state.ratings[id].rating) || 0;
    const stars = [1,2,3,4,5].map((n) => `<span class="star" data-rate="${id}" data-val="${n}" style="cursor:pointer;color:${n <= rating ? '#f59f00' : '#555'}">★</span>`).join('');
    tr.innerHTML = `
      <td><input type="checkbox" data-id="${id}" ${checked ? 'checked' : ''} /></td>
      <td><img class="cover" src="${artworkUrl(t)}" loading="lazy" alt="" onerror="coverFallback(this, ${JSON.stringify(t['asar']||'')}, ${JSON.stringify(t['asal']||'')})" /></td>
      <td>${escapeHtml(t['minm'] || '')}</td>
      <td>${escapeHtml(t['asar'] || '')}</td>
      <td>${escapeHtml(t['asal'] || '')}</td>
      <td>${escapeHtml(t['asgn'] || '')}</td>
      <td>${formatTime(t['astm'] ? Math.round(t['astm'] / 1000) : 0)}</td>
      <td>${formatSize(t['assz'])}</td>
      <td>${stars}</td>
      <td class="actions">
        <button data-dl="${id}">Download</button>
        <button data-open="${id}" class="ghost">Open</button>
        <button data-lyrics="${id}" class="ghost">Lyrics</button>
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
  tbody.querySelectorAll('button[data-lyrics]').forEach((btn) => {
    btn.addEventListener('click', () => showLyrics(btn.dataset.lyrics));
  });
  tbody.querySelectorAll('.star').forEach((star) => {
    star.addEventListener('click', async () => {
      const id = star.dataset.rate;
      const val = parseInt(star.dataset.val, 10);
      if (!state.ratings[id]) state.ratings[id] = { rating: 0, plays: 0 };
      state.ratings[id].rating = val;
      await api('/api/ratings', { method: 'POST', body: { id, rating: val, plays: state.ratings[id].plays || 0 } });
      renderTracks();
      renderSmartViews();
    });
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

async function coverFallback(img, artist, album) {
  try {
    const res = await api('/api/cover-search?artist=' + encodeURIComponent(artist) + '&album=' + encodeURIComponent(album));
    if (res.artwork) img.src = res.artwork;
    else img.style.display = 'none';
  } catch (e) {
    img.style.display = 'none';
  }
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
  if (res.ok) {
    log(res.skipped ? `Already downloaded: ${res.path}` : `Saved: ${res.path}`);
    if (!state.ratings[id]) state.ratings[id] = { rating: 0, plays: 0 };
    state.ratings[id].plays = (state.ratings[id].plays || 0) + 1;
    await api('/api/ratings', { method: 'POST', body: { id, rating: state.ratings[id].rating || 0, plays: state.ratings[id].plays } });
    scrobbleTrack(t, 'submit');
    scrobbleLastfm(t, 'submit');
  }
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

async function scanNetwork() {
  const btn = $('btnScanNetwork');
  btn.disabled = true;
  btn.textContent = 'Scanning…';
  const res = await api('/api/scan', { method: 'POST', body: {} });
  btn.disabled = false;
  btn.textContent = 'Scan network';
  const ul = $('scanResults');
  ul.innerHTML = '';
  if (!res.results || !res.results.length) {
    const li = document.createElement('li');
    li.textContent = 'No DAAP services found on local subnets';
    ul.appendChild(li);
    log('Network scan complete: no open port 3689 hosts');
    return;
  }
  res.results.forEach((r) => {
    const li = document.createElement('li');
    li.textContent = `${r.ip}:${r.port}`;
    li.onclick = () => { $('hostInput').value = r.ip; $('portInput').value = r.port; };
    ul.appendChild(li);
  });
  log(`Network scan complete: ${res.results.length} host(s) found`);
}

async function showLyrics(id) {
  const t = state.tracks.find((x) => getId(x) == id);
  if (!t) return;
  $('lyricsTitle').textContent = t['minm'] || 'Lyrics';
  $('lyricsBody').textContent = 'Loading…';
  $('lyricsModal').classList.remove('hidden');
  const res = await api('/api/lyrics?artist=' + encodeURIComponent(t['asar'] || '') + '&title=' + encodeURIComponent(t['minm'] || ''));
  $('lyricsBody').textContent = res.lyrics || 'No lyrics found.';
}

async function scrobbleTrack(t, type) {
  const token = localStorage.getItem('lbToken') || '';
  if (!token) return;
  await api('/api/scrobble', {
    method: 'POST',
    body: {
      service: 'listenbrainz',
      token,
      type,
      artist: t['asar'] || '',
      title: t['minm'] || '',
      album: t['asal'] || ''
    }
  });
}

async function refreshAirplay() {
  const res = await api('/api/airplay');
  const ul = $('airplayList');
  ul.innerHTML = '';
  (res || []).forEach((d) => {
    const li = document.createElement('li');
    li.textContent = `${d.name} (${d.host}:${d.port})`;
    ul.appendChild(li);
  });
  if (!res || !res.length) {
    const li = document.createElement('li');
    li.textContent = 'No AirPlay devices found';
    ul.appendChild(li);
  }
}

async function loadPodcast() {
  const url = $('podcastUrlInput').value.trim();
  if (!url) return;
  const res = await api('/api/podcast', { method: 'POST', body: { url } });
  if (res.error) { log('Podcast load failed: ' + res.error); return; }
  const ul = $('podcastEpisodes');
  ul.innerHTML = '';
  (res.episodes || []).forEach((ep) => {
    const li = document.createElement('li');
    li.textContent = ep.title;
    li.title = ep.url;
    li.onclick = async () => {
      // download episode
      const dir = ($('downloadDirInput').value.trim() || '') + '';
      const safe = ep.title.replace(/[<>:"/\\\\|?*]/g, '_');
      // use fetch via server? just open URL
      window.open(ep.url, '_blank');
      log('Opened episode: ' + ep.title);
    };
    ul.appendChild(li);
  });
  log(`Podcast "${res.title}": ${res.episodes.length} episodes`);
}

// Smart Playlists
function applySmartPlaylist(sp) {
  if (!sp || !sp.rules) return;
  const filtered = state.tracks.filter((t) => {
    return sp.rules.every((rule) => {
      const field = rule.field;
      let val;
      if (field === 'rating') val = state.ratings[getId(t)]?.rating || 0;
      else if (field === 'plays') val = state.ratings[getId(t)]?.plays || 0;
      else val = t[field] || '';
      const rv = rule.value;
      if (rule.op === 'contains') return String(val).toLowerCase().includes(String(rv).toLowerCase());
      if (rule.op === 'equals') return String(val).toLowerCase() === String(rv).toLowerCase();
      if (rule.op === 'gt') return Number(val) > Number(rv);
      if (rule.op === 'lt') return Number(val) < Number(rv);
      return true;
    });
  });
  showTracks(filtered);
  log('Smart playlist: ' + sp.name + ' (' + filtered.length + ')');
}

async function refreshSmartPlaylists() {
  const res = await api('/api/smartplaylists');
  const sel = $('spSelect');
  sel.innerHTML = '';
  (res.items || []).forEach((sp, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = sp.name;
    sel.appendChild(opt);
  });
}

async function saveSmartPlaylist() {
  const name = $('spNameInput').value.trim();
  if (!name) { log('Smart playlist name required'); return; }
  const sp = {
    name,
    rules: [{ field: $('spFieldSelect').value, op: $('spOpSelect').value, value: $('spValueInput').value }]
  };
  await api('/api/smartplaylists', { method: 'POST', body: sp });
  await refreshSmartPlaylists();
  log('Saved smart playlist: ' + name);
}

async function applySelectedSmartPlaylist() {
  const idx = parseInt($('spSelect').value, 10);
  const res = await api('/api/smartplaylists');
  const sp = (res.items || [])[idx];
  if (sp) applySmartPlaylist(sp);
}

async function deleteSelectedSmartPlaylist() {
  const idx = parseInt($('spSelect').value, 10);
  await api('/api/smartplaylists', { method: 'DELETE', body: { index: idx } });
  await refreshSmartPlaylists();
  log('Deleted smart playlist');
}

// Last.fm scrobble helper
async function scrobbleLastfm(t, type) {
  const apiKey = localStorage.getItem('lfmApiKey') || '';
  const secret = localStorage.getItem('lfmSecret') || '';
  const sessionKey = localStorage.getItem('lfmSession') || '';
  if (!apiKey || !secret || !sessionKey) return;
  await api('/api/scrobble-lastfm', {
    method: 'POST',
    body: {
      apiKey, secret, sessionKey,
      type,
      artist: t['asar'] || '',
      title: t['minm'] || '',
      album: t['asal'] || ''
    }
  });
}

// events
$('btnRefreshDiscover').addEventListener('click', refreshDiscover);
$('btnScanNetwork').addEventListener('click', scanNetwork);
$('discoveredSelect').addEventListener('change', applyDiscovered);
$('btnConnect').addEventListener('click', connect);
$('btnSaveSettings').addEventListener('click', async () => {
  await api('/api/settings', { method: 'POST', body: { downloadDir: $('downloadDirInput').value.trim(), browserMode: $('browserModeSelect').value } });
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

$('btnRefreshAirplay').addEventListener('click', refreshAirplay);
$('btnLoadPodcast').addEventListener('click', loadPodcast);
$('btnSaveSP').addEventListener('click', saveSmartPlaylist);
$('btnApplySP').addEventListener('click', applySelectedSmartPlaylist);
$('btnDeleteSP').addEventListener('click', deleteSelectedSmartPlaylist);

// Last.fm settings save
const saveLfm = () => {
  localStorage.setItem('lfmApiKey', $('lfmApiKeyInput').value.trim());
  localStorage.setItem('lfmSecret', $('lfmSecretInput').value.trim());
  localStorage.setItem('lfmSession', $('lfmSessionInput').value.trim());
  log('Last.fm settings saved');
};
$('lfmApiKeyInput').addEventListener('change', saveLfm);
$('lfmSecretInput').addEventListener('change', saveLfm);
$('lfmSessionInput').addEventListener('change', saveLfm);
$('closeLyrics').addEventListener('click', () => $('lyricsModal').classList.add('hidden'));

$('btnPlayRadio').addEventListener('click', () => {
  const url = $('radioUrlInput').value.trim();
  if (!url) return;
  $('radioPlayer').src = url;
  $('radioPlayer').play();
  log('Playing radio: ' + url);
});
$('btnStopRadio').addEventListener('click', () => {
  $('radioPlayer').pause();
  $('radioPlayer').src = '';
});
$('btnSaveScrobble').addEventListener('click', () => {
  localStorage.setItem('lbToken', $('lbTokenInput').value.trim());
  log('Scrobble token saved');
});
$('btnTestScrobble').addEventListener('click', async () => {
  const tok = $('lbTokenInput').value.trim();
  localStorage.setItem('lbToken', tok);
  const res = await api('/api/scrobble', { method: 'POST', body: { service: 'listenbrainz', token: tok, type: 'nowplaying', artist: 'Test', title: 'Test Track', album: 'Test Album' } });
  $('scrobbleStatus').textContent = res.ok ? 'Scrobble OK' : ('Scrobble failed: ' + (res.error || res.status));
});

loadSettings();
refreshDiscover();
setInterval(refreshDiscover, 8000);