/**
 * Dynamic Expo config. Expo CLI reads `app.json`, passes it in as `config`, and uses what this
 * function returns. The only thing added here is a build-time gate on the `EXPO_PUBLIC_*` values
 * Metro inlines into the JS bundle, so every `expo start`, `expo prebuild` and `eas build` refuses
 * to proceed when one is wrong:
 *
 * - `EXPO_PUBLIC_API_URL` must be an `https://` URL (requirement R9.7: the app never talks plain
 *   HTTP).
 * - `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` must be present (design DD8: Google sign-in asks for an ID
 *   token with the web client id as its audience; an empty id would fail only when a worker taps
 *   "Continue with Google").
 *
 * `src/config.ts` applies the same rules to the inlined values when the bundle loads.
 *
 * Set the variables in `.env` at the repository root for local work (see `.env-example`) and as EAS
 * environment variables for the `preview` and `production` build profiles (`eas.json`).
 */
const HTTPS_URL = /^https:\/\/[^\s/?#]+/;

const WHERE_TO_SET =
  'Set it in .env at the repository root or in the EAS environment for this build profile.';

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
  return config;
};
