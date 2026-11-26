/**
 * The pairing handshake with a login (worker-app design DD4; R7.2–R7.4). `PairingFlow` is reused
 * unchanged: it takes a {@link PairingClient}, and this one sends the three handshake calls to
 * `/api/v1/hr/worker/pairings/*` with the Bearer token through `AccountClient` instead of to the
 * unsigned device paths through `AppClient`. The server then checks that the code's employee is the
 * signed-in worker's own record (`HR_PAIRING_WRONG_EMPLOYEE` otherwise, the code staying valid for
 * the right worker); the request bodies, the lockout, the consent step and the key creation are the
 * HR-module code as it stands.
 *
 * No envelope header is ever on these calls (there are no keys yet when `claim` runs, and the
 * Bearer path must not carry one, R9.1); `AccountClient` guarantees that by construction.
 */
import type {
  AbandonPairingRequest,
  AbandonPairingResponse,
  ClaimPairingRequest,
  ClaimPairingResponse,
  CompletePairingRequest,
  PairingBootstrap,
} from '@stockkart/attendance-protocol';

import type { AccountClient } from '../api/accountClient';
import type { PairingClient } from './PairingFlow';

/** The three `AccountClient` calls this adapter needs. */
export type WorkerPairingCalls = Pick<AccountClient, 'claim' | 'complete' | 'abandon'>;

export class WorkerPairingClient implements PairingClient {
  private readonly account: WorkerPairingCalls;

  constructor(account: WorkerPairingCalls) {
    this.account = account;
  }

  claim(request: ClaimPairingRequest): Promise<ClaimPairingResponse> {
    return this.account.claim(request);
  }

  complete(request: CompletePairingRequest): Promise<PairingBootstrap> {
    return this.account.complete(request);
  }

  abandon(request: AbandonPairingRequest): Promise<AbandonPairingResponse> {
    return this.account.abandon(request);
  }
}
