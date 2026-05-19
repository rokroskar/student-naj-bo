const assert = require('node:assert/strict');
const test = require('node:test');
const { cleanTrackLine, toTrack, parseTracksFromHtml, parseTracksFromMarkdown, parseIndexTitleFromMarkdownContext, extractTimeRangeFromSlug } = require('../parser');

test('parses regular ordered list with artist hyphen title and durations', () => {
  const html = `<main><div class="field--name-body"><ol>
    <li>La Niña - Ahi! (03:02) <a href="https://example.com">event info</a></li>
    <li>Balans - Koža [Edit].mp3 ( 7:14)</li>
  </ol></div></main>`;
  assert.deepEqual(parseTracksFromHtml(html), [
    { artist: 'La Niña', title: 'Ahi!', query: 'La Niña Ahi!' },
    { artist: 'Balans', title: 'Koža', query: 'Balans Koža' }
  ]);
});

test('parses structured field_skladba table rows with leading numbers and trailing durations', () => {
  const html = `<main><div class="field--name-field-naslov-skladbe">01 - Vula Viel - Zine dondone zine daa - 4:55</div>
    <div class="field--name-field-naslov-skladbe">02 - Gorillaz - Orange County (feat. Bizarrap and Kara Jackson) - 3:28</div></main>`;
  assert.deepEqual(parseTracksFromHtml(html), [
    { artist: 'Vula Viel', title: 'Zine dondone zine daa', query: 'Vula Viel Zine dondone zine daa' },
    { artist: 'Gorillaz', title: 'Orange County (feat. Bizarrap and Kara Jackson)', query: 'Gorillaz Orange County (feat. Bizarrap and Kara Jackson)' }
  ]);
});

test('parses paragraph body split by br tags', () => {
  const html = `<main><div class="field--name-body"><p>
    1&nbsp;&nbsp;.&nbsp;&nbsp;L3ryka&nbsp;&nbsp;-&nbsp;&nbsp;You and the music&nbsp;&nbsp;-&nbsp;&nbsp;2:20<br>
    2&nbsp;&nbsp;.&nbsp;&nbsp;Lovvbömbing!&nbsp;&nbsp;-&nbsp;&nbsp;Whyte Rabbyt&nbsp;&nbsp;-&nbsp;&nbsp;3:30
  </p></div></main>`;
  assert.deepEqual(parseTracksFromHtml(html), [
    { artist: 'L3ryka', title: 'You and the music', query: 'L3ryka You and the music' },
    { artist: 'Lovvbömbing!', title: 'Whyte Rabbyt', query: 'Lovvbömbing! Whyte Rabbyt' }
  ]);
});

test('parses en dash and em dash separators', () => {
  assert.deepEqual(toTrack(cleanTrackLine('Gold Panda – Metal Bird')), {
    artist: 'Gold Panda', title: 'Metal Bird', query: 'Gold Panda Metal Bird'
  });
  assert.deepEqual(toTrack(cleanTrackLine('Radio Hito — Un Rumore')), {
    artist: 'Radio Hito', title: 'Un Rumore', query: 'Radio Hito Un Rumore'
  });
});

test('ignores links, schedule/date lines, and non-track lines', () => {
  const html = `<main><div class="field--name-body"><ol>
    <li><a href="https://example.com">29. 5.: concert announcement</a></li>
    <li>2026 – 14.00</li>
    <li>7. 5. 2026 – 14.00</li>
    <li>Kim Gordon – Not Today&nbsp;</li>
  </ol></div></main>`;
  assert.deepEqual(parseTracksFromHtml(html), [
    { artist: 'Kim Gordon', title: 'Not Today', query: 'Kim Gordon Not Today' }
  ]);
});

test('deduplicates repeated tracks while preserving order', () => {
  const html = `<main><div class="field--name-body"><ol>
    <li>Gold Panda – Metal Bird</li>
    <li>Kim Gordon – Not Today</li>
    <li>Gold Panda - Metal Bird&nbsp;</li>
  </ol></div></main>`;
  assert.deepEqual(parseTracksFromHtml(html), [
    { artist: 'Gold Panda', title: 'Metal Bird', query: 'Gold Panda Metal Bird' },
    { artist: 'Kim Gordon', title: 'Not Today', query: 'Kim Gordon Not Today' }
  ]);
});

test('parses compact markdown lines from reader proxy', () => {
  assert.deepEqual(toTrack(cleanTrackLine('1.L3ryka-You and the music-2:20')), {
    artist: 'L3ryka', title: 'You and the music', query: 'L3ryka You and the music'
  });
  assert.deepEqual(toTrack(cleanTrackLine('23.T.P. Orchestre Poly-Rythmo-E Wa Dagbe-3:58')), {
    artist: 'T.P. Orchestre Poly-Rythmo', title: 'E Wa Dagbe', query: 'T.P. Orchestre Poly-Rythmo E Wa Dagbe'
  });
});

test('parses numbered space-separated rows without separator after number', () => {
  assert.deepEqual(toTrack(cleanTrackLine('01 Sun Araw - Fog Wheels (radio edit) 8:58')), {
    artist: 'Sun Araw', title: 'Fog Wheels (radio edit)', query: 'Sun Araw Fog Wheels (radio edit)'
  });
  assert.deepEqual(toTrack(cleanTrackLine('14 Dälek – Three Rocks Blessed 7:45')), {
    artist: 'Dälek', title: 'Three Rocks Blessed', query: 'Dälek Three Rocks Blessed'
  });
});

test('parses bold markdown track rows from reader proxy', () => {
  assert.deepEqual(toTrack(cleanTrackLine('**01 - čuvarkuća - Kiša - 03:07**')), {
    artist: 'čuvarkuća', title: 'Kiša', query: 'čuvarkuća Kiša'
  });
  assert.deepEqual(toTrack(cleanTrackLine('**03 - Big Thief - Simulation Swarm - 04:13**')), {
    artist: 'Big Thief', title: 'Simulation Swarm', query: 'Big Thief Simulation Swarm'
  });
});

test('extracts playlist titles from index markdown context and slug time range', () => {
  const url = 'https://radiostudent.si/ostalo/glasbene-opreme/seznam-skladb-za-19-5-2026-700-1100';
  const after = `\n\nVir: Zajem zaslona\n\n19. 5. 2026 – 7.00\n\nIn a world without a future every promise is a lie\n\n[![Image 2](https://example.com/img.jpg)](https://example.com/next)`;
  assert.deepEqual(extractTimeRangeFromSlug(url), ['7.00', '11.00']);
  assert.equal(parseIndexTitleFromMarkdownContext(after, url), '19. 5. 2026 – 7.00–11.00 / In a world without a future every promise is a lie');
});

test('markdown parser ignores navigation and event links with hyphenated URLs', () => {
  const md = `# Seznam skladb
* [Koncertni zapovednik](https://radiostudent.si/glasbeno-dogajanje)
[15. 5.: Ana Pupedan @ blunout, Domžale](https://www.facebook.com/events/911908275123721/ "(opens in a new window)")
1.L3ryka-You and the music-2:20
2.Lovvbömbing!-Whyte Rabbyt-3:30`;
  assert.deepEqual(parseTracksFromMarkdown(md), [
    { artist: 'L3ryka', title: 'You and the music', query: 'L3ryka You and the music' },
    { artist: 'Lovvbömbing!', title: 'Whyte Rabbyt', query: 'Lovvbömbing! Whyte Rabbyt' }
  ]);
});
