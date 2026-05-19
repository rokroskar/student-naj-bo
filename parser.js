function clean(s = '') {
  return s.replace(/\s+/g, ' ').replace(/&nbsp;/g, ' ').trim();
}

function cleanTrackLine(s) {
  return clean(s)
    .replace(/^\*+|\*+$/g, '')
    .replace(/^\s*\d{1,3}\s*[-.)]\s*/, '')
    .replace(/\s+[–—]\s+/g, ' - ')
    .replace(/\(\s*\d{1,2}:\d{2}\s*\)/g, '')
    .replace(/\s+-\s*\d{1,2}:\d{2}\s*$/g, '')
    .replace(/-\s*\d{1,2}:\d{2}\s*$/g, '')
    .replace(/\s+\d{1,2}:\d{2}\s*$/g, '')
    .replace(/\[Edit\]|\.mp3/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toTrack(line) {
  if (!line || line.length > 180) return null;
  const numbered = line.match(/^\d{1,3}\s+(.+)$/);
  if (numbered) line = numbered[1].trim();
  let match = line.match(/^(.+?)\s[-–—]\s(.+)$/);
  let artist;
  let title;
  if (match) {
    artist = match[1].trim();
    title = match[2].trim();
  } else if (line.includes('-')) {
    const idx = line.lastIndexOf('-');
    artist = line.slice(0, idx).trim();
    title = line.slice(idx + 1).trim();
  } else {
    return null;
  }
  artist = artist.replace(/^\d{1,3}\s+/, '').trim();
  if (!artist || !title || isScheduleLine(artist, title)) return null;
  return { artist, title, query: `${artist} ${title}` };
}

function isScheduleLine(artist, title) {
  const timeOnly = /^\d{1,2}[.:]\d{2}$/.test(title.trim());
  const hasYear = /\b20\d{2}\b/.test(artist);
  const dateLike = /^\d{1,2}\.\s*\d{1,2}\.\s*20\d{2}$/.test(artist.trim());
  return timeOnly && (hasYear || dateLike);
}

function parseTracksFromHtml(html) {
  if (typeof DOMParser === 'undefined') return parseTracksFromHtmlWithoutDom(html);

  const doc = new DOMParser().parseFromString(html, 'text/html');

  const structuredTracks = [...doc.querySelectorAll('.field--name-field-naslov-skladbe')]
    .map(el => cleanTrackLine(el.textContent));
  if (structuredTracks.length) return uniqueTracks(structuredTracks.map(toTrack).filter(Boolean));

  const body = doc.querySelector('.node--type-glasbena-oprema .field--name-body, .node--type-prispevek .field--name-body, main .field--name-body, .field--name-body') || doc;
  const items = [...body.querySelectorAll('li')];
  let lines;
  if (items.length) {
    lines = items.map(li => {
      const clone = li.cloneNode(true);
      clone.querySelectorAll('a, script, style').forEach(n => n.remove());
      return cleanTrackLine(clone.textContent);
    });
  } else {
    const clone = body.cloneNode(true);
    clone.querySelectorAll('a, script, style').forEach(n => n.remove());
    clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
    lines = clone.textContent.split('\n').map(cleanTrackLine);
  }
  return uniqueTracks(lines.map(toTrack).filter(Boolean));
}

function uniqueTracks(tracks) {
  const seen = new Set();
  return tracks.filter(track => {
    const key = `${normaliseTrackPart(track.artist)}---${normaliseTrackPart(track.title)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normaliseTrackPart(value) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function parseIndexTitleFromMarkdownContext(after, url) {
  const lines = after.split('\n').map(clean).filter(Boolean)
    .filter(line => !/^Vir:|^\/|^Published|^Markdown/i.test(line))
    .filter(line => !/^!?\[/.test(line) && !/https?:\/\//.test(line));
  const dateLine = lines.find(line => /\d{1,2}\.\s*\d{1,2}\.\s*20\d{2}\s*[–-]\s*\d{1,2}[.:]\d{2}/.test(line));
  if (!dateLine) return '';
  const subtitle = lines.find(line => line !== dateLine && !/\d{1,2}\.\s*\d{1,2}\.\s*20\d{2}/.test(line));
  const range = extractTimeRangeFromSlug(url);
  const date = dateLine.match(/\d{1,2}\.\s*\d{1,2}\.\s*20\d{2}/)?.[0];
  const start = dateLine.match(/[–-]\s*(\d{1,2}[.:]\d{2})/)?.[1]?.replace(':', '.');
  const time = range.length === 2 ? `${range[0]}–${range[1]}` : start;
  return [date && time ? `${date} – ${time}` : dateLine, subtitle].filter(Boolean).join(' / ');
}

function extractTimeRangeFromSlug(url) {
  const slug = decodeURIComponent(url.split('/').pop() || '');
  const nums = [...slug.matchAll(/(?:^|-)(\d{3,4})(?=-|$)/g)].map(m => m[1]);
  if (nums.length < 2) return [];
  return nums.slice(-2).map(formatSlugTime);
}

function formatSlugTime(value) {
  if (!value) return '';
  const padded = value.padStart(4, '0');
  return `${parseInt(padded.slice(0, -2), 10)}.${padded.slice(-2)}`;
}

function parseTracksFromMarkdown(markdown) {
  const tableTracks = parseMarkdownTableTracks(markdown);
  if (tableTracks.length) return tableTracks;

  const lines = markdown.split('\n')
    .map(line => line.trim())
    .filter(line => line && !/^#{1,6}\s/.test(line))
    .filter(line => !/^\*\s+\[/.test(line))
    .filter(line => !/https?:\/\//.test(line))
    .filter(line => !/^!?\[.*\]\(.*\)/.test(line))
    .map(cleanTrackLine);
  return uniqueTracks(lines.map(toTrack).filter(Boolean));
}

function parseMarkdownTableTracks(markdown) {
  const rows = markdown.split('\n').map(line => line.trim()).filter(line => /^\|.*\|$/.test(line));
  if (rows.length < 3) return [];
  const header = splitMarkdownTableRow(rows[0]).map(x => x.toLowerCase());
  const titleIdx = header.findIndex(x => /naslov|title|skladb/.test(x));
  const artistIdx = header.findIndex(x => /izvajalec|artist/.test(x));
  if (titleIdx < 0 || artistIdx < 0) return [];
  return uniqueTracks(rows.slice(2).map(row => {
    const cols = splitMarkdownTableRow(row);
    const title = cleanTrackLine(cols[titleIdx] || '');
    const artist = cleanTrackLine(cols[artistIdx] || '');
    return artist && title ? { artist, title, query: `${artist} ${title}` } : null;
  }).filter(Boolean));
}

function splitMarkdownTableRow(row) {
  return row.replace(/^\||\|$/g, '').split('|').map(cell => clean(cell.replace(/\\\|/g, '|')));
}

function parseTracksFromHtmlWithoutDom(html) {
  const structured = [...html.matchAll(/<[^>]*class="[^"]*field--name-field-naslov-skladbe[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/g)]
    .map(m => cleanTrackLine(htmlToText(m[1])));
  if (structured.length) return uniqueTracks(structured.map(toTrack).filter(Boolean));

  const bodyMatch = html.match(/<[^>]*class="[^"]*field--name-body[^"]*"[^>]*>([\s\S]*?)<\/div>/) || ['', html];
  const body = bodyMatch[1];
  const liMatches = [...body.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)];
  const lines = liMatches.length
    ? liMatches.map(m => cleanTrackLine(htmlToText(removeLinks(m[1]))))
    : htmlToText(removeLinks(body).replace(/<br\s*\/?\s*>/gi, '\n')).split('\n').map(cleanTrackLine);
  return uniqueTracks(lines.map(toTrack).filter(Boolean));
}

function removeLinks(html) {
  return html.replace(/<a\b[\s\S]*?<\/a>/gi, '');
}

function htmlToText(html) {
  return html
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

if (typeof module !== 'undefined') {
  module.exports = { clean, cleanTrackLine, toTrack, parseTracksFromHtml, parseTracksFromMarkdown, parseMarkdownTableTracks, parseIndexTitleFromMarkdownContext, extractTimeRangeFromSlug, isScheduleLine };
}
