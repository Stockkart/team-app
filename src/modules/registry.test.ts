import { describe, expect, it } from 'vitest';

import { MODULE_KEYS } from '@stockkart/attendance-protocol';

import { STRINGS_EN } from '../i18n';
import { MODULES, UNKNOWN_MODULE_TINT, isKnownModule, tilesFor } from './registry';

describe('tilesFor (R6.4, R6.6)', () => {
  it('gives one tile per server entry, in server order, known keys mapped to their module', () => {
    const tiles = tilesFor(['ATTENDANCE', 'HISTORY', 'PROFILE']);
    expect(tiles).toEqual([
      { kind: 'module', key: 'ATTENDANCE', def: MODULES.ATTENDANCE },
      { kind: 'module', key: 'HISTORY', def: MODULES.HISTORY },
      { kind: 'module', key: 'PROFILE', def: MODULES.PROFILE },
    ]);
  });

  it('keeps the server order when it differs from the registry order', () => {
    expect(tilesFor(['PROFILE', 'ATTENDANCE']).map((tile) => tile.key)).toEqual([
      'PROFILE',
      'ATTENDANCE',
    ]);
  });

  it('an unknown key becomes the update tile; nothing is added or dropped', () => {
    const tiles = tilesFor(['ATTENDANCE', 'PAYSLIPS', 'LEAVE']);
    expect(tiles).toEqual([
      { kind: 'module', key: 'ATTENDANCE', def: MODULES.ATTENDANCE },
      { kind: 'update', key: 'PAYSLIPS' },
      { kind: 'update', key: 'LEAVE' },
    ]);
  });

  it('an empty list gives no tile, and a repeated key is drawn once', () => {
    expect(tilesFor([])).toEqual([]);
    expect(tilesFor(['HISTORY', 'HISTORY', 'X', 'X']).map((tile) => tile.key)).toEqual([
      'HISTORY',
      'X',
    ]);
  });

  it('Attendance is the one large tile; every known module has a label in the strings file', () => {
    for (const key of MODULE_KEYS) {
      expect(isKnownModule(key)).toBe(true);
      expect(MODULES[key].label in STRINGS_EN).toBe(true);
      expect(MODULES[key].size).toBe(key === 'ATTENDANCE' ? 'large' : 'half');
    }
    expect(isKnownModule('PAYSLIPS')).toBe(false);
    expect(isKnownModule('toString')).toBe(false);
  });

  it('tints each tile\u2019s icon circle as the design says (R12.15): Attendance brandSoft, History successSoft, Profile accent, unknown warningSoft', () => {
    expect(MODULES.ATTENDANCE.tint).toBe('brandSoft');
    expect(MODULES.HISTORY.tint).toBe('successSoft');
    expect(MODULES.PROFILE.tint).toBe('accent');
    expect(UNKNOWN_MODULE_TINT).toBe('warningSoft');
  });
});
