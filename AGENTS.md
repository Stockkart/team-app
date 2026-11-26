# Stockkart Team app — Agent Rules

## Purpose

- Rules for AI agents and new engineers changing `stockkart-team-app`, the repository of the **Stockkart Team** phone app (Expo / React Native, Android first). Reviewers cite them by section name.
- Every rule names one file that follows it. Where code is inconsistent, the dominant convention is the rule and the exceptions are listed. Do not add to an exception list.
- Before any change, read `README.md` (layout, boundaries, commands, CI) and, for a device-visible change, `TESTING.md` (the manual device matrix). Behaviour comes from the specs `.kiro/specs/HR-module` and `.kiro/specs/worker-app` (requirements R1–R14, decisions D1–D17, design DD1–DD21).
- Cross-repo topics live in the handbook (`engineering-handbook`): `ARCHITECTURE.md`, `API_CONTRACT.md`, `REVIEW_RUBRIC.md`, `RUNBOOK.md`, `decisions/`. The backend is `inventory-api`; the web is `inventory-platform`. This app lived at `inventory-platform/apps/attendance` until worker-app D17; the monorepo keeps that history.
- The product name is "Stockkart Team" (lower-case k, never "StockKart Team"), set in `app.json` `expo.name` and in `src/i18n/strings.en.ts` only (worker-app D15, DD19). No identifier moves with it: `in.stockkart.attendance`, slug `stockkart-attendance`, `source: 'worker-app'`, `WORKER`, endpoints and error codes stay.

## Tech stack and versions

Resolved versions from `pnpm-lock.yaml`; ranges in `package.json`.

| Item                                          | Version                 | Note                                                                                                                                              |
| --------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node                                          | 22                      | `.nvmrc`; `actions/setup-node` reads it in every workflow                                                                                         |
| pnpm                                          | 9.8.0                   | `package.json` `packageManager`, activated through Corepack (`corepack enable && corepack prepare pnpm@9.8.0 --activate`). No other version       |
| Expo SDK / React Native                       | 55 / 0.83.10            | `package.json`; Expo 56+ needs iOS 16.4, the spec floor is iOS 15.1 (`app.json` → `expo-build-properties`). Do not bump past 55 without the owner |
| React / React DOM                             | 19.2.0                  | React DOM is for the jsdom tests only                                                                                                             |
| TypeScript                                    | 5.9                     | `strict` (`tsconfig.app.json`, `tsconfig.spec.json`, `tsconfig.base.json` for the protocol package)                                               |
| Vitest / Vite                                 | 4 / 7                   | `vite.config.mts` (tests only; Vite never builds the app)                                                                                         |
| Testing Library React / jest-dom / fast-check | 16.3.0 / 6.6.3 / 3.23.2 | `test-support/render.tsx`                                                                                                                         |
| ESLint (flat) / Prettier                      | 9 / 2.8                 | `eslint.config.mjs`, `.prettierrc` (single quotes, semicolons, width 100, trailing commas)                                                        |
| Android                                       | `minSdkVersion 28`      | `app.json` (`expo-build-properties`); JDK 17 for Gradle (`android.yml`)                                                                           |
| EAS CLI                                       | >= 16                   | `eas.json`; builds that ship come from EAS, never from CI                                                                                         |

## Repository layout and boundaries

```text
package.json                 stockkart-team (private): the Expo app is the repository root
pnpm-workspace.yaml          packages/*
packages/attendance-protocol the app's copy of the protocol package, @stockkart/attendance-protocol (pure TS; parity-checked, see Protocol parity)
src/                         the app (see README.md → Layout for the per-folder map)
modules/biometric-signer/    local Expo Module: Kotlin (android/) and Swift (ios/) behind one TS contract
plugins/withDebugUserCaTrust.js  debug builds trust user-installed CAs (emulator against a local proxy); release builds do not
assets/                      icons, splash, the Plus Jakarta Sans TTFs
test-support/                react-native DOM shim, fake navigation, render helpers, the screen catalogue
scripts/                     check-strings.mjs, protocol-parity.mjs (+ its node:test file)
.github/workflows/           ci.yml, android.yml, ios.yml
android/, ios/               generated by `expo prebuild`; gitignored, never edited by hand
```

- The only workspace dependency is `@stockkart/attendance-protocol` (`workspace:*`). `eslint.config.mjs` bans every `@inventory-platform/*` import by `no-restricted-imports`: `ui-kit` (DOM + CSS modules), `api-client` (axios + `localStorage`) and `shell` (react-router) cannot load on React Native, and since D17 nothing from the web monorepo is installed here. Example: `src/api/transport.ts` imports the protocol and the local `src/api/apiResponse.ts`.
- `src/api/apiResponse.ts` is the one type copied from the web's `platform/contracts` (`ApiResponse<T>`, the inventory-api envelope). Change it only with the backend envelope, and change the web copy in the same step (DD21).
- `packages/attendance-protocol` imports nothing from `src/`. The app imports it only through the package name (never `packages/attendance-protocol/src/...`). Example: `src/punch/PunchFlow.ts`.
- Pure modules and their Expo adapters are separate files: `src/location/LocationReader.ts` (pure) and `src/location/expoLocation.ts` (adapter); `src/queue/PunchQueue.ts` and `src/queue/expoDb.ts`; `src/app/deps.ts` is the one composition root that binds them. Tests run the pure modules with fakes (`src/queue/memoryDb.ts`), never a mocked Expo API where a fake exists.
- No `type: module` in `package.json`: Metro, Babel and Expo CLI read `metro.config.js`, `babel.config.js` and `app.config.js` as CommonJS. The scripts under `scripts/` are `.mjs`.
- Native code changes (`modules/biometric-signer`, a new `expo-*` package with native code, `app.json` plugins) need a prebuild (`pnpm prebuild:android`) and a new build before the next device run; Expo Go cannot run the app.

## Two HTTP clients, never one

- `src/api/appClient.ts` (device client: `/hr/attendance-app/**`, signed request envelope `SKAT-REQ-1`, `X-Device-Id` / `X-Signature` headers, pairing-bound) and `src/api/accountClient.ts` (account client: Bearer token from `src/state/authStore.ts`, `/hr/worker/**`, `/users/me/**`, auth endpoints) share `src/api/transport.ts` (10 s timeout, refusal vs not-reachable, `X-Server-Time`) and nothing else. A Bearer header never goes on a device call and a device signature never goes on an account call (HR-module R9.7, worker-app DD16). Example: `src/api/transport.ts` header docblock.
- `fetch` is injected into both; tests pass a fake, the phone passes `globalThis.fetch`. No axios, no other HTTP library.
- Every refusal text the app shows comes from the protocol's `SERVER_MESSAGES` / `WORKER_MESSAGES` (`refusalText`), mirrored from the backend `ErrorCode` table. A new backend code lands in the protocol (both copies) before the app matches it.

## Text and colour: one file each

- Every text a worker sees is an id in `src/i18n/strings.en.ts`, read with `t(id, params)` from `src/i18n` (R12.11, R12.12). `react/jsx-no-literals` and the `TEXT_PROP_LITERAL` selector in `eslint.config.mjs` fail the lint on a string literal in JSX children or in a text-bearing prop (`label`, `accessibilityLabel`, `placeholder`, `title`, …). `node scripts/check-strings.mjs` (`pnpm check:strings`) fails on an id that is declared but never used, or used but not declared. Example: `src/account/SignInScreen.tsx`.
  - Texts quoted from the server (refusals) come from the protocol package, not from `strings.en.ts`.
  - Tests and `test-support/**` may hold literals: they assert on texts by value.
- Every colour, radius, shadow and spacing value is a token in `src/theme/tokens.ts`, one set per theme (light, dark), read through `useTheme()` (R12.1; the violet & peach palette of worker-app D14). `no-restricted-syntax` in `eslint.config.mjs` fails the lint on a hex or `rgb(`/`rgba(` literal anywhere else under `src/`. `src/theme/contrast.test.ts` checks every drawn pair against WCAG (R12.4) with no exceptions; `src/theme/tokens.test.ts` checks both themes have the same keys. Example: `src/components/PrimaryButton.tsx`.
- `expo-haptics` is imported by `src/theme/haptics.ts` only (R12.8); `expo-linear-gradient` by `src/components/GradientHeader.tsx` only (R12.16); `adjustsFontSizeToFit` appears in `src/components/PunchButton.tsx` only (R7.10, R12.2); `@react-native-async-storage/*` nowhere (R9.2: account data is in `expo-secure-store`, device data in `pairingStore` and the SQLite queue). All four are lint rules in `eslint.config.mjs`.
- Components are named function declarations with an `interface <Name>Props` above them; no `React.FC`, no `const X = () =>` for components. Example: `src/components/Chip.tsx`.
- No `numberOfLines` on a text the worker reads; labels wrap or grow (R12.11). `src/i18n/pseudo.test.tsx` renders every screen from `test-support/screen-catalogue.tsx` under the pseudo-locale and fails on it. A new screen is added to the catalogue in the same change.

## `EXPO_PUBLIC_*` handling

- The app reads `EXPO_PUBLIC_API_URL` (must start with `https://`, R9.7), `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (must be set, DD8) and the optional `EXPO_PUBLIC_WEB_URL` in `src/config.ts` only; Metro inlines them at build time. `app.config.js` refuses to build when the first two are wrong, so `expo start`, `expo prebuild` and `eas build` fail early with the same texts (`src/config.test.ts` covers both gates).
- Declared in `.env-example`; set locally in `.env` at the repository root (gitignored) and, for builds, in the EAS environments `preview` and `production` named in `eas.json`. CI uses placeholders (`https://ci.invalid/api/v1`, `ci-placeholder.apps.googleusercontent.com`) because nothing CI builds is installed anywhere.
- `EXPO_PUBLIC_*` values are public in the bundle. Never put a secret in one. A Google client id is public by design; the secret stays with Google.
- `EXPO_PUBLIC_PSEUDO_LOCALE=1` turns on the pseudo-locale for layout checks (`src/i18n/pseudo.ts`); never in an EAS environment.

## Testing

- `pnpm test` runs `vitest run` on `vite.config.mts`: three projects. `node` for pure logic under `src/**`; `jsdom` for the rendered folders (`src/screens`, `src/components`, `src/navigation`, `src/account`, `src/join`, `src/home`, `src/modules`, `src/profile`) with `react-native` aliased to `test-support/react-native-dom.tsx` and `expo-linear-gradient` to `test-support/expo-linear-gradient.tsx`; and `packages/attendance-protocol/vite.config.mts` (node) for the protocol's fixture and property tests. Example: `src/components/PunchButton.test.tsx` (jsdom), `src/queue/PunchQueue.test.ts` (node).
- Put `<name>.test.ts(x)` next to the source file; property tests are `<name>.property.test.ts(x)` with fast-check and a `**Validates: Requirements …**` line in the docblock. Example: `src/app/AppStateMachine.property.test.ts`.
- Import `describe/it/expect/vi` from `vitest` explicitly (no globals). Render with `render` from `test-support/render.tsx`; query by role or label (`getByRole`, `getByLabelText`), never by test id. Navigator tests replace `@react-navigation/*` with `test-support/fake-navigation.tsx`.
- Modules that touch Expo APIs are mocked only where no fake exists (`vi.mock('expo-secure-store')`, `vi.mock('expo-camera')`); the queue, sync worker and state machine run against the in-memory database and fakes.
- `src/contract/liveBackend.contract.test.ts` runs only with `ATTENDANCE_CONTRACT_URL` set (recipe in `README.md` → Live contract test); `pnpm test` skips it.
- `TESTING.md` is the manual device matrix for release sign-off: six devices, numbered steps, every expected text quoted from the code. A device-visible change updates the step that shows it in the same PR.

## Protocol parity (DD21)

- `packages/attendance-protocol/src/**` and `fixtures/**` are byte-identical to `inventory-platform/platform/attendance-protocol`. `pnpm check:protocol` (`scripts/protocol-parity.mjs`) proves it against `INVENTORY_PLATFORM_DIR` (default `../inventory-platform`); exit 1 names every missing or differing file; without the other repository it prints `skip: inventory-platform not found at <dir>` and passes.
- Order for a protocol change: backend first (`inventory-api`, which also regenerates the fixtures), then the web copy (`inventory-platform`, its fixture tests green, merged to `main`), then this repository (the same bytes in `packages/attendance-protocol`, its tests green, `pnpm check:protocol` green, then the app change that uses it). Never edit the app copy alone; never make the web monorepo depend on this repository.
- Comments inside the protocol sources that still say `apps/attendance` are part of the shared bytes: fix them platform-first, not here.
- `package.json`, `vite.config.mts`, `eslint.config.mjs` and `README.md` of the package are this repository's own (package name `@stockkart/attendance-protocol`) and are not compared.

## Commands

```sh
corepack enable && corepack prepare pnpm@9.8.0 --activate
pnpm install --frozen-lockfile
pnpm lint             # eslint .
pnpm typecheck        # tsc --build tsconfig.json (app, tests, protocol package)
pnpm test             # vitest run (app node + jsdom, protocol)
pnpm check:strings    # strings.en.ts <-> t('...') cross-check
pnpm check:protocol   # parity with ../inventory-platform (or $INVENTORY_PLATFORM_DIR)
node --test scripts/protocol-parity.test.mjs
pnpm format:check     # prettier
pnpm prebuild:android && (cd android && ./gradlew assembleDebug)   # JDK 17 + Android SDK
pnpm prebuild:ios     # then pod install --project-directory=ios and xcodebuild (macOS)
cp .env-example .env && pnpm start
```

- A Debian/Node 22 container with the repository mounted runs every check above without the Android SDK; the Android build runs in `reactnativecommunity/react-native-android` (recipe in the worker-app spec, task 23.1).

## CI

- `.github/workflows/ci.yml` (ubuntu): Node from `.nvmrc`, Corepack pnpm 9.8.0, `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm check:strings`, then protocol parity (checks `Stockkart/inventory-platform` out with the `INVENTORY_PLATFORM_TOKEN` secret when set; otherwise the script's skip line), then the parity script's own tests.
- `.github/workflows/android.yml` (ubuntu, JDK 17, Android SDK): `pnpm prebuild:android` and `./gradlew assembleDebug`; the debug APK is a 7-day artifact. `.github/workflows/ios.yml` (`macos-latest`): `pnpm prebuild:ios`, `pod install`, simulator `xcodebuild` without signing. Both are compile checks; nothing is released from CI.
- Releases go through EAS (`pnpm eas:preview` → Play internal testing track; `pnpm eas:production` → Play draft). iOS has build profiles only.
- The Xcode workspace and scheme are `expo.name` without non-word characters (`Stockkart Team` → `StockkartTeam`); renaming the app means updating `ios.yml`.

## Do and Don't

- Do read `README.md` first and `TESTING.md` for anything a worker sees (Purpose).
- Don't import `@inventory-platform/*`; the protocol is `@stockkart/attendance-protocol` (Repository layout and boundaries).
- Don't put a Bearer header on a device call or a device signature on an account call (Two HTTP clients).
- Do add every text to `strings.en.ts` and every colour to `tokens.ts`; the lint and `check:strings` fail otherwise (Text and colour).
- Don't import `expo-haptics`, `expo-linear-gradient` or use `adjustsFontSizeToFit` outside their one file each (Text and colour).
- Don't use AsyncStorage; account data is `authStore` (secure store), device data is `pairingStore` and SQLite (Text and colour).
- Don't put a secret in an `EXPO_PUBLIC_*` variable (`EXPO_PUBLIC_*` handling).
- Do add a new screen to `test-support/screen-catalogue.tsx` (Testing).
- Don't edit `packages/attendance-protocol/src` or `fixtures` alone; platform first, then here, parity green (Protocol parity).
- Don't commit `android/`, `ios/`, `.env` or signing material (`.gitignore`).
- Do run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm check:strings`, `pnpm check:protocol` before opening a PR (Commands).
