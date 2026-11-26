/**
 * The app's one real {@link GoogleSignIn}, bound to `@react-native-google-signin/google-signin`
 * with the web client id from `src/config.ts` (design DD8). Import this from the composition root
 * only; tests build `createGoogleSignIn` over a scripted module and never load this file (it needs
 * the React Native runtime).
 */
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';

import { GOOGLE_WEB_CLIENT_ID } from '../config';
import { createGoogleSignIn, type GoogleSignIn } from './googleSignIn';

export const nativeGoogleSignIn: GoogleSignIn = createGoogleSignIn({
  module: GoogleSignin,
  webClientId: GOOGLE_WEB_CLIENT_ID,
  statusCodes,
});
