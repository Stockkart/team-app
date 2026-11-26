/**
 * The module grid's registry (worker-app design "Module registry"; R6.4, R6.6; Property 15). The
 * server sends the module keys a shop's worker may use (`WorkerStateResponse.modules`, in server
 * order); {@link tilesFor} turns that list into the tiles Home draws:
 *
 * - one tile per entry, in the server's order, nothing added (a module the server did not list is
 *   never shown, D10);
 * - a key this version knows (`MODULES`) opens its module route; `ATTENDANCE` is the one `large`
 *   tile and carries today's status line (R6.5); each carries the `tint` of its icon circle
 *   (R12.15: Attendance `brandSoft`, History `successSoft`, Profile `accent`);
 * - a key this version does not know becomes an `update` tile that says "Update the app to use
 *   this." when tapped and never navigates (R6.6), on the `UNKNOWN_MODULE_TINT` circle;
 * - a key the server repeats is drawn once (the server removes duplicates; the app does too so a
 *   tile key is unique in the grid).
 *
 * Pure: no React, Expo or React Native import. The screen (`src/home/HomeScreen.tsx`) maps tiles
 * to `ModuleTile`s and the navigator maps `screen` to a route.
 */
import type { ModuleKey } from '@stockkart/attendance-protocol';

import type { IconName, ModuleTileSize, ModuleTileTint } from '../components';
import type { StringId } from '../i18n';

/** A module this app version knows. */
export interface ModuleDef {
  icon: IconName;
  /** The string id of the tile label (`t(label)`). */
  label: StringId;
  /** The route the tile opens. */
  screen: 'Attendance' | 'History' | 'Profile';
  size: ModuleTileSize;
  /** The tint of the tile's icon circle (R12.15). */
  tint: ModuleTileTint;
}

/** The icon circle of a tile for a module this version does not know (R6.6, R12.15). */
export const UNKNOWN_MODULE_TINT: ModuleTileTint = 'warningSoft';

export const MODULES: Record<ModuleKey, ModuleDef> = {
  ATTENDANCE: {
    icon: 'fingerprint',
    label: 'module.attendance',
    screen: 'Attendance',
    size: 'large',
    tint: 'brandSoft',
  },
  HISTORY: {
    icon: 'history',
    label: 'module.history',
    screen: 'History',
    size: 'half',
    tint: 'successSoft',
  },
  PROFILE: {
    icon: 'person',
    label: 'module.profile',
    screen: 'Profile',
    size: 'half',
    tint: 'accent',
  },
};

/** One tile of the grid: a known module, or the update tile for a key this version does not know. */
export type Tile =
  | { kind: 'module'; key: ModuleKey; def: ModuleDef }
  | { kind: 'update'; key: string };

export function isKnownModule(key: string): key is ModuleKey {
  return Object.prototype.hasOwnProperty.call(MODULES, key);
}

/**
 * The tiles for the server's module list: same order, one per distinct entry, known keys mapped
 * to their module, unknown keys to the update tile (R6.4, R6.6).
 */
export function tilesFor(serverList: readonly string[]): Tile[] {
  const seen = new Set<string>();
  const tiles: Tile[] = [];
  for (const key of serverList) {
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    tiles.push(
      isKnownModule(key) ? { kind: 'module', key, def: MODULES[key] } : { kind: 'update', key },
    );
  }
  return tiles;
}
