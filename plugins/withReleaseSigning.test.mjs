import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { applyReleaseSigning } = require('./withReleaseSigning.js');

/** The `signingConfigs` / `buildTypes` part of the Expo SDK 55 `android/app/build.gradle`. */
const EXPO_TEMPLATE = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
            minifyEnabled enableMinifyInReleaseBuilds
        }
    }
}
`;

function block(gradle, name) {
  const start = gradle.indexOf(`        ${name} {`, gradle.indexOf('buildTypes {'));
  return gradle.slice(start, gradle.indexOf('\n        }', start));
}

describe('applyReleaseSigning', () => {
  it('adds a release signing config guarded by all four upload properties', () => {
    const gradle = applyReleaseSigning(EXPO_TEMPLATE);
    expect(gradle).toContain(
      "if (project.hasProperty('uploadStoreFile') && project.hasProperty('uploadStorePassword') && " +
        "project.hasProperty('uploadKeyAlias') && project.hasProperty('uploadKeyPassword')) {",
    );
    expect(gradle).toContain("storeFile file(project.property('uploadStoreFile'))");
    expect(gradle).toContain("keyPassword project.property('uploadKeyPassword')");
  });

  it('signs the release build type with it, falling back to debug', () => {
    const release = block(applyReleaseSigning(EXPO_TEMPLATE), 'release');
    expect(release).toContain(
      "signingConfig signingConfigs.findByName('release') ?: signingConfigs.debug",
    );
    expect(release).not.toMatch(/signingConfig signingConfigs\.debug$/m);
  });

  it('leaves the debug build type and debug signing config unchanged', () => {
    const gradle = applyReleaseSigning(EXPO_TEMPLATE);
    expect(block(gradle, 'debug')).toBe(block(EXPO_TEMPLATE, 'debug'));
    expect(gradle).toContain("storeFile file('debug.keystore')");
  });

  it('is idempotent', () => {
    const once = applyReleaseSigning(EXPO_TEMPLATE);
    expect(applyReleaseSigning(once)).toBe(once);
  });

  it('throws when the template has no release debug-signing line', () => {
    const changed = EXPO_TEMPLATE.replace(
      /(release \{[\s\S]*?)signingConfig signingConfigs\.debug/,
      '$1',
    );
    expect(() => applyReleaseSigning(changed)).toThrow(/Expo template changed/);
  });
});
