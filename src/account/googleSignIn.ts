/**
 * "Continue with Google" for Stockkart Team (worker-app design DD8; R1.4, R1.6). Wraps
 * `@react-native-google-signin/google-signin` and hands back the **ID token only**: the app sends it
 * to `POST /auth/login|signup` (`AccountClient.signInWithGoogle`, `createAccountWithGoogle`) and
 * never reads the Google profile, access token or server auth code.
 *
 * The library is configured with the web OAuth client id (`GOOGLE_WEB_CLIENT_ID`,
 * `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`), so the token's audience is the one the backend already
 * accepts from the web; the backend's allow-list is the check (DD8). After a successful pick the
 * library is signed out again so it keeps no Google session on the phone: the app's only session is
 * the Bearer token in `expo-secure-store` (R9.2).
 *
 * Pure: the library is an injected {@link GoogleSignInModule}, so tests pass a scripted one. The
 * real binding is `./nativeGoogleSignIn.ts`, imported by the composition root only.
 */

/** The part of `GoogleSignin` (the library's entry point) this module uses. */
export interface GoogleSignInModule {
  configure(options: { webClientId: string }): void;
  hasPlayServices(options?: { showPlayServicesUpdateDialog?: boolean }): Promise<boolean>;
  signIn(): Promise<GoogleSignInAnswer>;
  signOut(): Promise<unknown>;
}

/** `GoogleSignin.signIn()`'s answer, narrowed to the fields read here. */
export type GoogleSignInAnswer =
  | { type: 'success'; data: { idToken: string | null } }
  | { type: 'cancelled'; data: null };

/** The library's `statusCodes` the app tells apart (`statusCodes.*` are strings at runtime). */
export interface GoogleStatusCodes {
  SIGN_IN_CANCELLED: string;
  IN_PROGRESS: string;
  PLAY_SERVICES_NOT_AVAILABLE: string;
}

/** What "Continue with Google" produced. */
export type GoogleIdTokenResult =
  /** The worker picked an account; `idToken` goes to the server and nowhere else. */
  | { kind: 'id_token'; idToken: string }
  /** The worker closed the picker (or a second tap arrived while the first was open). */
  | { kind: 'cancelled' }
  /** Android without Google Play services: the screen offers e-mail and password instead. */
  | { kind: 'unavailable' };

export interface GoogleSignInDeps {
  module: GoogleSignInModule;
  /** The web OAuth client id (design DD8). Must be non-empty. */
  webClientId: string;
  statusCodes?: Partial<GoogleStatusCodes>;
}

export interface GoogleSignIn {
  /** Shows Google's account picker and resolves with the ID token, or why there is none. */
  getIdToken(): Promise<GoogleIdTokenResult>;
}

export function createGoogleSignIn(deps: GoogleSignInDeps): GoogleSignIn {
  const webClientId = (deps.webClientId ?? '').trim();
  if (webClientId.length === 0) {
    throw new Error('Google sign-in needs the web client id (EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID)');
  }
  const codes = deps.statusCodes ?? {};
  let configured = false;

  return {
    async getIdToken(): Promise<GoogleIdTokenResult> {
      if (!configured) {
        deps.module.configure({ webClientId });
        configured = true;
      }
      try {
        const available = await deps.module.hasPlayServices({ showPlayServicesUpdateDialog: true });
        if (!available) {
          return { kind: 'unavailable' };
        }
        const answer = await deps.module.signIn();
        if (answer.type !== 'success') {
          return { kind: 'cancelled' };
        }
        const idToken = answer.data?.idToken;
        // The library keeps a Google session until told otherwise; the app wants only the token.
        await deps.module.signOut().catch(() => undefined);
        if (typeof idToken !== 'string' || idToken.length === 0) {
          throw new Error('Google returned no ID token');
        }
        return { kind: 'id_token', idToken };
      } catch (error) {
        const code = errorCode(error);
        if (
          code !== undefined &&
          (code === codes.SIGN_IN_CANCELLED || code === codes.IN_PROGRESS)
        ) {
          return { kind: 'cancelled' };
        }
        if (code !== undefined && code === codes.PLAY_SERVICES_NOT_AVAILABLE) {
          return { kind: 'unavailable' };
        }
        throw error;
      }
    },
  };
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}
