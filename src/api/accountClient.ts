/**
 * The Stockkart Team HTTP client for everything the app does with its **login** (worker-app
 * design DD3, DD16; R1.6, R9.1, R9.2): `/api/v1/auth/*`, `/api/v1/hr/worker/**` and
 * `/api/v1/users/me/*`. It is the Bearer half of the app's two clients; `AppClient` is the
 * device-envelope half. The two share `./transport.ts` and never mix credentials:
 *
 * - every call here that needs a session carries `Authorization: Bearer <token>` and nothing
 *   else that identifies the phone: no `X-Pairing-Id`, `X-Request-Timestamp`, `X-Request-Nonce`
 *   or `X-Request-Signature`, ever (R9.1, Property 21);
 * - the sign-in and sign-up calls carry no credential at all;
 * - the token is read from the injected {@link TokenSource} (the app passes `AuthStore`, which
 *   keeps it in `expo-secure-store`, R9.2) at the moment of each call and is never kept here.
 *
 * Answers follow the transport's rules: `NotReachable` for no answer, `ServerRefusal` for a 4xx
 * with the envelope, and `NotAuthenticated` for a 401, which the state machine turns into "sign
 * in again, keep everything else" (R9.3) in one place. Two exceptions are this client's own:
 *
 * - a 401 from `POST /auth/login` or `/auth/signup` is a **refusal** (wrong password, unknown
 *   Google account, deactivated account), not a session end: it is rethrown as a `ServerRefusal`
 *   with code `INVALID_CREDENTIALS`, `OAUTH_ACCOUNT_NOT_FOUND` (Google verified, no Stockkart
 *   account: the Sign in screen opens the phone step, R1.10) or `ACCOUNT_DISABLED`;
 * - a session call made while no token is stored throws {@link NoSession} and sends nothing.
 *
 * Refusal codes are inferred by {@link inferAccountErrorCode}: the worker-path texts
 * (`WORKER_SERVER_MESSAGES`, 8035–8047), the 4004 text (`OAUTH_ACCOUNT_NOT_FOUND`), the device-path
 * texts the Bearer pairing calls reuse (`SERVER_MESSAGES`), then status: on these paths a 403 is
 * `ACCESS_DENIED`, never "not paired".
 *
 * Nothing retries. A `POST` that may have created something (join request, leave, sign-up) is sent once; after a failure the caller reads `GET /hr/worker/me` again, and the
 * server's one-pending rule makes a repeated create harmless (`HR_WORKER_REQUEST_PENDING`).
 *
 * Pure: no Expo or React Native import. `fetch` and the `FormData` constructor are injected so
 * tests and the phone can differ; see `src/app/deps.ts` for the wiring.
 */
import {
  OAUTH_ACCOUNT_NOT_FOUND,
  SERVER_MESSAGES,
  WORKER_SERVER_MESSAGES,
  TOO_MANY_ATTEMPTS_WORKER,
} from '@stockkart/attendance-protocol';
import type {
  AbandonPairingRequest,
  AbandonPairingResponse,
  AppErrorCode,
  ClaimPairingRequest,
  ClaimPairingResponse,
  CompletePairingRequest,
  CreateJoinRequestRequest,
  JoinRequestSelfResponse,
  MarkNotificationReadResponse,
  PairingBootstrap,
  PunchResponse,
  ShopLookupResponse,
  UpdateWorkerProfileRequest,
  WorkerAccountRole,
  WorkerErrorCode,
  WorkerNotificationsResponse,
  WorkerProfileResponse,
  WorkerStateResponse,
} from '@stockkart/attendance-protocol';

import type { AccountProfile, StoredAccount } from '../state/authStore';
import {
  DEFAULT_TIMEOUT_MS,
  NotAuthenticated,
  ServerRefusal,
  createTransport,
  parseHttpsBase,
  type FetchLike,
  type HttpMethod,
  type RefusalCode,
  type Transport,
  type TransportBody,
} from './transport';

// --- wire shapes of the existing auth endpoints (`core/user` `LoginResponse`, `SignupResponse`) ---

/** `source` on `POST /auth/login|signup` (`AuthSource.WORKER_APP`): the metric tag and e-mail variable (R1.8). */
export const AUTH_SOURCE = 'worker-app';

/** `LoginResponse.UserSummary` / `SignupResponse.UserSummary` as the server sends them. */
export interface AuthUserSummary {
  userId: string;
  role: WorkerAccountRole | string;
  shopId?: string | null;
  email: string;
  name: string;
  phone?: string | null;
  active?: boolean | null;
  createdAt?: string | null;
}

/** `POST /auth/login` and `POST /auth/signup` data. `refreshToken` is issued but unused (design DD7). */
export interface AuthResponse {
  accessToken: string;
  refreshToken?: string | null;
  user: AuthUserSummary;
  /** Login only, and only when the account has an active shop. */
  shop?: { name?: string | null } | null;
}

/** `POST /auth/logout` data (`LogoutResponse`). */
export interface LogoutResponse {
  message?: string | null;
  success: boolean;
  deviceId?: string | null;
}

/** `PUT /users/me/photo` data (`WorkerAccountController.putPhoto`). */
export interface PhotoUploadResponse {
  /** `/api/v1/users/{userId}/photo`; never a public URL (R11.5). */
  photoUrl: string;
  contentType: string;
  bytes: number;
  updatedAt: string;
}

/** `DELETE /users/me/photo` data. */
export interface PhotoDeleteResponse {
  deleted: boolean;
}

/**
 * `PUT /users/me/profile` data (`core/user` `UserResponse`), narrowed to what the app reads. The
 * server's `shops` list and anything added later are not typed here and not stored.
 */
export interface UserResponse {
  userId: string;
  role: WorkerAccountRole | string;
  shopId?: string | null;
  email: string;
  name: string;
  /** 10 digits after the server's normalisation. */
  phone?: string | null;
  active?: boolean | null;
  createdAt?: string | null;
}

// --- what the app passes in ---

export interface SignInWithPassword {
  email: string;
  password: string;
}

/** Create account, password path (R1.2): exactly these fields, nothing else is sent. */
export interface CreateAccountRequest {
  name: string;
  email: string;
  password: string;
  /** As typed; the server normalises `+91` and spaces (R1.2). */
  phone: string;
}

/** Create account with Google (R1.4): the ID token plus the phone collected on the extra screen. */
export interface CreateAccountWithGoogleRequest {
  idToken: string;
  phone: string;
}

/**
 * The phone step in `update` mode (R1.11, DD20): the phone alone, on the account only. `name` is
 * sent only when given; absent means "unchanged" on the server (task 22.1).
 */
export interface UpdateAccountProfileRequest {
  /** As typed or already normalised; the server normalises `+91` and spaces (R1.12). */
  phone: string;
  name?: string;
}

/**
 * The photo to upload (R1.7): already square, ≤ 512 × 512 and ≤ 300 KB (`account/photo.ts`). On
 * the phone a file URI (React Native's `FormData` reads it); in tests a `Blob`.
 */
export type PhotoUpload =
  | { uri: string; contentType: 'image/jpeg' | 'image/png'; fileName?: string }
  | { blob: Blob; contentType: 'image/jpeg' | 'image/png'; fileName?: string };

/** The part of `AuthStore` this client reads: the current token, or null when signed out. */
export interface TokenSource {
  accessToken(): Promise<string | null>;
}

export interface AccountClientDeps {
  /** `https://host[/base-path]`, e.g. `https://api.example.in/api/v1`. Anything else throws. */
  baseUrl: string;
  /** Where the Bearer token comes from at the moment of each call (`AuthStore`). */
  tokens: TokenSource;
  fetch?: FetchLike;
  /** `FormData` constructor for the photo upload; defaults to the runtime's. */
  formData?: () => FormData;
  /** R6.1: "no answer" after this many milliseconds. */
  timeoutMs?: number;
}

/** Routes under the base URL; the full request path is `basePath + route`. */
export const ACCOUNT_ROUTES = {
  login: '/auth/login',
  signup: '/auth/signup',
  logout: '/auth/logout',
  me: '/hr/worker/me',
  shops: '/hr/worker/shops',
  joinRequests: '/hr/worker/join-requests',
  withdraw: (id: string) => `/hr/worker/join-requests/${encodeURIComponent(id)}/withdraw`,
  claim: '/hr/worker/pairings/claim',
  complete: '/hr/worker/pairings/complete',
  abandon: '/hr/worker/pairings/abandon',
  punches: '/hr/worker/punches',
  profile: '/hr/worker/profile',
  leave: '/hr/worker/leave',
  notifications: '/hr/worker/notifications',
  markRead: (id: string) => `/hr/worker/notifications/${encodeURIComponent(id)}/read`,
  photo: '/users/me/photo',
  accountProfile: '/users/me/profile',
} as const;

/** The envelope header names, listed here so a test can assert none of them is ever sent. */
export const ENVELOPE_HEADERS: readonly string[] = [
  'X-Pairing-Id',
  'X-Request-Timestamp',
  'X-Request-Nonce',
  'X-Request-Signature',
];

// --- outcomes ---

/** A session call was attempted while no token is stored. Nothing was sent. */
export class NoSession extends Error {
  readonly kind = 'no_session' as const;

  constructor() {
    super('not signed in');
    this.name = 'NoSession';
  }
}

// --- client ---

export class AccountClient {
  private readonly origin: string;
  private readonly basePath: string;
  private readonly transport: Transport;
  private readonly tokens: TokenSource;
  private readonly formData: () => FormData;
  private readonly timeoutMs: number;

  constructor(deps: AccountClientDeps) {
    const base = parseHttpsBase(deps.baseUrl);
    this.origin = base.origin;
    this.basePath = base.basePath;
    this.transport = createTransport({
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
      inferCode: inferAccountErrorCode,
    });
    this.tokens = deps.tokens;
    this.formData = deps.formData ?? defaultFormData;
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  // ---- sign-in and sign-up (no credential on the request; R1.6, R1.4, R1.5) ----

  /** Email and password, the web's endpoint and rules (R1.6). A wrong password is a refusal. */
  signIn(request: SignInWithPassword): Promise<StoredAccount> {
    return this.auth(ACCOUNT_ROUTES.login, {
      email: request.email,
      password: request.password,
      source: AUTH_SOURCE,
    });
  }

  /** Google ID token (from `account/googleSignIn.ts`), the web's `loginType: google` path. */
  signInWithGoogle(idToken: string): Promise<StoredAccount> {
    return this.auth(ACCOUNT_ROUTES.login, {
      idToken,
      loginType: 'google',
      source: AUTH_SOURCE,
    });
  }

  /** Create account with a password: role `WORKER`, source `worker-app`, exactly R1.2's fields. */
  createAccount(request: CreateAccountRequest): Promise<StoredAccount> {
    return this.auth(ACCOUNT_ROUTES.signup, {
      name: request.name,
      email: request.email,
      password: request.password,
      phone: request.phone,
      role: 'WORKER',
      source: AUTH_SOURCE,
    });
  }

  /** Create account with Google plus the phone from the extra screen (R1.4); never without a phone. */
  createAccountWithGoogle(request: CreateAccountWithGoogleRequest): Promise<StoredAccount> {
    return this.auth(ACCOUNT_ROUTES.signup, {
      idToken: request.idToken,
      signupType: 'google',
      phone: request.phone,
      role: 'WORKER',
      source: AUTH_SOURCE,
    });
  }

  /** Tells the server to end this session (R9.5). The store is cleared by the caller either way. */
  logout(): Promise<LogoutResponse> {
    return this.session<LogoutResponse>('POST', ACCOUNT_ROUTES.logout);
  }

  // ---- state and join flow (`/hr/worker/**`) ----

  /** `GET /hr/worker/me`: the one answer the app chooses its screen from (R6.1). */
  workerState(): Promise<WorkerStateResponse> {
    return this.session<WorkerStateResponse>('GET', ACCOUNT_ROUTES.me);
  }

  /** The shops an owner's e-mail owns; an empty list for every miss (R3.2–R3.3). 10 per hour. */
  lookupShops(ownerEmail: string): Promise<ShopLookupResponse> {
    const query = `ownerEmail=${encodeURIComponent(ownerEmail.trim())}`;
    return this.session<ShopLookupResponse>('GET', ACCOUNT_ROUTES.shops, { query });
  }

  /** Asks to join one shop (R3.4). Sent once; `HR_WORKER_REQUEST_PENDING` means "already waiting". */
  createJoinRequest(shopId: string): Promise<JoinRequestSelfResponse> {
    const body: CreateJoinRequestRequest = { shopId };
    return this.session<JoinRequestSelfResponse>('POST', ACCOUNT_ROUTES.joinRequests, { body });
  }

  /** Withdraws the caller's own pending request (R3.6). */
  withdraw(requestId: string): Promise<JoinRequestSelfResponse> {
    return this.session<JoinRequestSelfResponse>('POST', ACCOUNT_ROUTES.withdraw(requestId));
  }

  // ---- pairing with a login (`/hr/worker/pairings/*`, R7.2–R7.4) ----

  claim(request: ClaimPairingRequest): Promise<ClaimPairingResponse> {
    return this.session<ClaimPairingResponse>('POST', ACCOUNT_ROUTES.claim, { body: request });
  }

  complete(request: CompletePairingRequest): Promise<PairingBootstrap> {
    return this.session<PairingBootstrap>('POST', ACCOUNT_ROUTES.complete, { body: request });
  }

  abandon(request: AbandonPairingRequest): Promise<AbandonPairingResponse> {
    return this.session<AbandonPairingResponse>('POST', ACCOUNT_ROUTES.abandon, { body: request });
  }

  // ---- history, profile, leave (`/hr/worker/**`) ----

  /** The caller's own punches with a day in `[from, to]`, both `yyyy-MM-dd`, ≤ 31 days (R7.9). */
  async history(from: string, to: string): Promise<PunchResponse[]> {
    requireDate(from, 'from');
    requireDate(to, 'to');
    const query = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    return this.session<PunchResponse[]>('GET', ACCOUNT_ROUTES.punches, { query });
  }

  /** The Profile screen's data (R8.1). */
  profile(): Promise<WorkerProfileResponse> {
    return this.session<WorkerProfileResponse>('GET', ACCOUNT_ROUTES.profile);
  }

  /** Edit details: name and phone on the account and the linked employee (R8.2). */
  updateProfile(request: UpdateWorkerProfileRequest): Promise<WorkerProfileResponse> {
    const body: UpdateWorkerProfileRequest = { name: request.name, phone: request.phone };
    return this.session<WorkerProfileResponse>('PUT', ACCOUNT_ROUTES.profile, { body });
  }

  /**
   * The phone step in `update` mode (R1.11, DD20): `PUT /users/me/profile` with the phone alone,
   * so it works for every role and every shop state and touches the account only (`PUT
   * /hr/worker/profile` would answer `HR_WORKER_ONLY` for a staff account and write the employee's
   * phone too). `name` goes in the body only when given.
   */
  updateAccountProfile(request: UpdateAccountProfileRequest): Promise<UserResponse> {
    const body: UpdateAccountProfileRequest = { phone: request.phone };
    if (typeof request.name === 'string') {
      body.name = request.name;
    }
    return this.session<UserResponse>('PUT', ACCOUNT_ROUTES.accountProfile, { body });
  }

  /** `PUT /users/me/photo`, multipart with the one part `photo` (R1.7). */
  uploadPhoto(photo: PhotoUpload): Promise<PhotoUploadResponse> {
    const form = this.formData();
    const fileName =
      photo.fileName ?? (photo.contentType === 'image/png' ? 'photo.png' : 'photo.jpg');
    if ('blob' in photo) {
      form.append('photo', photo.blob, fileName);
    } else {
      // React Native's FormData takes a file descriptor and streams the file; the DOM typing does
      // not know this shape.
      form.append('photo', {
        uri: photo.uri,
        name: fileName,
        type: photo.contentType,
      } as unknown as Blob);
    }
    return this.session<PhotoUploadResponse>('PUT', ACCOUNT_ROUTES.photo, { form });
  }

  deletePhoto(): Promise<PhotoDeleteResponse> {
    return this.session<PhotoDeleteResponse>('DELETE', ACCOUNT_ROUTES.photo);
  }

  /** Leave this shop (R5.3): the caller's own employee is exited today. Needs the server. */
  leaveShop(): Promise<WorkerStateResponse> {
    return this.session<WorkerStateResponse>('POST', ACCOUNT_ROUTES.leave);
  }

  // ---- notifications (R10.1) ----

  notifications(): Promise<WorkerNotificationsResponse> {
    return this.session<WorkerNotificationsResponse>('GET', ACCOUNT_ROUTES.notifications);
  }

  markRead(notificationId: string): Promise<MarkNotificationReadResponse> {
    return this.session<MarkNotificationReadResponse>(
      'POST',
      ACCOUNT_ROUTES.markRead(notificationId),
    );
  }

  // ---- photos the app draws ----

  /**
   * How to load a photo URL the server gave (`/api/v1/users/{id}/photo`, R11.5): the absolute URI
   * and the `Authorization` header for `<Image source={{ uri, headers }}>`. Throws {@link NoSession}
   * when signed out, like every session call.
   */
  async imageSource(photoUrl: string): Promise<{ uri: string; headers: Record<string, string> }> {
    const token = await this.requireToken();
    const uri = /^https?:\/\//i.test(photoUrl) ? photoUrl : `${this.origin}${photoUrl}`;
    return { uri, headers: { Authorization: `Bearer ${token}` } };
  }

  // ---- transport ----

  /** Sign-in and sign-up: no credential; a 401 here is a refusal, not a session end. */
  private async auth(route: string, body: Record<string, string>): Promise<StoredAccount> {
    let answer: AuthResponse;
    try {
      answer = await this.send<AuthResponse>('POST', route, '', JSON.stringify(body), {});
    } catch (error) {
      if (error instanceof NotAuthenticated) {
        throw new ServerRefusal(401, error.serverMessage, inferAccountErrorCode);
      }
      throw error;
    }
    return toStoredAccount(answer);
  }

  private async session<T>(
    method: HttpMethod,
    route: string,
    options: { query?: string; body?: unknown; form?: FormData } = {},
  ): Promise<T> {
    const token = await this.requireToken();
    const body: TransportBody | undefined =
      options.form ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
    return this.send<T>(method, route, options.query ?? '', body, {
      Authorization: `Bearer ${token}`,
    });
  }

  private async requireToken(): Promise<string> {
    const token = await this.tokens.accessToken();
    if (token == null || token.length === 0) {
      throw new NoSession();
    }
    return token;
  }

  private send<T>(
    method: HttpMethod,
    route: string,
    query: string,
    body: TransportBody | undefined,
    headers: Record<string, string>,
  ): Promise<T> {
    const url = `${this.origin}${this.basePath}${route}${query ? `?${query}` : ''}`;
    return this.transport.send<T>(method, url, headers, body, this.timeoutMs);
  }
}

// --- helpers ---

/**
 * The sign-in or sign-up answer as `AuthStore.saveAccount` stores it (R9.2): token plus profile.
 * The refresh token is dropped (DD7); `photoUrl` is not in this answer and comes with the first
 * `GET /hr/worker/me`. Throws on an answer without a token or user id (a {@link NotReachable}-grade
 * bad answer, surfaced as an error rather than stored).
 */
export function toStoredAccount(answer: AuthResponse): StoredAccount {
  const user = answer?.user;
  if (
    typeof answer?.accessToken !== 'string' ||
    answer.accessToken.length === 0 ||
    typeof user?.userId !== 'string' ||
    user.userId.length === 0
  ) {
    throw new Error('sign-in answer has no token or user');
  }
  const profile: AccountProfile = {
    userId: user.userId,
    name: typeof user.name === 'string' ? user.name : '',
    email: typeof user.email === 'string' ? user.email : '',
    role: typeof user.role === 'string' && user.role.length > 0 ? user.role : 'WORKER',
  };
  if (typeof user.phone === 'string' && user.phone.length > 0) {
    profile.phone = user.phone;
  }
  return { ...profile, accessToken: answer.accessToken };
}

const LINKED_ELSEWHERE = / is already linked to another login$/;
const MATCH_EXITED = / has exited\. Create a new employee instead\.$/;

/**
 * The `ErrorCode` name behind a Bearer-path refusal, when it can be told. Exact worker-path texts
 * first (8035–8047 and the worker wording of 8028), the 4004 text (`OAUTH_ACCOUNT_NOT_FOUND`: a
 * 401 from `/auth/login` with any other text stays `INVALID_CREDENTIALS`), the two templated inbox
 * texts, the device-path texts the Bearer pairing calls reuse (code expired, used, wrong, locked,
 * employee exited, phone not verified), the auth texts, then status: 401 is `INVALID_CREDENTIALS`
 * (only sign-in and sign-up reach here with one), 403 is `ACCESS_DENIED`, 409 or 400 with the
 * duplicate-e-mail text is `USER_ALREADY_EXISTS`, 429 is `HR_TOO_MANY_ATTEMPTS`. Never "not
 * paired": that is a device-path answer.
 */
export function inferAccountErrorCode(status: number, message: string): RefusalCode | undefined {
  const text = message.trim();
  for (const [code, known] of Object.entries(WORKER_SERVER_MESSAGES) as [
    WorkerErrorCode,
    string,
  ][]) {
    if (known === text) {
      return code;
    }
  }
  if (text === OAUTH_ACCOUNT_NOT_FOUND) {
    return 'OAUTH_ACCOUNT_NOT_FOUND';
  }
  if (text === TOO_MANY_ATTEMPTS_WORKER) {
    return 'HR_TOO_MANY_ATTEMPTS';
  }
  if (LINKED_ELSEWHERE.test(text)) {
    return 'HR_MATCH_LINKED_ELSEWHERE';
  }
  if (MATCH_EXITED.test(text)) {
    return 'HR_MATCH_EXITED';
  }
  for (const [code, known] of Object.entries(SERVER_MESSAGES) as [AppErrorCode, string][]) {
    if (known === text && code !== 'HR_APP_NOT_PAIRED') {
      return code;
    }
  }
  if (text.startsWith('Too many wrong codes.')) {
    return 'HR_PAIRING_CODE_LOCKED';
  }
  if (text === 'Your login is not linked to an employee in this shop') {
    return 'HR_NOT_LINKED';
  }
  if (text.startsWith('User with this email already exists')) {
    return 'USER_ALREADY_EXISTS';
  }
  if (text === 'Account is deactivated') {
    return 'ACCOUNT_DISABLED';
  }
  if (status === 401) {
    return 'INVALID_CREDENTIALS';
  }
  if (status === 403) {
    return 'ACCESS_DENIED';
  }
  if (status === 429) {
    return 'HR_TOO_MANY_ATTEMPTS';
  }
  return undefined;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function requireDate(value: string, field: string): void {
  if (typeof value !== 'string' || !DATE.test(value)) {
    throw new Error(`${field} must be yyyy-MM-dd`);
  }
}

function defaultFormData(): FormData {
  const ctor = (globalThis as { FormData?: new () => FormData }).FormData;
  if (!ctor) {
    throw new Error('FormData is not available on this runtime; pass one in AccountClientDeps');
  }
  return new ctor();
}
