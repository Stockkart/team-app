/**
 * Build-time configuration of the Attendance app.
 *
 * `EXPO_PUBLIC_*` variables are inlined into the bundle by Metro, so the values checked here are
 * fixed at build time. `app.config.js` applies the same rules before any build starts; this module
 * repeats them on the inlined values so a bundle can never carry a plain-HTTP API URL (requirement
 * R9.7) or an empty Google client id. A bad value throws on first import, before any screen
 * renders.
 *
 * `new URL()` is deliberately not used: React Native's built-in `URL` throws "not implemented"
 * for `protocol` and most other getters.
 */

/** `https://` followed by a host: no whitespace, path, query or fragment inside the host. */
const HTTPS_URL = /^https:\/\/[^\s/?#]+/;

/**
 * Returns `value` trimmed and without trailing slashes, or throws when it is missing, is not a
 * URL, or does not use `https://`. `name` is only used in the error message.
 */
export function requireHttpsUrl(name: string, value: string | undefined): string {
  const trimmed = (value ?? '').trim();
  if (trimmed === '') {
    throw new Error(`${name} is not set. The Attendance app needs an https:// API URL.`);
  }
  if (!HTTPS_URL.test(trimmed)) {
    throw new Error(
      `${name} must be an https:// URL, got ${JSON.stringify(trimmed)}. ` +
        'The Attendance app never uses plain HTTP.',
    );
  }
  return trimmed.replace(/\/+$/, '');
}

/**
 * Returns `value` trimmed, or throws when it is missing or blank. `name` is only used in the error
 * message. For values that must be present at build time but have no shape worth checking here.
 */
export function requirePresent(name: string, value: string | undefined): string {
  const trimmed = (value ?? '').trim();
  if (trimmed === '') {
    throw new Error(`${name} is not set. The Attendance app needs it at build time.`);
  }
  return trimmed;
}

/** Base URL of inventory-api, e.g. `https://api.example.in/api/v1`. Never `http://`. */
export const API_URL = requireHttpsUrl('EXPO_PUBLIC_API_URL', process.env.EXPO_PUBLIC_API_URL);

/**
 * The Google OAuth **web** client id (design DD8): the app asks Google for an ID token with this
 * audience so the backend accepts it with the same allow-list entry the web uses. A client id is
 * public by design (it is in the web bundle too); the matching secret never leaves Google's side.
 */
export const GOOGLE_WEB_CLIENT_ID = requirePresent(
  'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID',
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
);

/**
 * Base URL of the web dashboard, for the one web page the app opens in the browser: the password
 * reset page behind "Forgot password?" (worker-app R1.6; the reset flow is the web's, by e-mail).
 * Optional: when `EXPO_PUBLIC_WEB_URL` is not set the web is taken to live at the API URL's
 * origin (`https://stockkart.in/api/v1` → `https://stockkart.in`), which is how the app is
 * deployed. When set it must be `https://`, like the API URL.
 */
export const WEB_URL = webUrl(process.env.EXPO_PUBLIC_WEB_URL, API_URL);

/** The web's forgot-password route (`platform/shell` `AuthInitializer`: `/forgot-password`). */
export const FORGOT_PASSWORD_URL = `${WEB_URL}/forgot-password`;

/** {@link WEB_URL}'s rule as a function, for tests: the variable when set, else the API origin. */
export function webUrl(value: string | undefined, apiUrl: string): string {
  if ((value ?? '').trim() !== '') {
    return requireHttpsUrl('EXPO_PUBLIC_WEB_URL', value);
  }
  const match = /^https:\/\/[^\s/?#]+/.exec(apiUrl);
  if (!match) {
    throw new Error('EXPO_PUBLIC_API_URL must be an https:// URL to derive the web URL from.');
  }
  return match[0];
}
