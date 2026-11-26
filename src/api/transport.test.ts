import { afterEach, describe, expect, it, vi } from 'vitest';

import { SERVER_MESSAGES } from '@stockkart/attendance-protocol';

import {
  HEADER_SERVER_TIME,
  NotAuthenticated,
  NotReachable,
  ServerRefusal,
  createTransport,
  isNotAuthenticated,
  isNotReachable,
  isServerRefusal,
  readServerTime,
  type FetchLike,
} from './transport';

const URL = 'https://api.example.in/api/v1/hr/worker/me';

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
    if (answer instanceof Error) {
      return Promise.reject(answer);
    }
    return Promise.resolve(answer);
  };
  return { fetch, captured };
}

function envelope(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function refused(status: number, message: string, headers: Record<string, string> = {}): Response {
  return envelope(status, { success: false, error: message, data: { message, status } }, headers);
}

describe('transport.send', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends the given headers plus Accept, and Content-Type only with a body', async () => {
    const { fetch, captured } = fakeFetch([envelope(200, { success: true, data: { a: 1 } })]);
    const t = createTransport({ fetch });
    const result = await t.send<{ a: number }>(
      'POST',
      URL,
      { Authorization: 'Bearer tok' },
      '{"x":1}',
      1000,
    );
    expect(result).toEqual({ a: 1 });
    expect(captured[0].url).toBe(URL);
    expect(captured[0].init.method).toBe('POST');
    expect(captured[0].init.body).toBe('{"x":1}');
    expect(captured[0].headers).toEqual({
      Accept: 'application/json',
      Authorization: 'Bearer tok',
      'Content-Type': 'application/json',
    });

    const { fetch: f2, captured: c2 } = fakeFetch([envelope(200, { success: true, data: null })]);
    await createTransport({ fetch: f2 }).send('GET', URL, {}, undefined, 1000);
    expect(c2[0].headers).toEqual({ Accept: 'application/json' });
    expect(c2[0].init.body).toBeUndefined();
  });

  it('401 with the error envelope is NotAuthenticated carrying the server text (R9.3)', async () => {
    const { fetch } = fakeFetch([refused(401, 'Authentication required')]);
    const error = await createTransport({ fetch })
      .send('GET', URL, { Authorization: 'Bearer old' }, undefined, 1000)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotAuthenticated);
    expect(isNotAuthenticated(error)).toBe(true);
    expect(isServerRefusal(error)).toBe(false);
    expect(isNotReachable(error)).toBe(false);
    const e = error as NotAuthenticated;
    expect(e.kind).toBe('not_authenticated');
    expect(e.status).toBe(401);
    expect(e.message).toBe('Authentication required');
    expect(e.serverMessage).toBe('Authentication required');
  });

  it('a 401 without the envelope is BAD_ANSWER, not NotAuthenticated', async () => {
    const { fetch } = fakeFetch([new Response('<html>login</html>', { status: 401 })]);
    const error = await createTransport({ fetch })
      .send('GET', URL, {}, undefined, 1000)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotReachable);
    expect((error as NotReachable).reason).toBe('BAD_ANSWER');
  });

  it('other 4xx with the envelope stay ServerRefusal, with the injected code inference', async () => {
    const byDefault = await createTransport({
      fetch: fakeFetch([refused(409, SERVER_MESSAGES.HR_APP_OFF)]).fetch,
    })
      .send('GET', URL, {}, undefined, 1000)
      .catch((e: unknown) => e);
    expect(byDefault).toBeInstanceOf(ServerRefusal);
    expect((byDefault as ServerRefusal).code).toBe('HR_APP_OFF');
    expect((byDefault as ServerRefusal).message).toBe(SERVER_MESSAGES.HR_APP_OFF);

    // A Bearer-path client must not read a 403 as "not paired".
    const bearer = await createTransport({
      fetch: fakeFetch([refused(403, 'Access denied')]).fetch,
      inferCode: () => undefined,
    })
      .send('GET', URL, {}, undefined, 1000)
      .catch((e: unknown) => e);
    expect((bearer as ServerRefusal).code).toBeUndefined();
    expect((bearer as ServerRefusal).notPaired).toBe(false);
    expect((bearer as ServerRefusal).message).toBe('Access denied');
  });

  it('classifies timeout, connection error, 5xx and non-envelope answers as NotReachable', async () => {
    vi.useFakeTimers();
    const hang = fakeFetch(['hang']);
    const pending = createTransport({ fetch: hang.fetch })
      .send('GET', URL, {}, undefined, 250)
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(249);
    expect(hang.captured[0].init.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(((await pending) as NotReachable).reason).toBe('TIMEOUT');
    vi.useRealTimers();

    const cause = new TypeError('Network request failed');
    const connection = (await createTransport({ fetch: fakeFetch([cause]).fetch })
      .send('GET', URL, {}, undefined, 1000)
      .catch((e: unknown) => e)) as NotReachable;
    expect(connection.reason).toBe('CONNECTION');
    expect(connection.cause).toBe(cause);

    const server = (await createTransport({
      fetch: fakeFetch([new Response('busy', { status: 503 })]).fetch,
    })
      .send('GET', URL, {}, undefined, 1000)
      .catch((e: unknown) => e)) as NotReachable;
    expect(server.reason).toBe('SERVER_ERROR');
    expect(server.status).toBe(503);

    const falseSuccess = (await createTransport({
      fetch: fakeFetch([envelope(200, { success: false })]).fetch,
    })
      .send('GET', URL, {}, undefined, 1000)
      .catch((e: unknown) => e)) as NotReachable;
    expect(falseSuccess.reason).toBe('BAD_ANSWER');
  });

  it('never retries: one fetch per call whatever the outcome, POST included', async () => {
    vi.useFakeTimers();
    const hang = fakeFetch(['hang']);
    const timedOut = createTransport({ fetch: hang.fetch })
      .send('POST', URL, { Authorization: 'Bearer tok' }, '{"shopId":"s"}', 1000)
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1000);
    expect(((await timedOut) as NotReachable).reason).toBe('TIMEOUT');
    expect(hang.captured).toHaveLength(1);
    vi.useRealTimers();

    const { fetch, captured } = fakeFetch([
      new Response('busy', { status: 503 }),
      refused(409, 'You already have a request waiting.'),
      refused(401, 'Authentication required'),
      new TypeError('Network request failed'),
    ]);
    const t = createTransport({ fetch, inferCode: () => undefined });
    const outcomes: unknown[] = [];
    for (let i = 0; i < 4; i += 1) {
      outcomes.push(await t.send('POST', URL, {}, '{}', 1000).catch((e: unknown) => e));
    }
    expect(outcomes.map((e) => (e as Error).constructor)).toEqual([
      NotReachable,
      ServerRefusal,
      NotAuthenticated,
      NotReachable,
    ]);
    expect((outcomes[1] as ServerRefusal).message).toBe('You already have a request waiting.');
    expect(captured).toHaveLength(4);
    expect(captured.every((r) => r.init.method === 'POST')).toBe(true);
  });

  it('a 401 reads its text in the envelope order data.message, error, message', async () => {
    const { fetch } = fakeFetch([
      envelope(401, { success: false, error: 'Session expired' }),
      envelope(401, { success: false, message: 'Token revoked' }),
      envelope(401, { success: false, error: 'outer', data: { message: 'inner' } }),
    ]);
    const t = createTransport({ fetch });
    const texts: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const error = await t.send('GET', URL, {}, undefined, 1000).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(NotAuthenticated);
      texts.push((error as NotAuthenticated).message);
    }
    expect(texts).toEqual(['Session expired', 'Token revoked', 'inner']);
  });

  it('a FormData body is handed to fetch untouched, with no Content-Type of its own', async () => {
    const { fetch, captured } = fakeFetch([envelope(200, { success: true, data: { ok: 1 } })]);
    const form = new FormData();
    form.append('photo', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), 'p.jpg');
    await createTransport({ fetch }).send('PUT', URL, { Authorization: 'Bearer tok' }, form, 1000);
    expect(captured[0].init.body).toBe(form);
    expect(captured[0].headers).toEqual({
      Accept: 'application/json',
      Authorization: 'Bearer tok',
    });
  });

  it('reports a valid X-Server-Time through onServerTime and ignores a bad one', async () => {
    const seen: number[] = [];
    const t = createTransport({
      fetch: fakeFetch([
        envelope(200, { success: true, data: {} }, { [HEADER_SERVER_TIME]: '1743671820' }),
        refused(422, 'nope', { [HEADER_SERVER_TIME]: '7' }),
        envelope(200, { success: true, data: {} }, { [HEADER_SERVER_TIME]: 'soon' }),
        envelope(200, { success: true, data: {} }),
      ]).fetch,
      onServerTime: (s) => seen.push(s),
    });
    await t.send('GET', URL, {}, undefined, 1000);
    await t.send('GET', URL, {}, undefined, 1000).catch(() => undefined);
    await t.send('GET', URL, {}, undefined, 1000);
    await t.send('GET', URL, {}, undefined, 1000);
    expect(seen).toEqual([1743671820, 7]);
  });

  it('readServerTime parses the header as a safe integer', () => {
    const with_ = new Response('', { headers: { [HEADER_SERVER_TIME]: ' 42 ' } });
    expect(readServerTime(with_)).toBe(42);
    expect(readServerTime(new Response(''))).toBeUndefined();
    expect(
      readServerTime(new Response('', { headers: { [HEADER_SERVER_TIME]: '1.5' } })),
    ).toBeUndefined();
  });
});
