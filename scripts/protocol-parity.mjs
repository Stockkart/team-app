#!/usr/bin/env node
/**
 * Protocol parity (worker-app D17, DD21): `packages/attendance-protocol` in this repository must be
 * byte-identical to `platform/attendance-protocol` in the web monorepo (`inventory-platform`) for
 * every file under `src/**` and `fixtures/**`. The Java fixtures in `inventory-api` are the real
 * contract; this script only proves the two TypeScript copies have not drifted.
 *
 *   node scripts/protocol-parity.mjs                     # other repo at ../inventory-platform
 *   INVENTORY_PLATFORM_DIR=/path/to/inventory-platform node scripts/protocol-parity.mjs
 *
 * Exit 0 with `skip: inventory-platform not found at <dir>` when `<dir>/platform/attendance-protocol`
 * does not exist (a clone of this repository alone; CI without a token for the other repository).
 * Otherwise every file missing on either side and every file whose bytes differ is printed and the
 * exit code is 1; with no finding it prints `protocol parity: N files identical` and exits 0.
 *
 * Plain Node, no dependency. The comparison is exported for `protocol-parity.test.mjs`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The two trees compared, relative to each protocol package root. */
export const COMPARED_DIRS = ['src', 'fixtures'];

/** Every regular file under `dir`, as POSIX paths relative to `dir`, sorted. Missing dir → []. */
function listFiles(dir) {
  if (!existsSync(dir)) {
    return [];
  }
  const out = [];
  const walk = (current) => {
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else {
        out.push(relative(dir, path).split(sep).join('/'));
      }
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * Compares `src/**` and `fixtures/**` of two protocol package roots.
 *
 * @returns {{ identical: string[], missingInApp: string[], missingInPlatform: string[], different: string[] }}
 *   paths relative to the package roots (`src/phone.ts`, `fixtures/phones.json`).
 */
export function compareProtocolCopies(appRoot, platformRoot) {
  const result = { identical: [], missingInApp: [], missingInPlatform: [], different: [] };
  for (const dir of COMPARED_DIRS) {
    const appFiles = new Set(listFiles(join(appRoot, dir)).map((f) => `${dir}/${f}`));
    const platformFiles = new Set(listFiles(join(platformRoot, dir)).map((f) => `${dir}/${f}`));
    const all = [...new Set([...appFiles, ...platformFiles])].sort();
    for (const file of all) {
      if (!appFiles.has(file)) {
        result.missingInApp.push(file);
      } else if (!platformFiles.has(file)) {
        result.missingInPlatform.push(file);
      } else if (readFileSync(join(appRoot, file)).equals(readFileSync(join(platformRoot, file)))) {
        result.identical.push(file);
      } else {
        result.different.push(file);
      }
    }
  }
  return result;
}

/**
 * Runs the check and returns the exit code; `log` receives every output line.
 *
 * @param {{ appRoot: string, platformDir: string, log?: (line: string) => void }} options
 *   `platformDir` is the `inventory-platform` checkout; the protocol is `<platformDir>/platform/attendance-protocol`.
 */
export function run({ appRoot, platformDir, log = console.log }) {
  const platformRoot = join(platformDir, 'platform', 'attendance-protocol');
  if (!existsSync(platformRoot)) {
    log(`skip: inventory-platform not found at ${platformDir}`);
    return 0;
  }
  const r = compareProtocolCopies(appRoot, platformRoot);
  for (const f of r.missingInApp) {
    log(`missing in app copy (packages/attendance-protocol): ${f}`);
  }
  for (const f of r.missingInPlatform) {
    log(`missing in platform copy (${platformRoot}): ${f}`);
  }
  for (const f of r.different) {
    log(`differs: ${f}`);
  }
  const findings = r.missingInApp.length + r.missingInPlatform.length + r.different.length;
  if (findings > 0) {
    log(
      `protocol parity: ${findings} finding(s); change both copies, platform first, then this repository (DD21)`,
    );
    return 1;
  }
  log(`protocol parity: ${r.identical.length} files identical`);
  return 0;
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const platformDir = resolve(
    repoRoot,
    process.env.INVENTORY_PLATFORM_DIR?.trim() || join('..', 'inventory-platform'),
  );
  process.exitCode = run({
    appRoot: join(repoRoot, 'packages', 'attendance-protocol'),
    platformDir,
  });
}
