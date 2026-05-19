const RS_INDEX = 'https://radiostudent.si/ostalo/glasbene-opreme';
const SPOTIFY_CACHE_KEY = 'rsSpotifyTrackCache:v1';
const QUEUE_SOURCE_KEY = 'rsSpotifyQueueSource:v1';
const LAST_TRACKLIST_KEY = 'rsLastTracklist:v1';
// Optional for GitHub Pages: paste your Spotify app Client ID here.
// This is not a secret when using PKCE; it is safe to ship in static frontend code.
const BUILT_IN_SPOTIFY_CLIENT_ID = '6470ecc276f1465cad092bd8ab210d46';
const SPOTIFY_CLIENT_ID_OVERRIDE_KEY = 'spotifyClientIdOverride:v1';

const $ = (id) => document.getElementById(id);
const state = { tracks: [], currentUrl: '', currentTitle: '', spotifyToken: null, playbackTimer: null, currentPlayback: null, webPlayer: null, webDeviceId: null };
const spotifySdkReady = new Promise(resolve => {
  window.onSpotifyWebPlaybackSDKReady = resolve;
});

$('spotifyLogin').addEventListener('click', toggleSpotifyConnection);
setSpotifyConnected(false);
$('loadLatest').addEventListener('click', loadLatestLists);
$('listSelect').addEventListener('change', () => {
  const opt = $('listSelect').selectedOptions[0];
  if (opt?.value) loadTracklist(opt.value, opt.textContent);
});
$('loadUrl').addEventListener('click', () => loadTracklist($('detailUrl').value.trim()));
$('copyTracks').addEventListener('click', copyTracks);
$('createPlaylist').addEventListener('click', () => createPlaylistFromCurrentDay($('createPlaylist')));
$('playDay').addEventListener('click', () => {
  const source = getQueueSource();
  if (state.currentPlayback?.is_playing && source?.url === state.currentUrl) return spotifyPlayPause(state.currentPlayback);
  playCurrentDay($('playDay'));
});
$('openSpotify').addEventListener('click', () => matchTracksOnly($('openSpotify')));
handleSpotifyRedirect();
restoreLastTracklist();
loadLatestLists();

function setStatus(message, isError = false) {
  $('status').textContent = message || '';
  $('status').className = isError ? 'error' : '';
}

function setPlaylistStatus(message, isError = false) {
  $('playlistStatus').textContent = message || '';
  $('playlistStatus').className = `playlistStatus ${isError ? 'error' : ''}`;
}

function setPlaylistProgress(current, total) {
  const pct = total ? Math.max(0, Math.min(100, current / total * 100)) : 0;
  $('playlistStatus').style.setProperty('--progress', `${pct}%`);
  $('playlistStatus').classList.add('withProgress');
}

function clearPlaylistProgress() {
  $('playlistStatus').style.removeProperty('--progress');
  $('playlistStatus').classList.remove('withProgress');
}

function setSpotifyConnected(connected) {
  const button = $('spotifyLogin');
  const dot = $('spotifyState');
  button.classList.toggle('connected', connected);
  button.querySelector('.spotifyText').textContent = connected ? 'Connected' : 'Connect';
  button.setAttribute('aria-label', connected ? 'Spotify connected' : 'Connect Spotify');
  button.title = connected ? 'Spotify connected' : 'Connect Spotify';
  dot.className = `connectionDot ${connected ? 'connected' : 'disconnected'}`;
}

function proxied(url) {
  // Jina's reader proxy works reliably for Radio Študent and avoids browser CORS issues.
  return 'https://r.jina.ai/http://r.jina.ai/http://' + url.replace(/^https?:\/\//, 'https://');
}

async function fetchText(url) {
  const res = await fetch(proxied(url));
  if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
  return res.text();
}

async function loadLatestLists() {
  try {
    setStatus('Loading Radio Študent lists…');
    $('lists').textContent = 'Loading…';
    const html = await fetchText(RS_INDEX);
    const lists = parseIndex(html);
    if (!lists.length) throw new Error('Could not find tracklist links. Try another fetch mode.');
    renderLists(lists);
    setStatus(`Found ${lists.length} recent lists.`);
  } catch (err) {
    $('lists').textContent = 'Nothing loaded.';
    setStatus(err.message, true);
  }
}

function parseIndex(html) {
  if (html.includes('<html')) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const seen = new Set();
    return [...doc.querySelectorAll('a[href*="/ostalo/glasbene-opreme/"]')]
      .map(a => ({
        url: new URL(a.getAttribute('href'), 'https://radiostudent.si').href,
        title: clean(a.textContent)
      }))
      .filter(x => x.title && /seznam/i.test(x.title) && !seen.has(x.url) && seen.add(x.url))
      .slice(0, 30);
  }

  // Markdown-ish fallback for reader proxies. Jina sometimes uses image links
  // whose alt text is not the article title, so collect URLs first and derive a
  // readable title from nearby date/subtitle text when needed.
  const seen = new Set();
  return [...html.matchAll(/\]\((https:\/\/radiostudent\.si\/ostalo\/glasbene-opreme\/[^)]+)\)/gi)]
    .map(m => {
      const url = m[1];
      const before = html.slice(Math.max(0, m.index - 250), m.index);
      const after = html.slice(m.index + m[0].length, m.index + m[0].length + 260);
      const alt = (before.match(/!\[[^:\]]*:\s*([^\]]+)\]$/) || before.match(/\[([^\]]+)\]$/) || [,''])[1];
      const meta = extractIndexMeta(after, url);
      return { url, title: clean(alt || meta || slugTitle(url)) };
    })
    .filter(x => /seznam|glasbe|komadov/i.test(x.url) && !seen.has(x.url) && seen.add(x.url))
    .slice(0, 30);
}

function extractIndexMeta(after, url) {
  return parseIndexTitleFromMarkdownContext(after, url);
}

function slugTitle(url) {
  return decodeURIComponent(url.split('/').pop() || url).replace(/-/g, ' ');
}

function renderLists(lists) {
  $('lists').classList.remove('empty');
  $('lists').innerHTML = '';
  $('listSelect').innerHTML = '<option value="">Select a day…</option>';
  for (const item of lists) {
    const option = document.createElement('option');
    option.value = item.url;
    option.textContent = item.title;
    $('listSelect').append(option);
    const row = document.createElement('div');
    row.className = 'listRow';
    const b = document.createElement('button');
    b.className = 'listItem';
    b.innerHTML = `<span>${escapeHtml(item.title)}</span><a class="listExternal" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer" title="Open original Radio Študent page" aria-label="Open original Radio Študent page">↗</a>`;
    b.addEventListener('click', () => loadTracklist(item.url, item.title));
    b.querySelector('.listExternal').addEventListener('click', ev => ev.stopPropagation());
    const play = document.createElement('button');
    play.className = 'listPlay';
    play.dataset.url = item.url;
    play.textContent = '▶';
    play.title = 'Load this day and play it through Spotify';
    play.addEventListener('click', async () => {
      const source = getQueueSource();
      if (state.currentPlayback?.is_playing && source?.url === item.url) {
        return spotifyPlayPause(state.currentPlayback);
      }
      await loadTracklist(item.url, item.title);
      playCurrentDay(play);
    });
    row.append(b, play);
    $('lists').append(row);
  }
  updateDayPlayIndicators(state.currentPlayback);
  if (state.currentUrl) $('listSelect').value = state.currentUrl;
}

async function loadTracklist(url, knownTitle = '') {
  if (!url) return setStatus('Paste a Radio Študent tracklist URL first.', true);
  try {
    $('playlistTitle').textContent = knownTitle || 'Loading tracklist…';
    $('sourceLink').textContent = '↗';
    $('sourceLink').href = url;
    $('sourceLink').classList.remove('hidden');
    $('tracks').classList.add('empty');
    $('tracks').textContent = 'Loading tracklist…';
    setPlaylistStatus('');
    const html = await fetchText(url);
    const parsed = parseDetail(html, knownTitle);
    if (!parsed.tracks.length) throw new Error('No tracks found. Try another fetch mode or a different URL.');
    state.tracks = parsed.tracks;
    state.currentUrl = url;
    state.currentTitle = parsed.title || knownTitle || 'Radio Študent tracklist';
    $('listSelect').value = state.currentUrl;
    localStorage.setItem(LAST_TRACKLIST_KEY, JSON.stringify({ url: state.currentUrl, title: state.currentTitle, at: Date.now() }));
    renderTracks();
    setPlaylistStatus(`${state.tracks.length} tracks`);
  } catch (err) {
    setPlaylistStatus(err.message, true);
  }
}

async function restoreLastTracklist() {
  try {
    const last = JSON.parse(localStorage.getItem(LAST_TRACKLIST_KEY) || 'null');
    if (last?.url) await loadTracklist(last.url, last.title);
  } catch (err) {
    console.warn('Could not restore last tracklist', err);
  }
}

function parseDetail(html, knownTitle) {
  if (!html.includes('<html')) return parseMarkdownDetail(html, knownTitle);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const title = clean(doc.querySelector('h1, meta[property="og:title"]')?.textContent || doc.querySelector('meta[property="og:title"]')?.content || knownTitle);
  return { title, tracks: parseTracksFromHtml(html) };
}

function parseMarkdownDetail(md, knownTitle) {
  const title = clean((md.match(/^Title:\s*(.+)$/m) || [,''])[1] || knownTitle);
  return { title, tracks: parseTracksFromMarkdown(md) };
}

function renderTracks() {
  $('playlistTitle').textContent = state.currentTitle;
  $('sourceLink').textContent = '↗';
  $('sourceLink').href = state.currentUrl;
  $('sourceLink').classList.remove('hidden');
  $('tracks').classList.remove('empty');
  $('tracks').innerHTML = '';
  for (const track of state.tracks) {
    const cached = getCachedSpotifyMatch(track);
    if (cached?.uri) track.spotifyUri = cached.uri;
    const li = document.createElement('li');
    const missing = cached === null || track.spotifyMissing;
    if (track.spotifyUri) li.dataset.spotifyUri = track.spotifyUri;
    if (missing) li.classList.add('missing');
    li.innerHTML = `<div class="trackTop"><span class="trackMain"><span class="trackTitle">${escapeHtml(track.artist)}</span> — ${escapeHtml(track.title)}${track.spotifyUri ? '<span class="foundMark" title="Matched on Spotify">matched</span>' : ''}${missing ? '<span class="missingMark" title="Not found on Spotify">not found</span>' : ''}</span><button class="trackPlay" title="Play this track in Spotify" aria-label="Play ${escapeHtml(track.artist)} - ${escapeHtml(track.title)}">▶</button></div>`;
    li.querySelector('.trackPlay').addEventListener('click', async () => {
      if (li.classList.contains('playing')) {
        await updateNowPlaying();
        return spotifyPlayPause(state.currentPlayback || { is_playing: li.querySelector('.trackPlay').textContent === '⏸', item: { uri: track.spotifyUri } });
      }
      playSingleTrack(track);
    });
    $('tracks').append(li);
  }
  $('copyTracks').disabled = $('openSpotify').disabled = $('playDay').disabled = $('createPlaylist').disabled = false;
}

function toggleSpotifyConnection() {
  if (state.spotifyToken) {
    state.spotifyToken = null;
    sessionStorage.removeItem('spotifyToken');
    if (state.playbackTimer) clearInterval(state.playbackTimer);
    renderNowPlaying(null);
    setSpotifyConnected(false);
    setStatus('Spotify disconnected.');
    return;
  }
  connectSpotify();
}

async function connectSpotify() {
  const clientId = getSpotifyClientId();
  if (!clientId) return setStatus('Enter your Spotify Client ID first.', true);
  const verifier = randomString(96);
  sessionStorage.setItem('spotifyVerifier', verifier);
  const challenge = await sha256Base64Url(verifier);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: 'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state playlist-modify-private playlist-modify-public',
    redirect_uri: location.origin + location.pathname,
    code_challenge_method: 'S256',
    code_challenge: challenge
  });
  location.href = 'https://accounts.spotify.com/authorize?' + params;
}

function getSpotifyClientId() {
  return localStorage.getItem(SPOTIFY_CLIENT_ID_OVERRIDE_KEY) || BUILT_IN_SPOTIFY_CLIENT_ID;
}

async function handleSpotifyRedirect() {
  const code = new URLSearchParams(location.search).get('code');
  const saved = JSON.parse(sessionStorage.getItem('spotifyToken') || 'null');
  if (saved && saved.expiresAt > Date.now() + 60000) {
    state.spotifyToken = saved.access_token;
    setSpotifyConnected(true);
    ensureWebPlayer().catch(err => console.warn('Spotify web player unavailable', err));
    startPlaybackPolling();
  }
  if (!code) return;

  try {
    const clientId = getSpotifyClientId();
    const verifier = sessionStorage.getItem('spotifyVerifier');
    const body = new URLSearchParams({
      client_id: clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: location.origin + location.pathname,
      code_verifier: verifier
    });
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    const token = await res.json();
    if (!res.ok) throw new Error(token.error_description || token.error || 'Spotify auth failed');
    token.expiresAt = Date.now() + token.expires_in * 1000;
    sessionStorage.setItem('spotifyToken', JSON.stringify(token));
    state.spotifyToken = token.access_token;
    setSpotifyConnected(true);
    ensureWebPlayer().catch(err => console.warn('Spotify web player unavailable', err));
    startPlaybackPolling();
    history.replaceState({}, '', location.origin + location.pathname);
    const pending = JSON.parse(sessionStorage.getItem('pendingPlay') || 'null');
    sessionStorage.removeItem('pendingPlay');
    if (pending?.url) {
      await loadTracklist(pending.url, pending.title);
      playCurrentDay();
    } else {
      setStatus('Spotify connected. Load a day, then click “Play day in Spotify”.');
    }
  } catch (err) {
    setStatus(err.message, true);
  }
}

async function ensureWebPlayer() {
  if (!state.spotifyToken) throw new Error('Connect Spotify first.');
  if (state.webDeviceId) return state.webDeviceId;
  if (!window.Spotify) await spotifySdkReady;
  if (!window.Spotify?.Player) throw new Error('Spotify Web Playback SDK is not available in this browser.');

  return new Promise((resolve, reject) => {
    if (state.webPlayer) return resolve(state.webDeviceId);
    const player = new Spotify.Player({
      name: 'Študent naj bo!',
      getOAuthToken: cb => cb(state.spotifyToken),
      volume: 0.8
    });
    state.webPlayer = player;
    player.addListener('ready', ({ device_id }) => {
      state.webDeviceId = device_id;
      spotifyApi('/me/player', { method: 'PUT', body: JSON.stringify({ device_ids: [device_id], play: false }) })
        .catch(err => console.warn('Could not transfer playback to web player', err))
        .finally(() => resolve(device_id));
    });
    player.addListener('not_ready', ({ device_id }) => {
      if (state.webDeviceId === device_id) state.webDeviceId = null;
    });
    player.addListener('initialization_error', ({ message }) => reject(new Error(message)));
    player.addListener('authentication_error', ({ message }) => reject(new Error(message)));
    player.addListener('account_error', ({ message }) => reject(new Error(message)));
    player.addListener('playback_error', ({ message }) => console.warn('Spotify playback error', message));
    player.connect().then(ok => {
      if (!ok) reject(new Error('Could not connect Spotify web player.'));
    });
  });
}

async function getPlaybackDeviceId() {
  try { return await ensureWebPlayer(); }
  catch (err) {
    console.warn('Using existing Spotify device instead of web player:', err);
    const playback = await spotifyApi('/me/player').catch(() => null);
    return playback?.device?.id || null;
  }
}

async function spotifyApi(path, options = {}) {
  if (!state.spotifyToken) throw new Error('Connect Spotify first.');
  const res = await fetch('https://api.spotify.com/v1' + path, {
    ...options,
    headers: {
      Authorization: 'Bearer ' + state.spotifyToken,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data?.error?.message || data?.message || `Spotify API failed (${res.status})`);
  return data;
}

async function safeJson(res) {
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); }
  catch { return { message: text }; }
}

async function findSpotifyTrack(track) {
  const cached = getCachedSpotifyMatch(track);
  if (cached !== undefined) return cached;

  // Spotify search will happily return a vaguely related track when the real one
  // is missing. Search several candidates, then verify artist/title similarity and
  // skip uncertain matches instead of playing wrong songs.
  const queries = [
    `artist:${quoteSpotifyQuery(track.artist)} track:${quoteSpotifyQuery(track.title)}`,
    `${track.artist} ${track.title}`
  ];

  const seen = new Set();
  const candidates = [];
  for (const q of queries) {
    const result = await spotifyApi('/search?' + new URLSearchParams({ type: 'track', limit: '10', q }));
    for (const item of result.tracks.items) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        candidates.push(item);
      }
    }
  }

  let best = null;
  for (const item of candidates) {
    const score = spotifyMatchScore(track, item);
    if (!best || score.total > best.score.total) best = { item, score };
  }

  // Both sides must be plausible. This intentionally prefers missing/skipped
  // tracks over false positives.
  if (best && best.score.title >= 0.72 && best.score.artist >= 0.55 && best.score.total >= 0.68) {
    setCachedSpotifyMatch(track, best.item);
    return best.item;
  }
  setCachedSpotifyMatch(track, null);
  return null;
}

function getCachedSpotifyMatch(track) {
  const cache = readSpotifyCache();
  const hit = cache[spotifyCacheKey(track)];
  if (!hit) return undefined;
  return hit.missing ? null : hit.track;
}

function setCachedSpotifyMatch(track, spotifyTrack) {
  const cache = readSpotifyCache();
  cache[spotifyCacheKey(track)] = spotifyTrack ? {
    at: Date.now(),
    track: {
      id: spotifyTrack.id,
      uri: spotifyTrack.uri,
      name: spotifyTrack.name,
      artists: spotifyTrack.artists?.map(a => ({ id: a.id, name: a.name })) || [],
      external_urls: spotifyTrack.external_urls || {}
    }
  } : { at: Date.now(), missing: true };
  writeSpotifyCache(cache);
}

function spotifyCacheKey(track) {
  return `${normaliseForMatch(track.artist)}---${normaliseForMatch(track.title)}`;
}

function readSpotifyCache() {
  try { return JSON.parse(localStorage.getItem(SPOTIFY_CACHE_KEY) || '{}'); }
  catch { return {}; }
}

function writeSpotifyCache(cache) {
  // Keep localStorage bounded: retain most recent 1000 entries.
  const entries = Object.entries(cache).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, 1000);
  localStorage.setItem(SPOTIFY_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
}

function startPlaybackPolling() {
  if (state.playbackTimer) clearInterval(state.playbackTimer);
  updateNowPlaying();
  state.playbackTimer = setInterval(updateNowPlaying, 5000);
}

async function updateNowPlaying() {
  if (!state.spotifyToken) return;
  try {
    const res = await fetch('https://api.spotify.com/v1/me/player', {
      headers: { Authorization: 'Bearer ' + state.spotifyToken }
    });
    if (res.status === 204 || res.status === 202) return renderNowPlaying(null);
    const data = await safeJson(res);
    if (!res.ok || !data?.item) return renderNowPlaying(null);
    renderNowPlaying(data);
  } catch (err) {
    console.warn('Could not update now playing', err);
  }
}

function renderNowPlaying(playback) {
  const box = $('nowPlaying');
  document.querySelectorAll('#tracks li.playing').forEach(li => {
    li.classList.remove('playing');
    const btn = li.querySelector('.trackPlay');
    if (btn) {
      btn.textContent = '▶';
      btn.title = 'Play this track in Spotify';
      btn.setAttribute('aria-label', 'Play this track in Spotify');
    }
  });
  if (!playback?.item) {
    state.currentPlayback = null;
    updateDayPlayIndicators(null);
    box.classList.add('hidden');
    return;
  }

  state.currentPlayback = playback;
  const item = playback.item;
  const source = getQueueSource();
  const artists = item.artists?.map(a => a.name).join(', ') || '';
  const image = item.album?.images?.at(-1)?.url || item.album?.images?.[0]?.url || '';
  const progress = item.duration_ms ? Math.min(100, (playback.progress_ms || 0) / item.duration_ms * 100) : 0;
  box.classList.remove('hidden');
  box.innerHTML = `
    ${image ? `<img src="${escapeHtml(image)}" alt="">` : '<div></div>'}
    <div>
      <div class="nowLabel">${playback.is_playing ? 'Now playing' : 'Paused on Spotify'}</div>
      <div class="nowTitle">${escapeHtml(item.name)}</div>
      <div class="nowArtist">${escapeHtml(artists)}</div>
      ${source ? `<div class="nowSource">Queue from: ${escapeHtml(source.title)}</div>` : ''}
      <div class="nowBar"><span style="width:${progress}%"></span></div>
    </div>
    <div class="nowActions">
      <button id="spotifyPrev" title="Previous track" aria-label="Previous track">⏮</button>
      <button id="spotifyPlayPause" title="${playback.is_playing ? 'Pause' : 'Play'}" aria-label="${playback.is_playing ? 'Pause' : 'Play'}">${playback.is_playing ? '⏸' : '▶'}</button>
      <button id="spotifyNext" title="Next track" aria-label="Next track">⏭</button>
      ${source ? '<button id="goQueueSource">Go to list</button>' : ''}
    </div>`;

  $('spotifyPrev')?.addEventListener('click', () => spotifyTransport('previous', playback.device?.id));
  $('spotifyPlayPause')?.addEventListener('click', () => spotifyPlayPause(playback));
  $('spotifyNext')?.addEventListener('click', () => spotifyTransport('next', playback.device?.id));
  $('goQueueSource')?.addEventListener('click', () => loadTracklist(source.url, source.title));
  const row = document.querySelector(`#tracks li[data-spotify-uri="${CSS.escape(item.uri)}"]`);
  if (row) {
    row.classList.add('playing');
    const btn = row.querySelector('.trackPlay');
    if (btn) {
      btn.textContent = playback.is_playing ? '⏸' : '▶';
      btn.title = playback.is_playing ? 'Pause Spotify' : 'Resume Spotify';
      btn.setAttribute('aria-label', playback.is_playing ? 'Pause Spotify' : 'Resume Spotify');
    }
  }
  updateDayPlayIndicators(playback);
}

function updateDayPlayIndicators(playback) {
  const source = getQueueSource();
  const isPlaying = !!playback?.is_playing;
  document.querySelectorAll('.listPlay').forEach(btn => {
    if (btn.classList.contains('loading')) return;
    const active = isPlaying && source?.url === btn.dataset.url;
    btn.textContent = active ? '⏸' : '▶';
    btn.title = active ? 'Pause this Radio Študent day' : 'Load this day and play it through Spotify';
  });
  const main = $('playDay');
  if (!main.classList.contains('loading')) {
    const active = isPlaying && source?.url === state.currentUrl;
    main.textContent = active ? '⏸' : '▶';
    main.title = active ? 'Pause this Radio Študent day' : 'Play day';
  }
}

async function spotifyTransport(action, deviceId) {
  try {
    const query = deviceId ? '?' + new URLSearchParams({ device_id: deviceId }) : '';
    await spotifyApi(`/me/player/${action}${query}`, { method: 'POST' });
    setTimeout(updateNowPlaying, 700);
  } catch (err) {
    setStatus(friendlySpotifyError(err), true);
  }
}

async function spotifyPlayPause(playback) {
  try {
    const deviceId = playback.device?.id;
    const query = deviceId ? '?' + new URLSearchParams({ device_id: deviceId }) : '';
    if (playback.is_playing) {
      await spotifyApi(`/me/player/pause${query}`, { method: 'PUT' });
    } else {
      try {
        // First try a normal resume. Some Spotify devices reject this with
        // "Restriction violated", so fall back to explicitly starting the current track.
        await spotifyApi(`/me/player/play${query}`, { method: 'PUT' });
      } catch (resumeErr) {
        if (!/restriction violated/i.test(resumeErr.message) || !playback.item?.uri) throw resumeErr;
        await spotifyApi(`/me/player/play${query}`, {
          method: 'PUT',
          body: JSON.stringify({ uris: [playback.item.uri], position_ms: playback.progress_ms || 0 })
        });
      }
    }
    setTimeout(updateNowPlaying, 500);
  } catch (err) {
    setStatus(friendlySpotifyError(err), true);
  }
}

function friendlySpotifyError(err) {
  if (/restriction violated/i.test(err.message)) {
    return 'Spotify would not allow that player command on the current device/context. Try opening Spotify on this device, then press play there once.';
  }
  return err.message;
}

async function matchCurrentDay({ indicatorEl = null } = {}) {
  if (!state.tracks.length) throw new Error('Load a Radio Študent day first.');
  setPlaylistStatus(`Matching 0/${state.tracks.length}`);
  const uris = [];
  for (let i = 0; i < state.tracks.length; i++) {
    const t = state.tracks[i];
    if (indicatorEl) indicatorEl.title = `Searching ${i + 1}/${state.tracks.length}: ${t.artist} — ${t.title}`;
    setPlaylistStatus(`Matching ${i + 1}/${state.tracks.length}`);
    setPlaylistProgress(i, state.tracks.length);
    const match = await findSpotifyTrack(t);
    if (match) {
      t.spotifyUri = match.uri;
      t.spotifyName = match.name;
      t.spotifyArtists = match.artists?.map(a => a.name).join(', ');
      uris.push(match.uri);
    } else {
      t.spotifyMissing = true;
      console.warn('No confident Spotify match:', t);
    }
    await new Promise(r => setTimeout(r, 80));
  }
  setPlaylistProgress(state.tracks.length, state.tracks.length);
  renderTracks();
  if (!uris.length) throw new Error('Spotify did not match any tracks.');
  setPlaylistStatus(`Matched ${uris.length}/${state.tracks.length}`);
  return uris;
}

async function createSpotifyPlaylist(uris) {
  const me = await spotifyApi('/me');
  const playlist = await spotifyApi('/users/' + me.id + '/playlists', {
    method: 'POST',
    body: JSON.stringify({
      name: state.currentTitle || 'Radio Študent tracklist',
      public: false,
      description: 'Generated from ' + state.currentUrl
    })
  });
  for (let i = 0; i < uris.length; i += 100) {
    await spotifyApi('/playlists/' + playlist.id + '/tracks', {
      method: 'POST',
      body: JSON.stringify({ uris: uris.slice(i, i + 100) })
    });
  }
  return playlist;
}

async function matchTracksOnly(button) {
  const originalText = button?.textContent;
  try {
    if (!state.spotifyToken) return connectSpotify();
    if (button) {
      button.disabled = true;
      button.textContent = 'Matching…';
    }
    const uris = await matchCurrentDay({ indicatorEl: button });
    setPlaylistStatus(`Matched ${uris.length}/${state.tracks.length}`);
  } catch (err) {
    setPlaylistStatus(err.message, true);
  } finally {
    clearPlaylistProgress();
    if (button) {
      button.disabled = !state.tracks.length;
      button.textContent = originalText || 'Match tracks';
      button.title = 'Match tracks';
    }
  }
}

async function createPlaylistFromCurrentDay(button) {
  const originalText = button?.textContent;
  try {
    if (!state.spotifyToken) return connectSpotify();
    if (button) {
      button.disabled = true;
      button.textContent = 'Saving…';
    }
    const uris = await matchCurrentDay({ indicatorEl: button });
    setPlaylistStatus('Creating playlist…');
    const playlist = await createSpotifyPlaylist(uris);
    window.open(playlist.external_urls.spotify, '_blank', 'noreferrer');
    setPlaylistStatus(`Saved ${uris.length}/${state.tracks.length}`);
  } catch (err) {
    setPlaylistStatus(err.message, true);
  } finally {
    clearPlaylistProgress();
    if (button) {
      button.disabled = !state.tracks.length;
      button.textContent = originalText || 'Save playlist';
      button.title = 'Save playlist';
    }
  }
}

function rememberQueueSource() {
  if (!state.currentUrl) return;
  localStorage.setItem(QUEUE_SOURCE_KEY, JSON.stringify({ url: state.currentUrl, title: state.currentTitle, at: Date.now() }));
}

function getQueueSource() {
  try { return JSON.parse(localStorage.getItem(QUEUE_SOURCE_KEY) || 'null'); }
  catch { return null; }
}

function spotifyMatchScore(wanted, item) {
  const wantedTitle = normaliseForMatch(wanted.title);
  const gotTitle = normaliseForMatch(item.name);
  const wantedArtist = normaliseForMatch(wanted.artist);
  const gotArtists = item.artists.map(a => normaliseForMatch(a.name)).join(' ');

  const title = Math.max(similarity(wantedTitle, gotTitle), containmentScore(wantedTitle, gotTitle));
  const artist = Math.max(similarity(wantedArtist, gotArtists), containmentScore(wantedArtist, gotArtists));
  return { title, artist, total: title * 0.68 + artist * 0.32 };
}

function quoteSpotifyQuery(value) {
  return '"' + value.replace(/["“”]/g, '').replace(/\s+/g, ' ').trim() + '"';
}

function normaliseForMatch(value) {
  return value
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/\b(feat|ft|featuring|prod|produced by|edit|remix|radio edit|original mix)\b\.?/g, ' ')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containmentScore(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length >= 5 && b.includes(a)) return Math.min(0.98, a.length / b.length + 0.25);
  if (b.length >= 5 && a.includes(b)) return Math.min(0.98, b.length / a.length + 0.25);
  const aTokens = new Set(a.split(' ').filter(x => x.length > 2));
  const bTokens = new Set(b.split(' ').filter(x => x.length > 2));
  if (!aTokens.size || !bTokens.size) return 0;
  const overlap = [...aTokens].filter(x => bTokens.has(x)).length;
  return overlap / Math.max(aTokens.size, bTokens.size);
}

function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const max = Math.max(a.length, b.length);
  return max ? 1 - levenshtein(a, b) / max : 0;
}

function levenshtein(a, b) {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

async function playSingleTrack(track) {
  try {
    if (!state.spotifyToken) {
      sessionStorage.setItem('pendingPlay', JSON.stringify({ url: state.currentUrl, title: state.currentTitle }));
      return connectSpotify();
    }
    setPlaylistStatus(`Finding track…`);
    const match = await findSpotifyTrack(track);
    if (!match) throw new Error('Spotify did not confidently match this track.');
    track.spotifyUri = match.uri;
    renderTracks();
    rememberQueueSource();
    const deviceId = await getPlaybackDeviceId();
    const query = deviceId ? '?' + new URLSearchParams({ device_id: deviceId }) : '';
    await spotifyApi('/me/player/play' + query, { method: 'PUT', body: JSON.stringify({ uris: [match.uri] }) });
    startPlaybackPolling();
    setPlaylistStatus('Playing');
  } catch (err) {
    setPlaylistStatus(err.message, true);
  }
}

async function playCurrentDay(indicatorEl = null) {
  const originalIndicatorText = indicatorEl?.textContent;
  try {
    if (!state.tracks.length) return setStatus('Load a Radio Študent day first.', true);
    if (!state.spotifyToken) {
      sessionStorage.setItem('pendingPlay', JSON.stringify({ url: state.currentUrl, title: state.currentTitle }));
      return connectSpotify();
    }

    $('playDay').disabled = true;
    if (indicatorEl) {
      indicatorEl.disabled = true;
      indicatorEl.textContent = '…';
      indicatorEl.classList.add('loading');
    } else {
      $('playDay').textContent = '…';
    }
    const uris = await matchCurrentDay({ indicatorEl });
    rememberQueueSource();
    const deviceId = await getPlaybackDeviceId();
    const query = deviceId ? '?' + new URLSearchParams({ device_id: deviceId }) : '';
    await spotifyApi('/me/player/play' + query, { method: 'PUT', body: JSON.stringify({ uris: uris.slice(0, 100) }) });
    startPlaybackPolling();
    setPlaylistStatus(`Playing ${uris.length}/${state.tracks.length}`);
  } catch (err) {
    setPlaylistStatus(err.message, true);
  } finally {
    clearPlaylistProgress();
    $('playDay').disabled = !state.tracks.length;
    $('playDay').textContent = '▶';
    $('playDay').title = 'Play day';
    if (indicatorEl) {
      indicatorEl.disabled = false;
      indicatorEl.textContent = originalIndicatorText || '▶';
      indicatorEl.title = 'Load this day and play it through Spotify';
      indicatorEl.classList.remove('loading');
    }
  }
}

function randomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  crypto.getRandomValues(new Uint8Array(length));
  return Array.from(crypto.getRandomValues(new Uint8Array(length)), x => chars[x % chars.length]).join('');
}
async function sha256Base64Url(input) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function copyTracks() {
  await navigator.clipboard.writeText(state.tracks.map(t => `${t.artist} - ${t.title}`).join('\n'));
  setStatus('Copied tracklist to clipboard.');
}
function escapeHtml(s) { return s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
