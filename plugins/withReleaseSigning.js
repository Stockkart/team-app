/**
 * Release builds signed with the Play upload key when Gradle is given it, debug-signed otherwise.
 *
 * Adds a `release` signing config to `android/app/build.gradle` that reads four Gradle properties:
 * `uploadStoreFile` (path relative to `android/app`), `uploadStorePassword`, `uploadKeyAlias` and
 * `uploadKeyPassword`. `buildTypes.release` uses it only when all four are set
 * (`./gradlew bundleRelease -PuploadStoreFile=… -P…`, as `.github/workflows/release.yml` does);
 * without them the release build keeps Expo's debug signing, so local and CI builds that have no
 * upload key still work. The key itself never enters the repository.
 */
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// withReleaseSigning';

const UPLOAD_PROPERTIES = [
  'uploadStoreFile',
  'uploadStorePassword',
  'uploadKeyAlias',
  'uploadKeyPassword',
];

const HAS_UPLOAD_KEY = UPLOAD_PROPERTIES.map((name) => `project.hasProperty('${name}')`).join(
  ' && ',
);

const RELEASE_SIGNING_CONFIG = `
        ${MARKER}: Play upload key, only when all four upload* Gradle properties are given
        if (${HAS_UPLOAD_KEY}) {
            release {
                storeFile file(project.property('uploadStoreFile'))
                storePassword project.property('uploadStorePassword')
                keyAlias project.property('uploadKeyAlias')
                keyPassword project.property('uploadKeyPassword')
            }
        }`;

const SIGNING_CONFIGS_OPEN = /^(\s*signingConfigs\s*\{)/m;
const RELEASE_BUILD_TYPE_SIGNING =
  /(buildTypes\s*\{[\s\S]*?\brelease\s*\{[\s\S]*?)signingConfig\s+signingConfigs\.debug/;

function applyReleaseSigning(gradle) {
  if (gradle.includes(MARKER)) {
    return gradle;
  }
  if (!SIGNING_CONFIGS_OPEN.test(gradle) || !RELEASE_BUILD_TYPE_SIGNING.test(gradle)) {
    throw new Error(
      'withReleaseSigning: android/app/build.gradle has no signingConfigs block or no ' +
        '`signingConfig signingConfigs.debug` in buildTypes.release; the Expo template changed.',
    );
  }
  return gradle
    .replace(SIGNING_CONFIGS_OPEN, `$1${RELEASE_SIGNING_CONFIG}`)
    .replace(
      RELEASE_BUILD_TYPE_SIGNING,
      `$1signingConfig signingConfigs.findByName('release') ?: signingConfigs.debug`,
    );
}

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('withReleaseSigning: android/app/build.gradle is not Groovy.');
    }
    cfg.modResults.contents = applyReleaseSigning(cfg.modResults.contents);
    return cfg;
  });
};

module.exports.applyReleaseSigning = applyReleaseSigning;
