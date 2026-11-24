import { describe, expect, it, vi } from 'vitest';
import { MAX_TRIES, SETTINGS_PREFIX, forgetOldestSettings, readItem, writeItem } from './storage';
import { limitedStorage } from './testStorage';

const remembered = (saved?: number) => JSON.stringify(saved === undefined ? {} : { saved });

describe('writeItem en readItem', () => {
  it('bewaart en leest terug; geeft of bewaren gelukt is', () => {
    const store = limitedStorage();
    expect(writeItem('a', '1', store)).toBe(true);
    expect(readItem('a', store)).toBe('1');
    expect(writeItem('a', '1', null)).toBe(false);
    expect(readItem('a', null)).toBeNull();
  });

  it('vol: zonder ruimte maken niet bewaard, zonder fout', () => {
    const store = limitedStorage(5);
    expect(writeItem('sleutel', 'waarde', store)).toBe(false);
    expect(store.data.size).toBe(0);
  });

  it('vol: ruimte maken, steeds een stukje, tot het past; of tot er niets meer weg kan', () => {
    const store = limitedStorage(12, { x: 'xxxx', y: 'yyyy' });
    const makeRoom = vi.fn(() => {
      const key = [...store.data.keys()][0];
      if (key === undefined) return false;
      store.removeItem(key);
      return true;
    });
    expect(writeItem('a', 'aaaaa', store, makeRoom)).toBe(true);
    expect(makeRoom).toHaveBeenCalledTimes(1);
    expect([...store.data.keys()]).toEqual(['y', 'a']);

    makeRoom.mockClear();
    expect(writeItem('b', 'b'.repeat(20), store, makeRoom)).toBe(false);
    // Alles weggehaald en het past nog niet: stoppen.
    expect(makeRoom).toHaveBeenCalledTimes(3);
    expect(store.data.size).toBe(0);
  });

  it('zegt ruimte maken steeds "gelukt" zonder dat het past, dan toch stoppen (geen eindeloze lus)', () => {
    const makeRoom = vi.fn(() => true);
    expect(writeItem('a', 'aaaaa', limitedStorage(3), makeRoom)).toBe(false);
    expect(makeRoom).toHaveBeenCalledTimes(MAX_TRIES);
  });
});

describe('forgetOldestSettings: plaatsmaken in de onthouden instellingen', () => {
  it('haalt de oudst bewaarde weg (zonder tijdstempel eerst), niet `keep` en niets anders', () => {
    const store = limitedStorage(Infinity, {
      'nondumscio:lang': 'nl',
      [`${SETTINGS_PREFIX}b.pdf`]: remembered(200),
      [`${SETTINGS_PREFIX}a.pdf`]: remembered(100),
      [`${SETTINGS_PREFIX}oud.pdf`]: remembered(),
      [`${SETTINGS_PREFIX}kapot.pdf`]: '{kapot',
      [`${SETTINGS_PREFIX}c.pdf`]: remembered(300),
    });
    const left = () => [...store.data.keys()];
    expect(forgetOldestSettings(store, `${SETTINGS_PREFIX}oud.pdf`)).toBe(true);
    expect(left()).not.toContain(`${SETTINGS_PREFIX}kapot.pdf`);
    expect(left()).toContain(`${SETTINGS_PREFIX}oud.pdf`);
    expect(forgetOldestSettings(store)).toBe(true);
    expect(left()).not.toContain(`${SETTINGS_PREFIX}oud.pdf`);
    expect(forgetOldestSettings(store)).toBe(true);
    expect(left()).not.toContain(`${SETTINGS_PREFIX}a.pdf`);
    expect(forgetOldestSettings(store, `${SETTINGS_PREFIX}b.pdf`)).toBe(true);
    expect(left()).toEqual(['nondumscio:lang', `${SETTINGS_PREFIX}b.pdf`]);
    expect(forgetOldestSettings(store, `${SETTINGS_PREFIX}b.pdf`)).toBe(false);
    expect(forgetOldestSettings(store)).toBe(true);
    expect(forgetOldestSettings(store)).toBe(false);
    expect(left()).toEqual(['nondumscio:lang']);
  });

  it('geen opslag, of geen toegang: niets weg, zonder fout', () => {
    expect(forgetOldestSettings(null)).toBe(false);
    const broken = {
      ...limitedStorage(),
      get length() {
        return 1;
      },
      key: () => {
        throw new Error('geen toegang');
      },
    };
    expect(forgetOldestSettings(broken)).toBe(false);
  });
});
