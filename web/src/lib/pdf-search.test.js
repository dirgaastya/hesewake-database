import { describe, expect, test } from 'vitest';
import { searchTerms, pageMatches, highlightSegments, clampZoom } from './pdf-search.js';

describe('pdf-search', () => {
  test('searchTerms: kecil semua, unik, buang kata 1 huruf dan tanda kutip', () => {
    expect(searchTerms('  Bed "AHJT" bed a  ')).toEqual(['bed', 'ahjt']);
    expect(searchTerms('')).toEqual([]);
  });

  test('pageMatches: salah satu kata cukup, tidak peka huruf besar dan aksen', () => {
    expect(pageMatches('SURAT KEPUTUSAN Direktur tentang Bed Rumah Sakit', ['bed'])).toBe(true);
    expect(pageMatches('Kafé pasien', ['kafe'])).toBe(true);
    expect(pageMatches('Lampiran tarif', ['bed', 'ahjt'])).toBe(false);
    expect(pageMatches('apa saja', [])).toBe(false);
  });

  test('highlightSegments: potong teks di kata yang cocok, kata terpanjang diutamakan', () => {
    expect(highlightSegments('Jumlah Bed AHJT: 120 bed', ['bed', 'ahjt'])).toEqual([
      { text: 'Jumlah ', match: false },
      { text: 'Bed', match: true },
      { text: ' ', match: false },
      { text: 'AHJT', match: true },
      { text: ': 120 ', match: false },
      { text: 'bed', match: true },
    ]);
    expect(highlightSegments('pasien rawat', ['rawat inap', 'rawat'])).toEqual([
      { text: 'pasien ', match: false },
      { text: 'rawat', match: true },
    ]);
    expect(highlightSegments('tanpa cocok', ['xyz'])).toEqual([{ text: 'tanpa cocok', match: false }]);
    expect(highlightSegments('a.b (c)', ['a.b'])).toEqual([
      { text: 'a.b', match: true },
      { text: ' (c)', match: false },
    ]);
  });

  test('clampZoom', () => {
    expect(clampZoom(0.2)).toBe(0.5);
    expect(clampZoom(1.257)).toBe(1.26);
    expect(clampZoom(9)).toBe(3);
  });
});
