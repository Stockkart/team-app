/**
 * Tests for `protocol-parity.mjs` (worker-app D17, DD21) on temp directories: identical copies,
 * one byte changed, one file missing on each side, the other repository absent.
 *
 *   node --test scripts/protocol-parity.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { compareProtocolCopies, run } from './protocol-parity.mjs';

const FILES = {
  'src/index.ts': "export * from './phone.js';\n",
  'src/phone.ts': 'export const normalisePhone = (s) => s.replace(/\\D/g, "");\n',
  'src/phone.test.ts': "import { it } from 'vitest';\nit('runs', () => {});\n",
  'fixtures/phones.json': '[{"input":"+91 98765 43210","expected":"+919876543210"}]\n',
  'fixtures/canonical.json': '{"cases":[]}\n',
  // Outside src/ and fixtures/: never compared, may differ freely (package name, vite config, ...).
  'package.json': '{"name":"x"}\n',
};

function writeTree(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
}

describe('protocol-parity', () => {
  let tmp;
  let appRoot;
  let platformDir;
  let platformRoot;
  let lines;
  const log = (line) => lines.push(line);

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'protocol-parity-'));
    appRoot = join(tmp, 'stockkart-team-app', 'packages', 'attendance-protocol');
    platformDir = join(tmp, 'inventory-platform');
    platformRoot = join(platformDir, 'platform', 'attendance-protocol');
    writeTree(appRoot, { ...FILES, 'package.json': '{"name":"@stockkart/attendance-protocol"}\n' });
    writeTree(platformRoot, FILES);
    lines = [];
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('identical copies: exit 0 and the count of compared files (src/** and fixtures/** only)', () => {
    const code = run({ appRoot, platformDir, log });
    assert.equal(code, 0);
    assert.deepEqual(lines, ['protocol parity: 5 files identical']);
  });

  it('one byte changed on one side: exit 1 and the file is named', () => {
    writeFileSync(
      join(appRoot, 'fixtures/phones.json'),
      FILES['fixtures/phones.json'].replace('0', '1'),
    );
    const code = run({ appRoot, platformDir, log });
    assert.equal(code, 1);
    assert.ok(
      lines.some((l) => l === 'differs: fixtures/phones.json'),
      lines.join('\n'),
    );
    assert.ok(!lines.some((l) => l.includes('identical')));
    const r = compareProtocolCopies(appRoot, platformRoot);
    assert.deepEqual(r.different, ['fixtures/phones.json']);
    assert.equal(r.identical.length, 4);
  });

  it('a file missing in the app copy: exit 1 and the file is named', () => {
    rmSync(join(appRoot, 'src/phone.test.ts'));
    const code = run({ appRoot, platformDir, log });
    assert.equal(code, 1);
    assert.ok(
      lines.some((l) => l.startsWith('missing in app copy') && l.endsWith('src/phone.test.ts')),
      lines.join('\n'),
    );
    assert.deepEqual(compareProtocolCopies(appRoot, platformRoot).missingInApp, [
      'src/phone.test.ts',
    ]);
  });

  it('a file missing in the platform copy: exit 1 and the file is named', () => {
    rmSync(join(platformRoot, 'fixtures/canonical.json'));
    const code = run({ appRoot, platformDir, log });
    assert.equal(code, 1);
    assert.ok(
      lines.some(
        (l) => l.startsWith('missing in platform copy') && l.endsWith('fixtures/canonical.json'),
      ),
      lines.join('\n'),
    );
    assert.deepEqual(compareProtocolCopies(appRoot, platformRoot).missingInPlatform, [
      'fixtures/canonical.json',
    ]);
  });

  it('other repository absent: prints the skip line and exits 0', () => {
    const absent = join(tmp, 'nowhere');
    const code = run({ appRoot, platformDir: absent, log });
    assert.equal(code, 0);
    assert.deepEqual(lines, [`skip: inventory-platform not found at ${absent}`]);
  });

  it('files outside src/ and fixtures/ are not compared', () => {
    writeFileSync(
      join(platformRoot, 'package.json'),
      '{"name":"@inventory-platform/attendance-protocol"}\n',
    );
    writeFileSync(join(platformRoot, 'README.md'), 'web copy\n');
    assert.equal(run({ appRoot, platformDir, log }), 0);
  });
});
