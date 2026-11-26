// Task 14.6 — Property 15 (Home is derived from the state; R6.4, R6.6), the module-grid half: for
// any server module list (known and unknown keys, any order, duplicates removed server-side),
// `tilesFor` returns one tile per entry in the same order, known keys mapped to their module and
// unknown keys to the update tile, and no other tile; and the Attendance tile, when present, is
// first and `large`.
//
// The set of known keys comes from the protocol's `MODULE_KEYS`, not from the registry's own
// `isKnownModule`, so the registry cannot vouch for itself. Lists are drawn with keys the server
// sends today, keys a newer backend might add (R6.6), and keys that only look like modules (wrong
// case, object-prototype names, the empty string), so a lookup through `Object` prototype
// properties or a case-insensitive match would be caught.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { MODULE_KEYS, type ModuleKey } from '@stockkart/attendance-protocol';

import { MODULES, tilesFor, type Tile } from './registry';

const NUM_RUNS = 300;

// ---------------------------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------------------------

const knownKey: fc.Arbitrary<string> = fc.constantFrom(...MODULE_KEYS);

/** Keys a newer server could list, which this version does not know (R6.6). */
const newerKey: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom('PAYSLIPS', 'LEAVE', 'ADVANCES', 'DOCUMENTS'),
  fc
    .stringMatching(/^[A-Z][A-Z_]{2,11}$/)
    .filter((key) => !(MODULE_KEYS as readonly string[]).includes(key)),
);

/** Strings that look like a module key but are not one: wrong case, prototype names, empty. */
const lookalikeKey: fc.Arbitrary<string> = fc.constantFrom(
  'attendance',
  'Attendance',
  'ATTENDANCE ',
  ' HISTORY',
  'PROFILE\n',
  'toString',
  'hasOwnProperty',
  'constructor',
  '__proto__',
  'valueOf',
  '',
);

/** Any key the server might send, known ones most often. */
const anyKey: fc.Arbitrary<string> = fc.oneof(
  { weight: 4, arbitrary: knownKey },
  { weight: 2, arbitrary: newerKey },
  { weight: 1, arbitrary: lookalikeKey },
);

/** A list as the server sends it: no duplicates (the server removes them), any order, any length. */
const serverList: fc.Arbitrary<string[]> = fc.uniqueArray(anyKey, { maxLength: 8 });

/** A list with repeats, as a misbehaving server might send (the app still draws each key once). */
const listWithRepeats: fc.Arbitrary<string[]> = fc.array(anyKey, { maxLength: 10 });

// ---------------------------------------------------------------------------------------------
// Reference
// ---------------------------------------------------------------------------------------------

const KNOWN = new Set<string>(MODULE_KEYS);

function isKnown(key: string): key is ModuleKey {
  return KNOWN.has(key);
}

/** The tile each server key should become, from the protocol's key list only. */
function expectedTile(key: string): Tile {
  return isKnown(key) ? { kind: 'module', key, def: MODULES[key] } : { kind: 'update', key };
}

/** First occurrence of every key, in order: how the app draws a list the server did not dedupe. */
function distinctInOrder(list: readonly string[]): string[] {
  return list.filter((key, index) => list.indexOf(key) === index);
}

// ---------------------------------------------------------------------------------------------
// Property 15 — module grid
// ---------------------------------------------------------------------------------------------

describe('Feature: worker-app, Property 15: Home is derived from the state (module grid)', () => {
  it('for any server list, there is exactly one tile per entry, in server order, and no other tile (R6.4, R6.6)', () => {
    fc.assert(
      fc.property(serverList, (list) => {
        const before = [...list];
        const tiles = tilesFor(list);

        expect(tiles).toHaveLength(list.length);
        expect(tiles.map((tile) => tile.key)).toEqual(list);
        expect(list).toEqual(before);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('for any server list, a known key is its module and any other key is the update tile; nothing else is ever drawn (R6.4, R6.6)', () => {
    fc.assert(
      fc.property(serverList, (list) => {
        const tiles = tilesFor(list);

        expect(tiles).toEqual(list.map(expectedTile));
        for (const tile of tiles) {
          expect(tile.kind === 'module').toBe(isKnown(tile.key));
          if (tile.kind === 'module') {
            // The module's definition is the registry's, by identity, not a copy or a lookalike.
            expect(tile.def).toBe(MODULES[tile.key]);
          } else {
            expect(tile).toEqual({ kind: 'update', key: tile.key });
          }
        }
        // A module the server did not list is never shown (D10): every known module in the grid
        // was in the list, and every known module in the list is in the grid.
        const drawnModules = tiles.filter((tile) => tile.kind === 'module').map((tile) => tile.key);
        expect(drawnModules).toEqual(list.filter(isKnown));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('for any list with repeats, each key is drawn once, at its first position, and the result equals the deduplicated list\u2019s tiles', () => {
    fc.assert(
      fc.property(listWithRepeats, (list) => {
        const tiles = tilesFor(list);
        const distinct = distinctInOrder(list);

        expect(tiles.map((tile) => tile.key)).toEqual(distinct);
        expect(new Set(tiles.map((tile) => tile.key)).size).toBe(tiles.length);
        expect(tiles).toEqual(tilesFor(distinct));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('for any server list, the Attendance tile, when present, is the only large tile and leads the grid; every other tile is half (R6.5)', () => {
    fc.assert(
      fc.property(serverList, (list) => {
        const tiles = tilesFor(list);

        const large = tiles.filter((tile) => tile.kind === 'module' && tile.def.size === 'large');
        if (list.includes('ATTENDANCE')) {
          expect(large).toEqual([{ kind: 'module', key: 'ATTENDANCE', def: MODULES.ATTENDANCE }]);
        } else {
          expect(large).toEqual([]);
        }
        for (const tile of tiles) {
          if (tile.kind === 'module' && tile.key !== 'ATTENDANCE') {
            expect(tile.def.size).toBe('half');
          }
        }

        // The grid draws the large tiles first and the rest in server order (HomeScreen): with one
        // large tile at most, Attendance is first whenever present and the order is otherwise kept.
        const grid = [...large, ...tiles.filter((tile) => !large.includes(tile))];
        const gridKeys = grid.map((tile) => tile.key);
        if (list.includes('ATTENDANCE')) {
          expect(gridKeys[0]).toBe('ATTENDANCE');
        }
        expect(gridKeys.filter((key) => key !== 'ATTENDANCE')).toEqual(
          list.filter((key) => key !== 'ATTENDANCE'),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('for any server list, tilesFor is a function of the list alone: equal lists give equal tiles', () => {
    fc.assert(
      fc.property(serverList, (list) => {
        expect(tilesFor([...list])).toEqual(tilesFor(list));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
