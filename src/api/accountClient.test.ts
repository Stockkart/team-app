import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  OAUTH_ACCOUNT_NOT_FOUND,
  SERVER_MESSAGES,
  TOO_MANY_ATTEMPTS_WORKER,
  WORKER_ERROR_CODE_NUMBERS,
  WORKER_SERVER_MESSAGES,
} from '@stockkart/attendance-protocol';
import type { WorkerErrorCode } from '@stockkart/attendance-protocol';

import {
  ACCOUNT_ROUTES,
  AUTH_SOURCE,
  AccountClient,
  ENVELOPE_HEADERS,
  NoSession,
  inferAccountErrorCode,
  toStoredAccount,
  type AuthResponse,
} from './accountClient';
import { NotAuthenticated, NotReachable, ServerRefusal, type FetchLike } from './transport';

const BASE = 'https://api.example.in/api/v1';
const TOKEN = 'tok-7-days';

interface Captured {
  url: string;
  init: RequestInit;
  headers: Record<string, string>;
}

function fakeFetch(answers: Array<Response | Error | 'hang'>) {
  const captured: Captured[] = [];
  const fetch: FetchLike = (url, init) => {
    captured.push({ url, init, headers: { ...(init.headers as Record<string, string>) } });
    const answer = answers.shift();
    if (answer === undefined) {
      throw new Error('fakeFetch: no answer queued');
    }
    if (answer === 'hang') {
      return new Promise<Response>((_, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted.', 'AbortError')),
        );
      });
    }
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  };
  return { fetch, captured };
}

function ok(data: unknown): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function refused(status: number, message: string): Response {
  return new Response(
    JSON.stringify({ success: false, error: message, data: { message, status } }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}

const loginAnswer: AuthResponse = {
  accessToken: TOKEN,
  refreshToken: 'refresh-unused',
  user: {
    userId: '66f1a2b3c4d5e6f708192a3b',
    role: 'WORKER',
    shopId: null,
    email: 'priya@example.in',
    name: 'Priya Sharma',
    phone: '9876543210',
    active: true,
    createdAt: '2025-04-03T03:42:08Z',
  },
  shop: null,
};

function client(answers: Array<Response | Error | 'hang'>, token: string | null = TOKEN) {
  const { fetch, captured } = fakeFetch(answers);
  const c = new AccountClient({
    baseUrl: BASE,
    tokens: { accessToken: async () => token },
    fetch,
    timeoutMs: 1000,
  });
  return { c, captured };
}

function expectBearerOnly(headers: Record<string, string>) {
  expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
  for (const name of ENVELOPE_HEADERS) {
    expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain(name.toLowerCase());
  }
}

describe('AccountClient', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('session calls carry Authorization: Bearer <token> and no envelope header (R9.1)', async () => {
    const { c, captured } = client([
      ok({ state: 'NO_SHOP', modules: [], notifications: { unread: 0, top: [] } }),
      ok({ shops: [] }),
      ok([]),
      ok({ items: [], unread: 0 }),
    ]);
    await c.workerState();
    await c.lookupShops(' ramesh@example.in ');
    await c.history('2025-03-04', '2025-04-03');
    await c.notifications();

    expect(captured.map((r) => r.url)).toEqual([
      `${BASE}${ACCOUNT_ROUTES.me}`,
      `${BASE}${ACCOUNT_ROUTES.shops}?ownerEmail=ramesh%40example.in`,
      `${BASE}${ACCOUNT_ROUTES.punches}?from=2025-03-04&to=2025-04-03`,
      `${BASE}${ACCOUNT_ROUTES.notifications}`,
    ]);
    for (const request of captured) {
      expect(request.init.method).toBe('GET');
      expectBearerOnly(request.headers);
      expect(request.init.body).toBeUndefined();
    }
  });

  it('POSTs go to the design paths with a JSON body, once, and never retry', async () => {
    const { c, captured } = client([
      ok({
        id: 'r1',
        shopName: 'Sri Ganesh Stores',
        status: 'PENDING',
        requestedAt: 't',
      }),
      ok({
        id: 'r1',
        shopName: 'Sri Ganesh Stores',
        status: 'WITHDRAWN',
        requestedAt: 't',
      }),
      ok({ read: true }),
      new TypeError('Network request failed'),
    ]);
    await c.createJoinRequest('5f1a2b3c4d5e6f7081920001');
    await c.withdraw('r1');
    await c.markRead('n/1');
    const failed = await c.leaveShop().catch((e: unknown) => e);

    expect(captured.map((r) => [r.init.method, r.url, r.init.body])).toEqual([
      ['POST', `${BASE}${ACCOUNT_ROUTES.joinRequests}`, '{"shopId":"5f1a2b3c4d5e6f7081920001"}'],
      ['POST', `${BASE}/hr/worker/join-requests/r1/withdraw`, undefined],
      ['POST', `${BASE}/hr/worker/notifications/n%2F1/read`, undefined],
      ['POST', `${BASE}${ACCOUNT_ROUTES.leave}`, undefined],
    ]);
    for (const request of captured) {
      expectBearerOnly(request.headers);
    }
    expect(failed).toBeInstanceOf(NotReachable);
    expect(captured).toHaveLength(4);
  });

  it('pairing calls use /hr/worker/pairings/* with the Bearer token (R7.2)', async () => {
    const { c, captured } = client([
      ok({ claimToken: 'ct' }),
      ok({ pairingId: 'p' }),
      ok({ abandoned: true }),
    ]);
    await c.claim({
      code: 'ABCD2345',
      installationId: 'i',
      os: 'ANDROID',
      osVersion: '14',
      phoneModel: 'Pixel',
      appVersion: '1.0.0',
    });
    await c.complete({
      claimToken: 'ct',
      installationId: 'i',
      punchPublicKey: 'pk',
      devicePublicKey: 'dk',
      consentVersion: 1,
    });
    await c.abandon({ claimToken: 'ct' });
    expect(captured.map((r) => r.url)).toEqual([
      `${BASE}${ACCOUNT_ROUTES.claim}`,
      `${BASE}${ACCOUNT_ROUTES.complete}`,
      `${BASE}${ACCOUNT_ROUTES.abandon}`,
    ]);
    for (const request of captured) {
      expectBearerOnly(request.headers);
    }
  });

  it('logout POSTs /auth/logout once with the Bearer token and no body (R9.5)', async () => {
    const { c, captured } = client([ok({ success: true, message: 'Logged out' })]);
    expect(await c.logout()).toEqual({ success: true, message: 'Logged out' });
    expect(captured).toHaveLength(1);
    expect(captured[0].init.method).toBe('POST');
    expect(captured[0].url).toBe(`${BASE}${ACCOUNT_ROUTES.logout}`);
    expect(captured[0].init.body).toBeUndefined();
    expectBearerOnly(captured[0].headers);
  });

  it('a POST that may create something is sent once whether it times out, hits a 5xx or is refused, and the timeout is the configured one', async () => {
    vi.useFakeTimers();
    const hang = client(['hang']);
    const timedOut = hang.c.createJoinRequest('5f1a2b3c4d5e6f7081920001').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(999);
    expect(hang.captured[0].init.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(((await timedOut) as NotReachable).reason).toBe('TIMEOUT');
    expect(hang.captured).toHaveLength(1);
    vi.useRealTimers();

    const { c, captured } = client([
      new Response('busy', { status: 503 }),
      refused(409, 'You already have a request waiting.'),
    ]);
    const busy = (await c.leaveShop().catch((e: unknown) => e)) as NotReachable;
    expect(busy).toBeInstanceOf(NotReachable);
    expect(busy.reason).toBe('SERVER_ERROR');
    const pending = (await c
      .createJoinRequest('5f1a2b3c4d5e6f7081920001')
      .catch((e: unknown) => e)) as ServerRefusal;
    expect(pending).toBeInstanceOf(ServerRefusal);
    expect(pending.code).toBe('HR_WORKER_REQUEST_PENDING');
    expect(pending.message).toBe('You already have a request waiting.');
    expect(captured).toHaveLength(2);
    expect(captured.map((r) => r.init.method)).toEqual(['POST', 'POST']);
  });

  it('createAccount sends role WORKER, source worker-app and exactly the R1.2 fields', async () => {
    const { c, captured } = client([ok(loginAnswer), ok(loginAnswer)], null);
    const stored = await c.createAccount({
      name: 'Priya Sharma',
      email: 'priya@example.in',
      password: 'secret-123',
      phone: '+91 98765 43210',
    });
    await c.createAccountWithGoogle({ idToken: 'google-id-token', phone: '9876543210' });

    expect(captured[0].url).toBe(`${BASE}${ACCOUNT_ROUTES.signup}`);
    expect(JSON.parse(String(captured[0].init.body))).toEqual({
      name: 'Priya Sharma',
      email: 'priya@example.in',
      password: 'secret-123',
      phone: '+91 98765 43210',
      role: 'WORKER',
      source: AUTH_SOURCE,
    });
    expect(JSON.parse(String(captured[1].init.body))).toEqual({
      idToken: 'google-id-token',
      signupType: 'google',
      phone: '9876543210',
      role: 'WORKER',
      source: 'worker-app',
    });
    for (const request of captured) {
      expect(request.headers.Authorization).toBeUndefined();
      expect(request.headers['Content-Type']).toBe('application/json');
    }
    expect(stored).toEqual({
      accessToken: TOKEN,
      userId: '66f1a2b3c4d5e6f708192a3b',
      name: 'Priya Sharma',
      email: 'priya@example.in',
      phone: '9876543210',
      role: 'WORKER',
    });
  });

  it('signIn sends no credential and treats a 401 as a refusal, not a session end (R1.6)', async () => {
    const { c, captured } = client(
      [ok(loginAnswer), refused(401, 'Invalid email or password'), ok(loginAnswer)],
      null,
    );
    await c.signIn({ email: 'priya@example.in', password: 'pw' });
    expect(captured[0].url).toBe(`${BASE}${ACCOUNT_ROUTES.login}`);
    expect(JSON.parse(String(captured[0].init.body))).toEqual({
      email: 'priya@example.in',
      password: 'pw',
      source: 'worker-app',
    });
    expect(captured[0].headers.Authorization).toBeUndefined();

    const wrong = await c
      .signIn({ email: 'priya@example.in', password: 'nope' })
      .catch((e: unknown) => e);
    expect(wrong).toBeInstanceOf(ServerRefusal);
    expect((wrong as ServerRefusal).code).toBe('INVALID_CREDENTIALS');
    expect((wrong as ServerRefusal).message).toBe('Invalid email or password');

    await c.signInWithGoogle('google-id-token');
    expect(JSON.parse(String(captured[2].init.body))).toEqual({
      idToken: 'google-id-token',
      loginType: 'google',
      source: 'worker-app',
    });
  });

  it('a 401 on a session call surfaces as NotAuthenticated for the state machine (R9.3)', async () => {
    const { c } = client([refused(401, 'Authentication required')]);
    const error = await c.workerState().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotAuthenticated);
    expect((error as NotAuthenticated).message).toBe('Authentication required');
  });

  it('a session call without a stored token throws NoSession and sends nothing', async () => {
    const { c, captured } = client([], null);
    await expect(c.workerState()).rejects.toBeInstanceOf(NoSession);
    await expect(c.imageSource('/api/v1/users/u/photo')).rejects.toBeInstanceOf(NoSession);
    expect(captured).toHaveLength(0);
  });

  it('a 403 on the Bearer paths is ACCESS_DENIED, never "not paired"', async () => {
    const { c } = client([refused(403, 'Access denied')]);
    const error = (await c.profile().catch((e: unknown) => e)) as ServerRefusal;
    expect(error).toBeInstanceOf(ServerRefusal);
    expect(error.code).toBe('ACCESS_DENIED');
    expect(error.notPaired).toBe(false);
    expect(error.message).toBe('Access denied');
  });

  it('uploadPhoto sends one multipart part named photo and lets fetch set the content type', async () => {
    const { c, captured } = client([
      ok({
        photoUrl: '/api/v1/users/u/photo',
        contentType: 'image/jpeg',
        bytes: 3,
        updatedAt: 't',
      }),
      ok({ deleted: true }),
    ]);
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
    const answer = await c.uploadPhoto({ blob, contentType: 'image/jpeg' });
    await c.deletePhoto();

    expect(answer.photoUrl).toBe('/api/v1/users/u/photo');
    const [put, del] = captured;
    expect(put.init.method).toBe('PUT');
    expect(put.url).toBe(`${BASE}${ACCOUNT_ROUTES.photo}`);
    expect(put.headers['Content-Type']).toBeUndefined();
    expectBearerOnly(put.headers);
    const form = put.init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.getAll('photo')).toHaveLength(1);
    expect(form.has('file')).toBe(false);
    const part = form.get('photo') as File;
    expect(part.name).toBe('photo.jpg');
    expect(part.size).toBe(3);
    expect(del.init.method).toBe('DELETE');
    expect(del.url).toBe(`${BASE}${ACCOUNT_ROUTES.photo}`);
  });

  it('imageSource gives the absolute URI and the Authorization header for <Image>', async () => {
    const { c } = client([]);
    expect(await c.imageSource('/api/v1/users/u/photo')).toEqual({
      uri: 'https://api.example.in/api/v1/users/u/photo',
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect((await c.imageSource('https://cdn.example.in/x.jpg')).uri).toBe(
      'https://cdn.example.in/x.jpg',
    );
  });

  it('updateProfile sends name and phone only, as PUT', async () => {
    const { c, captured } = client([
      ok({ name: 'P', email: 'e', profileRequested: false, pairingState: 'NOT_PAIRED' }),
    ]);
    await c.updateProfile({ name: 'Priya S', phone: '9876543210', extra: 'dropped' } as never);
    expect(captured[0].init.method).toBe('PUT');
    expect(captured[0].url).toBe(`${BASE}${ACCOUNT_ROUTES.profile}`);
    expect(captured[0].init.body).toBe('{"name":"Priya S","phone":"9876543210"}');
  });

  it('updateAccountProfile PUTs /users/me/profile with the Bearer token, no envelope header, and {phone} or {phone, name} only (R1.11, DD20)', async () => {
    const answer = {
      userId: '66f1a2b3c4d5e6f708192a3b',
      role: 'WORKER',
      shopId: null,
      email: 'priya@example.in',
      name: 'Priya Sharma',
      phone: '9123456780',
      active: true,
      shops: [],
    };
    const { c, captured } = client([ok(answer), ok({ ...answer, name: 'Priya S' })]);

    const first = await c.updateAccountProfile({ phone: '+91 91234 56780' });
    expect(first).toMatchObject({
      userId: answer.userId,
      phone: '9123456780',
      name: 'Priya Sharma',
    });
    expect(captured[0].init.method).toBe('PUT');
    expect(captured[0].url).toBe(`${BASE}${ACCOUNT_ROUTES.accountProfile}`);
    expect(captured[0].url).toBe(`${BASE}/users/me/profile`);
    expectBearerOnly(captured[0].headers);
    // The phone alone: no `name` key at all, not even `null` (absent = unchanged on the server).
    expect(captured[0].init.body).toBe('{"phone":"+91 91234 56780"}');
    expect(JSON.parse(String(captured[0].init.body))).not.toHaveProperty('name');

    await c.updateAccountProfile({
      phone: '9123456780',
      name: 'Priya S',
      extra: 'dropped',
    } as never);
    expect(captured[1].init.body).toBe('{"phone":"9123456780","name":"Priya S"}');
    // The existing worker-profile edit is untouched: a different path.
    expect(ACCOUNT_ROUTES.profile).toBe('/hr/worker/profile');
  });

  it('updateAccountProfile without a session throws NoSession and sends nothing', async () => {
    const { c, captured } = client([], null);
    await expect(c.updateAccountProfile({ phone: '9123456780' })).rejects.toBeInstanceOf(NoSession);
    expect(captured).toHaveLength(0);
  });

  it('history refuses a date that is not yyyy-MM-dd before sending', async () => {
    const { c, captured } = client([]);
    await expect(c.history('2025-4-3', '2025-04-03')).rejects.toThrow(/from must be yyyy-MM-dd/);
    expect(captured).toHaveLength(0);
  });
});

describe('inferAccountErrorCode', () => {
  it('maps the design table 8035–8047 (8042, 8043 and 8046 unused) word for word, at the HTTP status each code is sent with', () => {
    // Text, number and status straight from the design's API table; a text match wins over the
    // status fallback (so the 403s here are not ACCESS_DENIED and the 429 is not generic).
    const table: Array<[WorkerErrorCode, number, number, string]> = [
      ['HR_WORKER_HAS_SHOP', 8035, 409, 'You are already part of a shop. Leave it first.'],
      ['HR_WORKER_REQUEST_PENDING', 8036, 409, 'You already have a request waiting.'],
      ['HR_WORKER_LOGIN_IN_OTHER_SHOP', 8037, 409, 'This login is already part of another shop.'],
      ['HR_REQUEST_ALREADY_HANDLED', 8038, 409, 'This request was already handled'],
      [
        'HR_PAIRING_WRONG_EMPLOYEE',
        8041,
        403,
        'This code is for a different employee. Ask your manager.',
      ],
      [
        'HR_TWO_CREDENTIALS',
        8044,
        400,
        'A request may carry a login or a phone signature, not both.',
      ],
      ['HR_WORKER_NOT_ACTIVE', 8045, 409, 'You are not part of a shop.'],
      [
        'HR_WORKER_ONLY',
        8047,
        403,
        'This app is for workers. Ask your manager to link your login to your employee record from the Employees page.',
      ],
    ];
    for (const [code, number, status, text] of table) {
      expect(WORKER_ERROR_CODE_NUMBERS[code]).toBe(number);
      expect(WORKER_SERVER_MESSAGES[code]).toBe(text);
      expect(inferAccountErrorCode(status, text)).toBe(code);
    }
    expect(WORKER_ERROR_CODE_NUMBERS.HR_MATCH_LINKED_ELSEWHERE).toBe(8039);
    expect(WORKER_ERROR_CODE_NUMBERS.HR_MATCH_EXITED).toBe(8040);
    // The ten kept codes, and nothing else (attendance-protocol `worker-messages.ts`).
    expect(Object.keys(WORKER_ERROR_CODE_NUMBERS)).toHaveLength(10);
    expect(Object.values(WORKER_ERROR_CODE_NUMBERS).sort()).toEqual([
      8035, 8036, 8037, 8038, 8039, 8040, 8041, 8044, 8045, 8047,
    ]);
    expect(inferAccountErrorCode(429, 'Too many attempts, try again later')).toBe(
      'HR_TOO_MANY_ATTEMPTS',
    );
  });

  it('maps the worker texts 8035–8047 and the worker wording of 8028 by text', () => {
    for (const [code, text] of Object.entries(WORKER_SERVER_MESSAGES)) {
      if (text.includes('%s')) {
        continue;
      }
      expect(inferAccountErrorCode(409, text)).toBe(code);
    }
    expect(inferAccountErrorCode(429, TOO_MANY_ATTEMPTS_WORKER)).toBe('HR_TOO_MANY_ATTEMPTS');
    expect(inferAccountErrorCode(409, 'EMP-014 is already linked to another login')).toBe(
      'HR_MATCH_LINKED_ELSEWHERE',
    );
    expect(inferAccountErrorCode(422, 'EMP-014 has exited. Create a new employee instead.')).toBe(
      'HR_MATCH_EXITED',
    );
  });

  it('maps the device-path texts the Bearer pairing calls reuse, and the auth texts', () => {
    expect(inferAccountErrorCode(422, SERVER_MESSAGES.HR_PAIRING_CODE_EXPIRED)).toBe(
      'HR_PAIRING_CODE_EXPIRED',
    );
    expect(inferAccountErrorCode(429, 'Too many wrong codes. Wait 15 minutes and try again.')).toBe(
      'HR_PAIRING_CODE_LOCKED',
    );
    expect(inferAccountErrorCode(400, 'User with this email already exists')).toBe(
      'USER_ALREADY_EXISTS',
    );
    expect(inferAccountErrorCode(401, 'Account is deactivated')).toBe('ACCOUNT_DISABLED');
  });

  it('maps the 4004 text to OAUTH_ACCOUNT_NOT_FOUND before the status fallback; any other 401 text stays INVALID_CREDENTIALS (R1.10, DD20)', () => {
    expect(inferAccountErrorCode(401, OAUTH_ACCOUNT_NOT_FOUND)).toBe('OAUTH_ACCOUNT_NOT_FOUND');
    expect(
      inferAccountErrorCode(401, 'No account found for this Google account. Please sign up first.'),
    ).toBe('OAUTH_ACCOUNT_NOT_FOUND');
    // Trimmed like every other text; the status does not decide it.
    expect(inferAccountErrorCode(401, `  ${OAUTH_ACCOUNT_NOT_FOUND} `)).toBe(
      'OAUTH_ACCOUNT_NOT_FOUND',
    );
    expect(inferAccountErrorCode(400, OAUTH_ACCOUNT_NOT_FOUND)).toBe('OAUTH_ACCOUNT_NOT_FOUND');
    // A 401 with another sentence is still a wrong-credentials refusal.
    expect(inferAccountErrorCode(401, 'Invalid email or password')).toBe('INVALID_CREDENTIALS');
    expect(inferAccountErrorCode(401, 'Invalid credentials')).toBe('INVALID_CREDENTIALS');
    expect(inferAccountErrorCode(401, 'No account found for this Google account.')).toBe(
      'INVALID_CREDENTIALS',
    );
  });

  it('signInWithGoogle surfaces the 4004 answer as a ServerRefusal with code OAUTH_ACCOUNT_NOT_FOUND and the text intact', async () => {
    const { c } = client([refused(401, OAUTH_ACCOUNT_NOT_FOUND)], null);
    const error = await c.signInWithGoogle('google-id-token').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServerRefusal);
    expect((error as ServerRefusal).code).toBe('OAUTH_ACCOUNT_NOT_FOUND');
    expect((error as ServerRefusal).message).toBe(OAUTH_ACCOUNT_NOT_FOUND);
    expect((error as ServerRefusal).status).toBe(401);
  });

  it('falls back to the status: 403 is ACCESS_DENIED (not "not paired"), 429 too many, else unknown', () => {
    expect(inferAccountErrorCode(403, 'Access denied')).toBe('ACCESS_DENIED');
    expect(inferAccountErrorCode(403, SERVER_MESSAGES.HR_APP_NOT_PAIRED)).toBe('ACCESS_DENIED');
    expect(inferAccountErrorCode(429, 'slow down')).toBe('HR_TOO_MANY_ATTEMPTS');
    expect(inferAccountErrorCode(400, 'The reason must be at most 200 characters')).toBeUndefined();
  });
});

describe('toStoredAccount', () => {
  it('keeps token and profile, drops the refresh token, and refuses an answer without them', () => {
    const stored = toStoredAccount(loginAnswer);
    expect(stored).not.toHaveProperty('refreshToken');
    expect(stored.phone).toBe('9876543210');
    expect(
      toStoredAccount({ ...loginAnswer, user: { ...loginAnswer.user, phone: null } }),
    ).not.toHaveProperty('phone');
    expect(() => toStoredAccount({ ...loginAnswer, accessToken: '' })).toThrow(/no token/);
    expect(() =>
      toStoredAccount({ ...loginAnswer, user: { ...loginAnswer.user, userId: '' } }),
    ).toThrow(/no token or user/);
  });
});
