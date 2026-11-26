/**
 * Dynamic Expo config. Expo CLI reads `app.json`, passes it in as `config`, and uses what this
 * function returns. Two things are added here.
 *
 * A build-time gate on the `EXPO_PUBLIC_*` values Metro inlines into the JS bundle, so every
 * `expo start` and `expo prebuild` refuses to proceed when one is wrong:
 *
 * - `EXPO_PUBLIC_API_URL` must be an `https://` URL (requirement R9.7: the app never talks plain
 *   HTTP).
 * - `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` must be present (design DD8: Google sign-in asks for an ID
 *   token with the web client id as its audience; an empty id would fail only when a worker taps
 *   "Continue with Google").
 *
 * `src/config.ts` applies the same rules to the inlined values when the bundle loads.
 *
 * Release version overrides: `APP_VERSION_CODE` (a positive integer, Play's `versionCode`) and
 * `APP_VERSION_NAME` replace `android.versionCode` and `version` from `app.json` when set.
 * `.github/workflows/release.yml` sets both; without them the `app.json` values apply.
 *
 * Set the `EXPO_PUBLIC_*` variables in `.env` at the repository root for local work (see
 * `.env-example`) and as repository variables for the release workflow (README → Releasing).
 */
const HTTPS_URL = /^https:\/\/[^\s/?#]+/;

const WHERE_TO_SET =
  'Set it in .env at the repository root or in the GitHub repository variables for a release build.';

/** Play rejects a versionCode above 2100000000. */
const MAX_VERSION_CODE = 2100000000;

function versionOverrides(config) {
  const versionCodeText = (process.env.APP_VERSION_CODE ?? '').trim();
  const versionName = (process.env.APP_VERSION_NAME ?? '').trim();
  let android = config.android;
  if (versionCodeText !== '') {
    const versionCode = Number(versionCodeText);
    if (!/^[0-9]+$/.test(versionCodeText) || versionCode < 1 || versionCode > MAX_VERSION_CODE) {
      throw new Error(
        `APP_VERSION_CODE must be an integer from 1 to ${MAX_VERSION_CODE} (got ${JSON.stringify(
          versionCodeText,
        )}).`,
      );
    }
    android = { ...config.android, versionCode };
  }
  return {
    ...config,
    ...(versionName !== '' ? { version: versionName } : {}),
    android,
  };
}

module.exports = ({ config }) => {
  const apiUrl = (process.env.EXPO_PUBLIC_API_URL ?? '').trim();
  if (!HTTPS_URL.test(apiUrl)) {
    throw new Error(
      `EXPO_PUBLIC_API_URL must be an https:// URL (got ${JSON.stringify(
        apiUrl,
      )}). ${WHERE_TO_SET}`,
    );
  }
  const googleWebClientId = (process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '').trim();
  if (googleWebClientId === '') {
    throw new Error(`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is not set. ${WHERE_TO_SET}`);
  }
  return versionOverrides(config);
};
