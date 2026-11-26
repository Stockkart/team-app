#!/usr/bin/env node
/**
 * Cross-checks `src/i18n/strings.en.ts` against the code (R12.11): every string id must be
 * referenced somewhere under `src/` (outside the strings file and its tests), and every
 * `t('...')` id used in `src/` must exist. Plain Node, no dependency; run from the repository root:
 *
 *   node scripts/check-strings.mjs
 *
 * Exit code 1 and a list on either kind of mismatch. Ids built at runtime (`t(errors.email)`,
 * `t(label)`) are not checked: the type `StringId` covers them at compile time.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const stringsFile = join(root, 'src', 'i18n', 'strings.en.ts');

const declared = new Set(
  [...readFileSync(stringsFile, 'utf8').matchAll(/^\s*'([a-zA-Z0-9.]+)':/gm)].map((m) => m[1]),
);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      yield* walk(path);
    } else if (/\.(ts|tsx)$/.test(name)) {
      yield path;
    }
  }
}

/** Ids passed to `t('...')` in code (not tests): each must be declared. id → first file seen. */
const calledInCode = new Map();
/** Every id mentioned anywhere (code, tests, data literals): a declared id must be in here. */
const mentioned = new Set();
for (const file of [...walk(join(root, 'src')), ...walk(join(root, 'test-support'))]) {
  if (file === stringsFile) {
    continue;
  }
  const text = readFileSync(file, 'utf8');
  const isTest = /\.test\.tsx?$/.test(file) || file.includes(`${join('test-support')}`);
  for (const m of text.matchAll(/\bt\(\s*'([a-zA-Z0-9.]+)'/g)) {
    mentioned.add(m[1]);
    if (!isTest && !calledInCode.has(m[1])) calledInCode.set(m[1], relative(root, file));
  }
  // Ids passed as data, e.g. `label: 'module.attendance'` in the module registry or an error map.
  for (const m of text.matchAll(/'([a-z][a-zA-Z0-9]*\.[a-zA-Z0-9]+)'/g)) {
    if (declared.has(m[1])) mentioned.add(m[1]);
  }
}

const unused = [...declared].filter((id) => !mentioned.has(id));
const unknown = [...calledInCode].filter(([id]) => !declared.has(id));

for (const id of unused) console.error(`unused string id: ${id}`);
for (const [id, file] of unknown) console.error(`unknown string id ${id} in ${file}`);

if (unused.length > 0 || unknown.length > 0) {
  process.exit(1);
}
console.log(`strings ok: ${declared.size} ids declared, all referenced and all known`);
