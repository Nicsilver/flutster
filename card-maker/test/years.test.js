import { describe, it, expect } from 'vitest';
import { plausibleYear, norm, baseTitle, canonTitle, leadArtist } from '../src/years.js';

describe('plausibleYear', () => {
  it('accepts 1901 through next year, rejects the rest', () => {
    const next = new Date().getFullYear() + 1;
    expect(plausibleYear(1900)).toBe(false);
    expect(plausibleYear(1901)).toBe(true);
    expect(plausibleYear(next)).toBe(true);
    expect(plausibleYear(next + 1)).toBe(false);
    expect(plausibleYear(0)).toBe(false);
    expect(plausibleYear(NaN)).toBe(false);
  });
});

describe('title canonicalisation', () => {
  it('norm lowercases and strips diacritics and punctuation', () => {
    expect(norm('Beyoncé!')).toBe('beyonce');
    expect(norm("I Don't Want To")).toBe('i don t want to');
  });

  it('baseTitle drops parentheticals and dash suffixes', () => {
    // Remaster/live suffixes vary per catalog and broke cross-source matching.
    expect(baseTitle('Song - Remastered 2011')).toBe('song');
    expect(baseTitle('Take On Me (Live)')).toBe('take on me');
  });

  it('canonTitle drops Pt/Part suffixes (the Butcher Pete regression)', () => {
    expect(canonTitle('Butcher Pete, Pt. 1')).toBe('butcher pete');
    expect(canonTitle('Butcher Pete Part One')).toBe('butcher pete');
    expect(canonTitle('Butcher Pete, Pt. 1')).toBe(canonTitle('Butcher Pete Pt 1'));
    // Known limitation: plural "Pts. 1 & 2" is not canonicalised.
    expect(canonTitle('Shout, Pts. 1 & 2')).toBe('shout pts 1 2');
  });
});

describe('leadArtist', () => {
  it('strips big-band credits (the Kay Kyser regression)', () => {
    expect(leadArtist('Kay Kyser & His Orchestra')).toBe('Kay Kyser');
    expect(leadArtist('Frankie Carle with Marjorie Hughes')).toBe('Frankie Carle');
    expect(leadArtist('Beyoncé feat. Jay-Z')).toBe('Beyoncé');
    expect(leadArtist('Kitty Kallen, Harry James')).toBe('Kitty Kallen');
  });

  it('keeps duo names intact', () => {
    // Deliberately narrow: "& his/her/the …" only, so real duos survive.
    expect(leadArtist('Ike & Tina Turner')).toBe('Ike & Tina Turner');
    expect(leadArtist('Simon & Garfunkel')).toBe('Simon & Garfunkel');
  });
});
