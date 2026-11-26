import { describe, expect, it } from 'vitest';

import { WORKER_SERVER_MESSAGES } from '@stockkart/attendance-protocol';
import type { ClaimPairingResponse, ConsentVersion } from '@stockkart/attendance-protocol';

import { ACCOUNT_ROUTES, AccountClient, ENVELOPE_HEADERS } from '../api/accountClient';
import { NotAuthenticated, type FetchLike } from '../api/transport';
import { FakeBiometricSigner } from '../signer/FakeBiometricSigner';
import { PairingFlow, type DeviceInfo } from './PairingFlow';
import { WorkerPairingClient } from './WorkerPairingClient';

const BASE = 'https://api.example.in/api/v1';
const TOKEN = 'tok';
const CODE = 'ABCD2345';

const CONSENT: ConsentVersion = {
  version: 2,
  kind: 'RECONSENT_REQUIRED',
  recorded: ['Your check-in and check-out time'],
  neverRecorded: ['Your fingerprint'],
  visibility: ["The shop's managers can see your attendance"],
};

const CLAIM: ClaimPairingResponse = {
  claimToken: 'claim-token-1',
  shopName: 'Sri Ganesh Stores',
  employeeName: 'Priya Sharma',
  consent: CONSENT,
};

const DEVICE: DeviceInfo = {
  os: 'ANDROID',
  osVersion: '14',
  phoneModel: 'Pixel 7',
  appVersion: '1.0.0',
};

interface Captured {
  url: string;
  init: RequestInit;
  headers: Record<string, string>;
}

function fakeFetch(answers: Response[]) {
  const captured: Captured[] = [];
  const fetch: FetchLike = (url, init) => {
    captured.push({ url, init, headers: { ...(init.headers as Record<string, string>) } });
    const answer = answers.shift();
    if (answer === undefined) {
      throw new Error('fakeFetch: no answer queued');
    }
    return Promise.resolve(answer);
  };
  return { fetch, captured };
}

function envelope(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setup(answers: Response[]) {
  const { fetch, captured } = fakeFetch(answers);
  const account = new AccountClient({
    baseUrl: BASE,
    tokens: { accessToken: async () => TOKEN },
    fetch,
    timeoutMs: 1000,
  });
  const saved: unknown[] = [];
  const flow = new PairingFlow({
    client: new WorkerPairingClient(account),
    signer: new FakeBiometricSigner(),
    store: {
      installationId: async () => 'install-1',
      save: async (pairing) => {
        saved.push(pairing);
      },
    },
    device: DEVICE,
  });
  return { flow, captured, saved };
}

describe('WorkerPairingClient', () => {
  it('runs PairingFlow unchanged over /hr/worker/pairings/* with Authorization and no envelope header (R7.2, R9.1)', async () => {
    const { flow, captured, saved } = setup([
      envelope(200, { success: true, data: CLAIM }),
      envelope(200, {
        success: true,
        data: {
          pairingId: '66f1a2b3c4d5e6f708192a3b',
          shopId: 's',
          employeeId: 'e',
          employeeName: 'Priya Sharma',
          shopName: 'Sri Ganesh Stores',
          location: { locationCheck: false },
          consentVersion: 2,
        },
      }),
    ]);

    const claimed = await flow.submitCode(CODE);
    expect(claimed.kind).toBe('claimed');
    const agreed = await flow.agree(CLAIM.claimToken, CONSENT.version);
    expect(agreed.kind).toBe('paired');
    expect(saved).toHaveLength(1);

    expect(captured.map((r) => r.url)).toEqual([
      `${BASE}${ACCOUNT_ROUTES.claim}`,
      `${BASE}${ACCOUNT_ROUTES.complete}`,
    ]);
    expect(JSON.parse(String(captured[0].init.body))).toMatchObject({
      code: CODE,
      installationId: 'install-1',
      os: 'ANDROID',
    });
    for (const request of captured) {
      expect(request.headers.Authorization).toBe(`Bearer ${TOKEN}`);
      for (const name of ENVELOPE_HEADERS) {
        expect(request.headers[name]).toBeUndefined();
      }
    }
  });

  it("passes the server's worker-path refusal to the flow word for word, with its code (R7.3)", async () => {
    const text = WORKER_SERVER_MESSAGES.HR_PAIRING_WRONG_EMPLOYEE;
    const { flow } = setup([
      envelope(403, { success: false, error: text, data: { message: text, status: 403 } }),
    ]);
    const result = await flow.submitCode(CODE);
    expect(result).toEqual({ kind: 'refused', code: 'HR_PAIRING_WRONG_EMPLOYEE', message: text });
    // Not a counted code refusal: the local lockout stays open for the right code.
    expect(flow.lockoutRemainingMs()).toBe(0);
  });

  it('abandon goes to its worker route', async () => {
    const { flow, captured } = setup([envelope(200, { success: true, data: { abandoned: true } })]);
    expect(await flow.decline('claim-token-1')).toEqual({ abandoned: true });
    expect(captured[0].url).toBe(`${BASE}${ACCOUNT_ROUTES.abandon}`);
    expect(captured[0].init.body).toBe('{"claimToken":"claim-token-1"}');
    expect(captured[0].headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('complete carries the device-path body unchanged: claim token, installation id, both public keys and the consent version', async () => {
    const { flow, captured } = setup([
      envelope(200, { success: true, data: CLAIM }),
      envelope(200, {
        success: true,
        data: {
          pairingId: '66f1a2b3c4d5e6f708192a3b',
          shopId: 's',
          employeeId: 'e',
          employeeName: 'Priya Sharma',
          shopName: 'Sri Ganesh Stores',
          location: { locationCheck: false },
          consentVersion: 2,
        },
      }),
    ]);
    await flow.submitCode(CODE);
    await flow.agree(CLAIM.claimToken, CONSENT.version);

    const claimBody = JSON.parse(String(captured[0].init.body)) as Record<string, unknown>;
    expect(Object.keys(claimBody).sort()).toEqual(
      ['appVersion', 'code', 'installationId', 'os', 'osVersion', 'phoneModel'].sort(),
    );
    expect(claimBody).toMatchObject({
      osVersion: '14',
      phoneModel: 'Pixel 7',
      appVersion: '1.0.0',
    });

    const completeBody = JSON.parse(String(captured[1].init.body)) as Record<string, unknown>;
    expect(Object.keys(completeBody).sort()).toEqual(
      [
        'claimToken',
        'consentVersion',
        'devicePublicKey',
        'installationId',
        'punchPublicKey',
      ].sort(),
    );
    expect(completeBody.claimToken).toBe(CLAIM.claimToken);
    expect(completeBody.installationId).toBe('install-1');
    expect(completeBody.consentVersion).toBe(2);
    expect(typeof completeBody.punchPublicKey).toBe('string');
    expect(typeof completeBody.devicePublicKey).toBe('string');
    expect(completeBody.punchPublicKey).not.toBe(completeBody.devicePublicKey);
    expect(captured[1].init.method).toBe('POST');
    expect(captured[1].headers['Content-Type']).toBe('application/json');
  });

  it('a 401 on the handshake is NotAuthenticated and leaves the flow: nothing saved, no second request (R9.3)', async () => {
    const { flow, captured, saved } = setup([
      envelope(401, {
        success: false,
        error: 'Authentication required',
        data: { message: 'Authentication required', status: 401 },
      }),
    ]);
    const error = await flow.submitCode(CODE).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotAuthenticated);
    expect((error as NotAuthenticated).message).toBe('Authentication required');
    expect(captured).toHaveLength(1);
    expect(saved).toHaveLength(0);
    expect(flow.lockoutRemainingMs()).toBe(0);
  });
});
