import { describe, expect, it } from 'vitest';

import {
  createGoogleSignIn,
  type GoogleSignInAnswer,
  type GoogleSignInModule,
} from './googleSignIn';

const CODES = {
  SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
  IN_PROGRESS: 'IN_PROGRESS',
  PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
};

function fakeModule(
  answers: Array<GoogleSignInAnswer | Error>,
  options: { playServices?: boolean } = {},
) {
  const calls: string[] = [];
  let configuredWith: string | undefined;
  const module: GoogleSignInModule = {
    configure(o) {
      calls.push('configure');
      configuredWith = o.webClientId;
    },
    async hasPlayServices() {
      calls.push('hasPlayServices');
      return options.playServices ?? true;
    },
    async signIn() {
      calls.push('signIn');
      const answer = answers.shift();
      if (answer === undefined) {
        throw new Error('fakeModule: no answer queued');
      }
      if (answer instanceof Error) {
        throw answer;
      }
      return answer;
    },
    async signOut() {
      calls.push('signOut');
      return null;
    },
  };
  return { module, calls, configuredWith: () => configuredWith };
}

function withCode(code: string): Error {
  return Object.assign(new Error(code), { code });
}

describe('createGoogleSignIn', () => {
  it('configures once with the web client id and returns the ID token only, then signs Google out', async () => {
    const fake = fakeModule([
      { type: 'success', data: { idToken: 'id-token-1' } },
      { type: 'success', data: { idToken: 'id-token-2' } },
    ]);
    const google = createGoogleSignIn({
      module: fake.module,
      webClientId: ' web-client-id ',
      statusCodes: CODES,
    });
    expect(await google.getIdToken()).toEqual({ kind: 'id_token', idToken: 'id-token-1' });
    expect(await google.getIdToken()).toEqual({ kind: 'id_token', idToken: 'id-token-2' });
    expect(fake.configuredWith()).toBe('web-client-id');
    expect(fake.calls).toEqual([
      'configure',
      'hasPlayServices',
      'signIn',
      'signOut',
      'hasPlayServices',
      'signIn',
      'signOut',
    ]);
  });

  it('reports cancelled for a closed picker (answer or thrown code) and unavailable without Play services', async () => {
    const fake = fakeModule([
      { type: 'cancelled', data: null },
      withCode(CODES.SIGN_IN_CANCELLED),
      withCode(CODES.IN_PROGRESS),
      withCode(CODES.PLAY_SERVICES_NOT_AVAILABLE),
    ]);
    const google = createGoogleSignIn({
      module: fake.module,
      webClientId: 'w',
      statusCodes: CODES,
    });
    expect(await google.getIdToken()).toEqual({ kind: 'cancelled' });
    expect(await google.getIdToken()).toEqual({ kind: 'cancelled' });
    expect(await google.getIdToken()).toEqual({ kind: 'cancelled' });
    expect(await google.getIdToken()).toEqual({ kind: 'unavailable' });

    const noPlay = fakeModule([], { playServices: false });
    const g2 = createGoogleSignIn({ module: noPlay.module, webClientId: 'w' });
    expect(await g2.getIdToken()).toEqual({ kind: 'unavailable' });
    expect(noPlay.calls).not.toContain('signIn');
  });

  it('throws on a success without an ID token, on an unknown error, and on an empty client id', async () => {
    const fake = fakeModule([{ type: 'success', data: { idToken: null } }, new Error('boom')]);
    const google = createGoogleSignIn({
      module: fake.module,
      webClientId: 'w',
      statusCodes: CODES,
    });
    await expect(google.getIdToken()).rejects.toThrow(/no ID token/);
    await expect(google.getIdToken()).rejects.toThrow('boom');
    expect(() => createGoogleSignIn({ module: fake.module, webClientId: '  ' })).toThrow(
      /client id/,
    );
  });
});
