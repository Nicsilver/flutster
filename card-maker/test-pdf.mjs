// Headless check of the PDF engine — generates sample front/back sheets so the
// layout and back-mirroring can be eyeballed without Spotify. Run: node test-pdf.mjs
import fs from 'fs';
import { makeFrontsPdf, makeBacksPdf, estimatePerPage } from './src/pdf.js';

const tracks = Array.from({ length: 14 }, (_, i) => ({
  uri: `spotify:track:4uLU6hMCjMI75M1A2tKUQ${String.fromCharCode(65 + i)}`,
  title: ['Never Gonna Give You Up', 'Bohemian Rhapsody', 'Blinding Lights',
    'Smells Like Teen Spirit', 'Billie Jean', 'Wonderwall', 'Take On Me',
    'Uptown Funk', 'Rolling in the Deep', 'Africa', 'Hey Jude', 'Bad Guy',
    'Shape of You', 'Dancing Queen'][i],
  artist: ['Rick Astley', 'Queen', 'The Weeknd', 'Nirvana', 'Michael Jackson',
    'Oasis', 'a-ha', 'Mark Ronson', 'Adele', 'Toto', 'The Beatles',
    'Billie Eilish', 'Ed Sheeran', 'ABBA'][i],
  year: [1987, 1975, 2019, 1991, 1982, 1995, 1985, 2014, 2010, 1982, 1968, 2019, 2017, 1976][i],
}));

const opts = { cardMm: 60, marginMm: 8, gapMm: 2, cut: true, flip: 'long' };
console.log('layout:', estimatePerPage(opts));

const fronts = await makeFrontsPdf(tracks, opts);
fs.writeFileSync('test-fronts.pdf', Buffer.from(fronts.output('arraybuffer')));
const backs = await makeBacksPdf(tracks, opts);
fs.writeFileSync('test-backs.pdf', Buffer.from(backs.output('arraybuffer')));
console.log('wrote test-fronts.pdf and test-backs.pdf');
