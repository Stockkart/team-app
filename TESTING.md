# Stockkart Team — manual device matrix (release sign-off)

Spec task 16.3 (`.kiro/specs/HR-module`, design "Testing Strategy" → device test matrix) and spec task 17.2 (`.kiro/specs/worker-app`, section 6 below). The automated tests cover everything that runs in node; what they cannot cover is the phone's own hardware: the key store, the biometric prompt, enrolment changes, uninstall, mock locations and the radio, and, since the app became **Stockkart Team**, the Google sign-in sheet, TalkBack and the phone's font-size setting. This checklist is run by a person on real phones before every Play release. iOS is built and checked but not released in this version (R4.11), so the two iPhone columns are recorded, not required to pass.

Every text in **Expect** is quoted from the code (`packages/attendance-protocol/src/messages.ts` and `worker-messages.ts` in this repository, the app's `src/i18n/strings.en.ts`, the screens in `src/screens`, the web's `inventory-platform/core/hr/src/model/labels.ts` and the inbox components in `inventory-platform/core/hr/src/ui`, the backend `ErrorCode` table and `WorkerNotificationTexts.java`). A different wording is a failure, not a nit.

**Where the HR-module screens went.** Sections 3–5 are the HR-module checklist, unchanged in substance, run inside the new shell: the punch screen is the **Attendance** tile on Home (section 6, W15 onward), **History** is the History tile, and what used to be **Settings** is **Profile** (Remove this phone, the app version as "Version x.y.z" at the bottom). Where a step below says "Settings → Remove this phone", read "Profile → Remove this phone"; where it says "Settings → App version", read "Profile → Version". Where a step expects "the pairing screen" with a banner (steps 10, 18, 19), the new shell shows the Attendance module's **Not enabled** card ("Enable biometric check-in." / **I have a code**) with the banner text as an amber card above it, and the worker stays signed in (worker-app R7.8); the next pairing starts from **I have a code**. After an uninstall (step 11) the app opens on **Sign in**: sign in as the same worker, then **I have a code**. A phone with no account cannot reach the pairing screen at all (worker-app R1.1).

## 1. Devices

| Id  | Device                                                                | What it proves                                                                                                                                                                      |
| --- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | StrongBox phone (Pixel 3 or newer, Android 12+)                       | Keys land in StrongBox (`setIsStrongBoxBacked(true)` succeeds), the API 30+ gate `setUserAuthenticationParameters(0, AUTH_BIOMETRIC_STRONG)`                                        |
| D2  | TEE-only phone (a common Redmi or Samsung A-series, Android 10–13)    | `StrongBoxUnavailableException` fallback to the TEE; the same gate as D1                                                                                                            |
| D3  | Android 9 phone (API 28)                                              | The `minSdkVersion 28` floor; the API 28–29 gate `setUserAuthenticationValidityDurationSeconds(-1)`; `BiometricManager` compat behaviour                                            |
| D4  | Phone whose face unlock is rated weak (class 2) and has a fingerprint | Weak face is never accepted; the app falls back to fingerprint (decision D4, R2.7, R5.2). Can be the same hardware as D2 if its face unlock is class 2; record it as a separate run |
| D5  | iPhone with Face ID (iOS 15.1+)                                       | Secure Enclave `.biometryCurrentSet` key, no passcode fallback; build only (R4.11)                                                                                                  |
| D6  | iPhone with Touch ID (iOS 15.1+)                                      | Same as D5 with the other sensor; build only (R4.11)                                                                                                                                |

Read the per-device notes in section 4 before running a column; they say which steps differ or do not apply.

## 2. Before you start

**Builds.** Android: a release build from `.github/workflows/release.yml` (a `v*` tag or a manual run, README.md → Releasing), installed from the Play internal testing track. iOS: `pnpm exec expo prebuild --platform ios --clean && pnpm exec expo run:ios --device` on a Mac. The Secure Enclave, Face ID and Touch ID need a real device; the simulator reports `NO_SECURE_HARDWARE`. The iOS compile itself (R4.11) is verified by the `ios` job of `.github/workflows/attendance-app.yml` on a GitHub macOS runner, not on a developer machine (Linux hosts can only run `expo prebuild --platform ios --no-install`, `expo-doctor` and `expo config --type introspect`). Write the build id / version (Profile → "Version x.y.z") in the results table. Section 6 needs two more builds, listed there.

**Backend.** A test deployment of `inventory-api` (never production: step 20 edits code, steps 12–13 and 16 write deliberately bad punches). You need: the manager web UI, read access to its MongoDB (`mongosh`), the Grafana dashboard `inventory-api / 03 module` or the raw `/actuator/prometheus` page, and a backend you can redeploy for step 20.

**Shop set-up.** One shop with: HR Settings → Attendance card → **Biometric app check-in** on and **Location check** on with the shop's saved location and radius, outside action **Block** (step 12 switches it to **Allow and flag**); one current employee per device under test (named after the device so register rows are easy to tell apart); your manager login has "add and edit employees", "manage HR settings" and "mark and fix attendance". Do the run at the shop or within the radius; where that is impossible, set the radius wide enough to cover the test location and say so in the results.

**Phone set-up.** Screen lock set; at least one class-3 biometric enrolled (fingerprint on D1–D4; Face ID on D5; Touch ID on D6), except where a step says to remove it. Location permission "While using the app" and location services on. Android phones: Developer options on and `adb` working (`adb devices`). A mock-location app ("Fake GPS location" or similar from Play) installed on D1–D4 for steps 12–13. Correct automatic date and time (steps 14–16 rely on it).

**Tools.**

```sh
adb shell getprop ro.build.version.sdk            # 28 on D3, ≥ 31 on D1
adb shell pm list features | grep strongbox        # feature:android.hardware.strongbox_keystore on D1 only
adb logcat -s ReactNativeJS:* BiometricPrompt:* keystore2:* KeyStore:*   # while running steps 4–9
```

## 3. Checklist — run every step on every device

Steps are in the order that leaves the phone in the right state for the next one. "Server" lines name the check in section 5. Tick the results table (section 7) as you go; a step that does not apply to a device is marked `n/a`, never left blank. Run section 6 steps W1–W15 first so the phone is signed in and approved; the pairing in step 2 is then the Attendance tile's **I have a code**.

### A. Pairing

**1. Capability gate names the setting (R2.7, R5.4).**
Remove every fingerprint and face from the phone (keep the PIN). Manager: employee page → Attendance app section → **Pair a phone** → the QR code and the 8 characters appear with a 15:00 countdown. Phone: open the app, type the 8 characters, tap **Continue**.
Expect: the notice "Turn on fingerprint or face unlock in Settings → Security, then try again." under the field; the code stays in the field; the manager's countdown keeps running (the code was not sent).
Server: `hr_pairing_codes` row for the employee still `status: "UNUSED"`, `attempts: 0`; no `inventory_hr_app_pairings_total{event="failed"}` increment. On D4 see section 4.

**2. Pair by QR (R2.3, R2.6, R2.8, R2.9, R5.1).**
Enrol one fingerprint (D1–D4), Face ID (D5) or Touch ID (D6). Phone: scan the manager's QR code with the in-app camera.
Expect, in order: the code appears in the field and the screen changes to **Is this you?** with "Shop" and "Employee" names matching the manager's screen → **Yes, this is me** → **Before we pair this phone** with the three headings "What is recorded", "What is never recorded", "Who can see it" and the lists `Your check-in and check-out time / How far from the shop you were / That your fingerprint or face check passed`, `Your fingerprint / Your face / Your exact location`, `The shop's managers can see your attendance` → **I agree** → no biometric prompt (key creation needs none) → **This phone is paired** with the same two names and "Open the app near the shop and tap the button to check in or out." → **Continue** → Home with the employee name, shop name, today's date as `Thu, 3 Apr 2025` and one button **Check in**.
Server: employee page reloads to "Paired · <phone model> · since <today> · no punches yet"; Settings card count rises by one and links to the employee list with "App paired" = Yes; `hr_device_pairings` row `status: "ACTIVE"`, `os`, `osVersion`, `phoneModel`, both public keys Base64 starting `MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE` (91-byte P-256 SPKI, identical shape on Android and iOS), `consentVersion: 1`, `consents: [{version: 1, at}]`; `hr_audit_events` row `action: "DEVICE_PAIRED"` (section 5.3); `inventory_hr_app_pairings_total{event="created"}` and `{event="completed"}` each +1.

**3. Pair by typed code, lowercase and hyphenated (R2.3).**
Manager: **Unpair phone** → **Unpair this phone?** → confirm (the phone is now unpaired; step 18 tests what the phone shows for this, so for now just relaunch the app and accept the pairing screen). Manager: **Pair a phone** again and read the code out as the web shows it, `ABCD-EFGH`. Phone, three attempts:

- a. Type `abcd-efgh` (lowercase, with the hyphen) → **Continue**. Expect: the server accepts it and **Is this you?** appears. Tap **No, this isn't me**. Expect: back to the code field, field empty; on its next load the manager's card no longer shows the code (the server reports a pending code only while it is `UNUSED` or `CLAIMED`).
- b. Type a code with a character outside the alphabet, e.g. `ABCD-EFG0` or `ABCD-EFGI` (zero, capital i). Expect: "This code is not right. Check the 8 characters and try again." shown **without** a network call: the manager's `hr_pairing_codes` row is unchanged and `inventory_hr_app_pairings_total{event="failed",reason="code_wrong"}` does not move.
- c. Manager: **Pair a phone** (a fresh code, the one from (a) is `INVALIDATED` by "No"). Type it with a space in the middle, `abcd efgh`, and finish the pairing as in step 2.

Server after (a): `inventory_hr_app_pairings_total{event="failed",reason="abandoned"}` +1; the old code row `status: "INVALIDATED"`.

**4. Key lives in secure hardware (R5.1, R9.4).**
There is no diagnostics screen and the module writes no `KeyInfo` logcat line, so this is inferred from the code path that must have run for step 2 to succeed: `SignerKeyStore.generateInSecureHardware` creates each key (StrongBox first, TEE on `StrongBoxUnavailableException`), then reads `KeyInfo.securityLevel` (API 31+: `SECURITY_LEVEL_STRONGBOX`, `TRUSTED_ENVIRONMENT` or `UNKNOWN_SECURE`) or `KeyInfo.isInsideSecureHardware` (API 28–30); a key that fails this check is deleted and pairing stops with "This phone has no secure hardware for the Attendance app, so it cannot be paired." Also `capability()` returned `STRONG_BIOMETRIC_READY`, which first creates and deletes a probe key under the same check. On iOS the key is created with `kSecAttrTokenIDSecureEnclave`, so it cannot exist outside the enclave.
Do: confirm step 2 reached **This phone is paired** on this device, and record the hardware class: `adb shell pm list features | grep strongbox` prints `feature:android.hardware.strongbox_keystore` on D1 and nothing on D2–D4. On D5/D6 record the iPhone model (all supported models have a Secure Enclave).
Expect: pass by construction once step 2 passed; a device that shows the "no secure hardware" text cannot be in the matrix and is reported.

### B. Punching

**5. One prompt, no PIN or pattern fallback, cancel sends nothing (R4.2b, R4.2d, R5.2, R5.5).**
Home → tap **Check in**.
Expect: within a few seconds the phone's own biometric sheet titled "Confirm it is you" with the line "Use your fingerprint or face to record this punch" and one button, **Cancel**. Nowhere on the sheet is "Use PIN", "Use pattern", "Use password", "Enter Passcode" or any device-credential option, not even after a wrong finger or face. Tap **Cancel**. Expect: the red line "A fingerprint or face check is required to check in. Try again." under the button; the button still says **Check in**; Check-in and Check-out still "—".
Server: no row in `hr_punches` for the employee; `inventory_hr_app_punches_total` for the shop unchanged (nothing was sent).

**6. Wrong finger or face, then lockout (R4.2b).**
Tap **Check in** and present a finger or face that is not enrolled, repeatedly.
Expect: the sheet stays open on the first failures (the phone reports them, the app does nothing); after the OS lockout (five failures on Android, five on iOS) the sheet closes by itself and the app shows "A fingerprint or face check is required to check in. Try again." Nothing else changes. Wait out the lockout (30 s on Android; on iOS unlock the phone once with the passcode) before step 7.
Server: still no punch, counter unchanged.

**7. Accepted punch (R4.4, R4.7).**
Tap **Check in**, pass the biometric.
Expect: the green line "Checked in at HH:MM" where HH:MM is the **server's** clock in Asia/Kolkata (set the phone's clock 10 minutes off beforehand to prove the phone time was not used, then set it back); no flag line; Check-in row shows the same time; the button now reads **Check out**.
Server: daily register row shows the fingerprint icon (`aria-label` "by Attendance app") and no chip; employee page "last punch today HH:MM"; `hr_punches` row `source: "BIOMETRIC_APP"`, `pairingId`, `deviceModel`, `flags: []`; `inventory_hr_app_punches_total{result="accepted"}` +1.

**8. Second punch within 30 s still prompts; it is a duplicate (R5.3, R4.8).**
Within 30 seconds of step 7 tap **Check out**.
Expect: the biometric sheet appears **again** (one check per signature; nothing is cached from step 7). After passing it: "Checked out at HH:MM" and a second line "This is a duplicate of your earlier punch, so today's times did not change"; the Check-in time is unchanged, Check-out stays "—", the button stays **Check out**.
Server: day drawer lists two rows, the second greyed out with "Not counted (within 5 minutes of the last one)"; the register icon and times are unchanged; `inventory_hr_app_punches_total{result="duplicate"}` +1.

**9. Request signing never prompts (design DD2).**
Open **History**, go back, open **Settings**, go back.
Expect: both screens load (History lists the punches from steps 7–8 with date, HH:MM, "Check in" / "Check out") and no biometric sheet appears at any point: `/me` and `/punches` are signed with the device key, which has no user-authentication requirement.

### C. Enrolment change and reinstall

**10. New fingerprint or face enrolment invalidates the key (R5.9, design `KEY_INVALIDATED`).**
Phone settings: add a second fingerprint (D1–D4, D6) or reset and re-enrol Face ID (D5). Reopen the app.
Expect: Home opens normally (`/me` uses the device key). Tap **Check in**. On Android the key is checked before any sheet is shown (`KeyPermanentlyInvalidatedException` in `initSign`), so **no biometric sheet appears**; on iOS the sheet may appear once and then fail. Either way, within 5 seconds the app is on the pairing screen with the amber banner "Your phone's fingerprint or face settings changed, so this phone must be paired again. Ask your manager." above the code field. Kill and relaunch: still the pairing screen (everything was wiped).
Server: the pairing row is **still** `ACTIVE` and the employee page still says "Paired …" — the phone cannot tell the server about a local wipe. Re-pair (step 2 flow): the manager gets **Replace the old phone?** first; after **I agree** the old row is `UNPAIRED` with `unpairReason: "REPLACED"`, the audit row is `DEVICE_REPLACED` with `before.phoneModel`, and `inventory_hr_app_pairings_total{event="replaced"}` +1. Note "no biometric sheet" or "one failed sheet" in the results.

**11. Uninstall → reinstall → pairing screen (R5.9, R2.11).**
Uninstall the app, reinstall the same build, open it.
Expect on Android: the pairing screen with no banner (the secure store, the SQLite file and the Keystore entries went with the app). Pair again: the manager sees **Replace the old phone?** because the server still has the previous pairing `ACTIVE`; after completion the old row is `REPLACED` and the new row has a new `installationId` (visible only as a different hash-free UUID in the database; it is never shown in the UI).
Expect on iOS, the checkpoint 15 caveat: iOS does **not** delete Keychain items when an app is uninstalled, and both the `expo-secure-store` pairing record and the two Secure Enclave key references are Keychain items. The app may therefore open straight on **Home**, still paired, with the old `installationId`, and the old pairing still works. Record which of the two happened. This is not a release blocker because iOS is not released (R4.11); the design's iOS README (step 7 there, "Delete the app → reinstall → `hasKeys()` false") assumes the Android behaviour and must be corrected or the app must detect a reinstall itself before an iOS release. The owner decides.

### D. Location

**12. Mock location under Block (R4.6).** Android only; iOS has no mock flag (`mocked` is always false there) — mark D5/D6 `n/a`.
Developer options → "Select mock location app" → the fake-GPS app; start it with a position far from the shop. Shop still on **Block**. Tap **Check in**, pass the biometric.
Expect: the red line "Fake location detected" (exactly that, no second sentence); the Home times and button unchanged.
Server: nothing stored; `inventory_hr_app_punches_total{result="fake_location"}` +1. The daily register shows no new row for this punch.

**13. Mock location under Allow and flag (R4.6, R8.3–R8.6).**
Manager: Attendance card → outside action **Allow and flag** → save. Phone: repeat step 12 (still mocking).
Expect: "Checked in at HH:MM" (or "Checked out …", whichever the server decides) plus exactly one flag line "Fake location — your manager will see this"; no "Outside shop" line, no distance anywhere.
Server: daily register row chip **Fake location** (once, even after several mock punches); day drawer row `HH:MM · Attendance app · — · Fake location · <phone model>` ("—" because a mock punch stores no distance); "Flagged" filter on → the row is listed; `hr_punches` row `flags: ["FAKE_LOCATION"]`, `distanceMetres: null`; `inventory_hr_app_punches_total{result="flagged"}` +1. Then stop the mock app, clear the mock-location app in Developer options, and set the outside action back to **Block**.

### E. Poor network and offline

**14. Airplane-mode punch is saved on the phone (R6.1–R6.4, R6.16).**
Turn airplane mode on. Open the app (or return to Home).
Expect: the grey notice "The server could not be reached. A check-in now is saved on your phone and sent when you have network." Tap the button, pass the biometric (the sheet still appears: a punch is signed before it is saved).
Expect: "Saved on your phone. It will be sent when you have network."; the line "1 punch waiting to be sent" under the button within 1 second; the button label flips to the opposite of what you tapped (R6.4: the label follows the newest saved punch). Tap again, pass the biometric: "2 punches waiting to be sent", label flips back.
Server: nothing yet.

**15. Reconnect: the queue drains oldest first and the register shows "Recorded offline" (R6.5–R6.9).**
Turn airplane mode off and keep the app in the foreground.
Expect: within 5 seconds of the network returning (or up to 60 seconds if a send attempt ran in the previous minute) the waiting line changes to "1 punch waiting to be sent" and then disappears; no biometric sheet; no confirmation lines for queued punches (they were confirmed when saved). Open History and return to Home: the label and today's times are the server's.
Server: two new punches; each `hr_punches` row has `flags: ["RECORDED_OFFLINE"]`, `at` equal to `phoneTime` (the phone's clock at the tap, not the arrival time), ordered by phone time; the daily register row has the chip **Recorded offline** once; the day drawer rows read `HH:MM · Attendance app · <n> m from shop · Recorded offline · <phone model>`; History on the phone lists them with "Recorded offline — your manager will see this"; `inventory_hr_app_punches_total{result="offline_accepted"}` +2 (or `duplicate` for the second if it fell within 5 minutes of the first — record which); `inventory_hr_app_offline_backlog_total` unchanged unless you waited more than 1 hour before reconnecting (do that once per release on one device and confirm it rises by the number of punches sent).

**16. Refusal card with OK (R6.13–R6.14).**
Airplane mode on. Tap the button, pass the biometric → "Saved on your phone…", "1 punch waiting to be sent". Manager: Attendance card → **Biometric app check-in** off → save. Phone: airplane mode off.
Expect: within 5 seconds the waiting line disappears and a card appears in the notice area: first line `Thu, 3 Apr 2025 · HH:MM · Check in` (the phone's date, time and the direction the button showed), second line "Your shop has not turned on the Attendance app. Ask your manager to mark your attendance.", and an **OK** button. The card is not counted as waiting. Kill and relaunch: the card is still there. Tap **OK**: the card is gone and stays gone after another relaunch.
Server: nothing stored for that punch; `inventory_hr_app_punches_total{result="off"}` +1. Manager: switch **Biometric app check-in** back on.

### F. Unpairing

**17. "Remove this phone" without network keeps the pairing (R3.7–R3.8).**
Airplane mode on. Settings → **Remove this phone** → the inline question **Remove this phone?** with "Your shop will no longer accept check-ins from this phone, and everything the Attendance app saved on it is deleted. A manager can pair it again." and the buttons **Cancel** / **Yes, remove** → **Yes, remove**.
Expect: the red line "This phone could not be removed because the server could not be reached. Try again when you have network."; the Shop, Employee and App version rows are still filled; go back to Home and relaunch: still paired, still Home.
Server: pairing still `ACTIVE`; no audit row.

**18. "Remove this phone" with network (R3.7, R3.9).**
Airplane mode off. Settings → **Remove this phone** → **Yes, remove**.
Expect: the pairing screen within 5 seconds, no banner; relaunch → pairing screen.
Server: employee page "Not paired"; `hr_device_pairings` row `status: "UNPAIRED"`, `unpairedBy: "self"`, `unpairReason: "WORKER"`, `purgeAt` = `unpairedAt` + 90 days; audit row `DEVICE_UNPAIRED` with `actorUserId: "self"`, `reason: "WORKER"`, `before.phoneModel`; `inventory_hr_app_pairings_total{event="unpaired",reason="WORKER"}` +1. Re-pair (step 2) before step 19.

**19. Manager unpair → 403 → pairing screen within 5 s (R3.1–R3.3).**
Manager: employee page → **Unpair phone** → **Unpair this phone?** → confirm. The page shows "Not paired" at once. Phone (paired, on Home, with network): either leave Home and come back, or tap the button and pass the biometric.
Expect: within 5 seconds of that action the pairing screen with the banner "This phone is no longer paired. Ask your manager." and, on its own line below it, "Ask your manager to mark your attendance." (the server's text, R3.2, plus the R7.10 line the app appends). Relaunch: pairing screen. If a queued punch existed it is gone too (the whole store is wiped).
Server: `hr_device_pairings` row `UNPAIRED`, `unpairedBy: <manager user id>`, `unpairReason: "MANUAL"`; audit row `DEVICE_UNPAIRED` with the manager's `actorUserId`, `reason: "MANUAL"`, `before.phoneModel`, `before.os`, `before.pairedAt`. Every request the unpaired phone made before it wiped (`/me` or the punch) increments `inventory_hr_app_punches_total{result="signature_failed"}` by one: `AttendanceAppAuthInterceptor` counts an unknown or unpaired pairing as a signature failure (R5.8, R10.2) and feeds it to the health window, which with fewer than 20 attempts raises no alert. Note the count. Re-pair for step 20.

### G. Consent

**20. Re-consent gate after a RECONSENT_REQUIRED version bump (R9.12–R9.13).**
Consent versions live in code: `inventory-api` `core/hr/src/main/java/com/inventory/hr/service/ConsentVersions.java`, `VERSIONS`. On the **test** backend add a second entry `new ConsentVersion(2, Kind.RECONSENT_REQUIRED, …)` with one extra sentence in `recorded`, redeploy. Phone (paired on version 1): relaunch the app.
Expect: the screen **Updated consent** opens first, with "The consent text has changed. Please read it again before your next check-in." and the three lists including the new sentence; **I agree** / **Don't agree**. Tap **Don't agree**: the screen stays; there is no way to reach Home or punch. Tap **I agree**: Home. Relaunch: Home directly (no gate).
Server: `hr_device_pairings` row `consentVersion: 2`, `consents: [{version: 1, at}, {version: 2, at}]`; audit row `DEVICE_CONSENT_UPDATED`. Also confirm that a `WORDING_ONLY` version 3 does **not** show the gate (add it, redeploy, relaunch → Home). Remove the test versions afterwards.

### H. Build

**21. The build refuses a plain-HTTP API URL (R9.7).** Once per release, on the build machine, not on a phone.

```sh
cd stockkart-team-app   # the repository root
EXPO_PUBLIC_API_URL=http://api.example.in/api/v1 pnpm exec expo config --type public
```

Expect: the command fails with `EXPO_PUBLIC_API_URL must be an https:// URL (got "http://api.example.in/api/v1"). Set it in .env at the repository root or in the GitHub repository variables for a release build.` from `app.config.js`; the same text stops `expo prebuild`, locally and in `release.yml`. With `EXPO_PUBLIC_API_URL=` (empty) the message shows `(got "")`. Then confirm the repository variable `EXPO_PUBLIC_API_URL` (Settings → Secrets and variables → Actions → Variables) holds an `https://` value.

## 4. What differs per device

**D1 — StrongBox phone.** `adb shell pm list features | grep strongbox` prints the feature (step 4). Everything else is the common path. If step 2 fails with the "no secure hardware" text on a phone that has the feature, the StrongBox fallback is broken: capture `adb logcat -s keystore2:*` and report.

**D2 — TEE-only phone.** No StrongBox feature; the module catches `StrongBoxUnavailableException` (or a vendor `ProviderException` wrapping it) and generates in the TEE. Vendor biometric sheets (MIUI, One UI) replace the stock design; the check in step 5 is still "no PIN / pattern / password control anywhere on the sheet".

**D3 — Android 9 (API 28).** `getprop ro.build.version.sdk` = 28. The punch key uses `setUserAuthenticationValidityDurationSeconds(-1)` (per-use); the proof is step 8, the sheet on every punch. The sheet is the API 28 system `BiometricPrompt`. Two compat behaviours to expect: `BiometricManager` on API 28–29 cannot grade a face unlock, so a phone with **only** face enrolled is answered `NO_STRONG_BIOMETRIC_HARDWARE` → "This phone has no strong fingerprint or face unlock, so it cannot be paired." (step 1 shows this text instead of the "Turn on …" one if the phone has face but no fingerprint; record it); with a fingerprint enrolled the gate passes. Step 10 (new enrolment → `KEY_INVALIDATED`) must still hold: `setInvalidatedByBiometricEnrollment(true)` exists since API 24.

**D4 — weak face unlock only, plus a fingerprint sensor.** Step 1 variant: enrol **only** face unlock (no fingerprint) and type the code. Expect "Turn on fingerprint or face unlock in Settings → Security, then try again." (the phone has class-3 hardware, the fingerprint sensor, with nothing class-3 enrolled). Then enrol a fingerprint and pair. Steps 5–8: the sheet offers **fingerprint only**; the weak face never unlocks the key even if the phone's own lock screen uses face. Step 10 variant: adding a face re-enrolment alone must **not** invalidate the key (the key is tied to class-3 enrolment); adding a fingerprint must. Record both.

**D5 — iPhone, Face ID; D6 — iPhone, Touch ID.** Build only (R4.11): results are recorded, failures are filed, nothing blocks the Android release. Install from Xcode or TestFlight. Differences: step 1 expects the same "Turn on fingerprint or face unlock …" text after removing all Face ID / Touch ID enrolments (`LAError.biometryNotEnrolled` → `NO_STRONG_BIOMETRIC_ENROLLED`); step 5's sheet is the system Face ID / Touch ID sheet — after a failed match it must **not** show "Enter Passcode" (`.biometryCurrentSet` and an empty `localizedFallbackTitle`); step 6's lockout needs a passcode unlock of the phone to clear; step 10: `KEY_INVALIDATED` is raised after the sheet, not before, so expect one sheet that fails and then the pairing screen — a merely wrong finger must show "A fingerprint or face check is required …" instead (the module compares the stored enrolment state to tell the two apart; if a wrong finger wipes the pairing, that is a bug); step 11: the Keychain caveat above; steps 12–13: `n/a`; step 21 applies unchanged. The phone model reported to the server is "iPhone" (no `expo-device`), so the employee page reads "Paired · iPhone · …".

## 5. Server-side checks (exact places)

### 5.1 Register and employee screens (manager web UI)

| Where                                           | What to look at                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Daily register `/dashboard/hr/attendance`       | Source icon per row: fingerprint for the app (`data-source="BIOMETRIC_APP"`, accessible name "by Attendance app"), hand for a manual mark, phone for My HR. Chips after the mark: **Fake location**, **Recorded offline**, plus the existing **Outside shop**, **Location unclear**, **Missing check-out**, each at most once per row. Hint **No punch yet** next to a paired employee with no punch and no mark today (switch on). Filter bar: **Source** (Hand / My HR / Attendance app) and **Flagged** combine as AND. |
| Month register `/dashboard/hr/attendance/month` | Cell accessible name contains "Present, by Attendance app" for an app day (`<name>, <day>: Present, by Attendance app. Show day detail`). Click a cell → day drawer.                                                                                                                                                                                                                                                                                                                                                       |
| Day drawer (either register)                    | Every punch, time ascending: `HH:MM`, fingerprint icon + "Attendance app", then `<n> m from shop` or `—`, every flag in plain words (Outside shop, Location unclear, Fake location, Recorded offline), the phone model (blank for My HR), and `Not counted (within 5 minutes of the last one)` greyed out for a duplicate. **History** block below: `Mark changed: Unmarked → Present`, `<date time> by <name> · FORGOT_PHONE` (or `· OTHER: <text>`) for a hand mark on a paired employee.                                |
| Employee page → **Attendance app** section      | `Not paired` or `Paired · <model> · since <d Mon yyyy> · last punch today HH:MM` / `· no punches yet`; **Pair a phone** (then **Replace the old phone?** when paired) → QR + `ABCD-EFGH` + `mm:ss` countdown from 15:00; **Unpair phone** → **Unpair this phone?**.                                                                                                                                                                                                                                                        |
| Employee list `/dashboard/hr/employees`         | Column **App paired** Yes / No; filter All / Paired / Not paired (`?paired=true` from the settings card link).                                                                                                                                                                                                                                                                                                                                                                                                             |
| HR Settings → Attendance card                   | Switch **Biometric app check-in**; the line `N employees have a paired phone` (`1 employee has a paired phone`) linking to the filtered list; the warning "Workers can check in from anywhere. Turn on Location check to limit check-in to the shop." only when Location check is off.                                                                                                                                                                                                                                     |
| HR landing (`HrGetStartedCard`)                 | The signature-failure banner `<shop>: <r>% of Attendance app punches could not be verified in the last hour (<n> failed punches of <attempts>).` must **not** appear during this run: the only `signature_failed` increments are the one or two requests of an unpaired phone in steps 3 and 19, below the 20-attempt floor of R10.5. If it appears, stop and investigate `result="signature_failed"` below.                                                                                                               |

### 5.2 Database rows (`mongosh` on the test database)

Pairing audit rows are not shown on any manager screen in this version (the day drawer shows attendance rows only), so they are checked here.

```js
// the employee under test
const e = db.employees.findOne({ name: 'D1 StrongBox' })._id.toString();

// pairing state and what it stores (R2.15, R2.16: no phone number, IMEI, ad id, biometric)
db.hr_device_pairings.find({ employeeId: e }).sort({ createdAt: -1 }).limit(3);

// HR history for the pairing lifecycle: DEVICE_PAIRED / DEVICE_REPLACED / DEVICE_UNPAIRED /
// DEVICE_CONSENT_UPDATED / PAIRING_CODE_CREATED; rows carry actorUserId ("self" / "system" /
// a user id), reason (MANUAL / WORKER / REPLACED / EMPLOYEE_EXITED), before.phoneModel.
// Must never contain a key, an installationId or a coordinate (R9.1, R9.2).
db.hr_audit_events.find({ entityType: 'DevicePairing', employeeId: e }).sort({ at: -1 }).limit(10);

// punches: source, pairingId, deviceModel, phoneTime, flags; never lat/lng (R9.2)
db.hr_punches.find({ employeeId: e }).sort({ at: -1 }).limit(5);

// pairing codes: status UNUSED / CLAIMED / USED / CANCELLED / INVALIDATED, attempts; hash only
db.hr_pairing_codes.find({ employeeId: e });
```

Fail the run if any `hr_audit_events`, `hr_punches` or `hr_device_pairings` document contains `latitude`, `longitude`, `lat`, `lng`, a Base64 key outside the two `publicKey` fields of `hr_device_pairings`, or a UUID in an audit row.

### 5.3 Metrics and Grafana

Raw counters: `GET /actuator/prometheus` on the test backend, filter `inventory_hr_app`. Dashboard: Grafana → `inventory-api / 03 module`, pick the shop in the **shop** variable. The three panels and what this run should produce:

| Panel                                          | Query (as in `grafana/dashboards/03-module.json`)                                                                                    | Expected during the run                                                                                                                                                                                                                                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Attendance app punches per result**          | `sum by (result) (rate(inventory_hr_app_punches_total{shop=~"$shop"}[5m]))` plus a second series: the 1-hour signature-failure ratio | Series appear for `accepted` (7), `duplicate` (8, maybe 15), `fake_location` (12), `flagged` (13), `offline_accepted` (15), `off` (16) and `signature_failed` (one per request from the unpaired phone in steps 3 and 19, nothing else). The sum over `result` equals the attempts you made (R10.2). |
| **Attendance app offline backlog**             | `sum(increase(inventory_hr_app_offline_backlog_total{shop=~"$shop"}[1h]))`                                                           | Flat unless step 15 was run with a > 1 h gap; then it rises by the number of punches sent.                                                                                                                                                                                                           |
| **Attendance app pairing failures per reason** | `sum by (reason) (rate(inventory_hr_app_pairings_total{event="failed",shop=~"$shop"}[5m]))`                                          | `abandoned` (step 3a) only. `code_wrong` must **not** rise from step 3b (the app refused the code locally). Also check the raw counter for `event="created"`, `"completed"`, `"replaced"` (steps 10–11), `"unpaired"` with `reason="WORKER"` (18) and `"MANUAL"` (19).                               |

Server-side latency (R10.9–R10.10) is the k6 script's job (task 16.2), not this checklist's.

## 6. Stockkart Team (worker-app)

Spec task 17.2 (`.kiro/specs/worker-app`; R12.2, R12.9, R12.11). Everything that runs in node is covered by the app's screen tests, the property tests, `WorkerControllerIT` and the live contract test. What is left for a person: the Google account chooser, TalkBack, the phone's font-size setting, dark mode on a real panel, and the manager's browser. Steps are **W1–W30**; `W` so they never collide with the HR-module numbers. W24–W26 were removed with the flows for phones paired before accounts existed (task 19.4, D11: there is no such phone) and their numbers are kept so the others do not move. Run W1–W15 before section 3 (they sign the phone in and pair it); the rest in order.

### 6.1 Before you start (in addition to section 2)

**Builds.** Two: (1) a `release.yml` internal-track build with `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` from the repository variables (the build fails without either; `app.config.js`); (2) a layout-check build made with `EXPO_PUBLIC_PSEUDO_LOCALE=1` in the shell (never in a release build), for W28 only.

**Google.** The Android client id of the signing key of build 1 (Google Cloud console → Credentials → OAuth client, type Android, with the SHA-1 of the Play app-signing key for Play installs and of the upload key, README.md → Releasing step 6) and the web client id in `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` are both listed in the test backend's `GOOGLE_OAUTH_CLIENT_IDS` (`google.oauth.client-ids`); a token for any other audience is refused as `INVALID_CREDENTIALS`. The phone has a Google account signed in whose e-mail has **no** Stockkart login.

**Accounts and employees.** On the test backend: the owner of the test shop ("Sri Ganesh Stores" below; its owner's account name begins with the first name you want to read on the phone, "Ramesh Kumar" → "owner Ramesh"); an approver login with "add and edit employees"; a Cashier login without it. Three worker identities you will create from the phone: **A** (password; phone number `P_A`), **B** (password; `P_B`), **G** (the phone's Google account). Before W13 the manager adds by hand an ACTIVE employee "Worker B hand" with phone `P_B` and no e-mail (the possible match for B). Nothing else of the shop's HR data is touched by this section except through the flows under test.

**Phones.** W1–W23 and W27–W29 on D1 and D2; D3 and D4 may be `n/a` except where a step says otherwise; D5/D6 informational. W28 and W30 are once per release. TalkBack (W19) needs the Android Accessibility Suite; it is on every Pixel and most Samsung and Xiaomi phones.

**Tools.** `adb logcat -s ReactNativeJS:*` while running W5; `mongosh` on the test database for the rows in 6.3; the raw `/actuator/prometheus` page filtered on `inventory_hr_worker` and `inventory_user_auth_total`.

### 6.2 Checklist

#### I. Account

**W1. Sign-up validation, no network call (R1.1, R1.2).**
Fresh install of build 1 (or a phone where the app has never run). Open the app.
Expect: the screen titled "Stockkart Team" with the fields "Email" and "Password", the primary button **Sign in**, then "Continue with Google", "Forgot password?" and "Create account", and nothing else: no skip, no way to check in without an account (R1.1; a paired phone shows the same screen, W20). Tap **Create account**. Expect: the screen "Create account" with exactly "Full name", "Email", "Password", "Phone number" with the helper line "We'll use this number for your shop to contact you", "Photo (optional)" with "Take a photo" and "Choose from gallery", the primary **Create account**, "Continue with Google" and "Sign in instead". Tap **Create account** with everything empty. Expect, one under each field: "Enter your full name (2 to 100 characters).", "Enter a valid email address.", "Enter a password of at least 8 characters.", "Enter a 10-digit mobile number."; then: name `A` → the name line stays; e-mail `ramesh@` → the e-mail line; password `1234567` → the password line; phone `98765 4321` (9 digits) → the phone line; phone `+91 98765 43210` and `9876543210` → no phone line (the `+91` and the space are stripped, R1.2).
Server: `inventory_user_auth_total{source="worker-app"}` and `inventory_hr_worker_signups_total` unchanged: nothing left the phone.

**W2. Sign-up while the server is not reachable (R1.9).**
Airplane mode on. Fill a valid form for **A** (name, a new e-mail, a password of 8+, `P_A`), tap **Create account**.
Expect: the red line "Couldn't reach Stockkart. Check your connection and try again."; the form is still filled. Kill and relaunch the app: the first screen again (Sign in), no "Your session ended" line, nothing stored (`skat.account` is written only after a token arrives: `completeSignIn`).
Server: no `users` row for the e-mail.

**W3. Sign-up with a photo (R1.2, R1.5, R1.7).**
Airplane mode off. Same form; **Choose from gallery** → pick a large JPEG or PNG (a 12 MP photo) → the square crop → a round preview with "Remove photo"; tap **Create account**.
Expect: within 5 seconds the screen "Join a shop" with "Hello, <A's name>" and the cropped photo as the avatar. A HEIC or GIF pick says "Choose a JPEG or PNG photo."; denying the gallery permission says "Allow Stockkart to use the camera or your photos in the phone's settings.".
Server: `users` row `role: "WORKER"`, `shopId: null`, `phone` stored as exactly 10 digits, no `user_shop_memberships` row; `user_photos` row with `contentType: "image/jpeg"` and `bytes` ≤ 300 KB (`Object.bsonsize` or `bytes.length()`), decoded ≤ 512 × 512 (open `GET /api/v1/users/<id>/photo` with the manager's token); `inventory_hr_worker_signups_total` +1; `inventory_user_auth_total{source="worker-app"}` +1.

**W4. Duplicate e-mail (R1.5).**
Log out: Join a shop → **Log out** → the sheet "Log out of Stockkart?" with "Your details are removed from this phone. Your check-in pairing stays, so signing in again needs no new code." and **Cancel** / **Log out** → **Log out** → Sign in. **Create account** with A's e-mail again (any name, password, phone).
Expect: the server's refusal under the button, word for word. The backend today answers "User with this email already exists" on the password path and "User with this email already exists. Please login instead." on the Google path (`AuthService.signup`); R1.5 asks for "An account with this email already exists. Sign in instead." — record which text appeared; the owner decides whether the backend text is changed before release. Nothing else changes.
Server: no second `users` row.

**W5. Google sign-in on a real phone (R1.4, R1.6; design DD8).**
Sign in screen → **Continue with Google**.
Expect: the phone's own Google account chooser (not a browser tab). Pick the account **G** (no Stockkart login). Expect: the screen "Almost done, <G's first name>" (or "Almost done" when Google sent no name) with "Phone number" and its helper, "Photo (optional)", the primary **Create account** and "Back". Tap **Create account** with the phone empty → "Enter a 10-digit mobile number."; type a valid number → **Create account** → "Join a shop" with "Hello, <G's name>".
Then, negative: on the test backend remove the **Android** client id from `GOOGLE_OAUTH_CLIENT_IDS`, restart, log out, **Continue with Google** again with G. Expect: the chooser, then the server's "Invalid credentials" under the button; nothing is stored. Put the id back and restart.
Failure modes: the chooser never appears and `logcat` shows `DEVELOPER_ERROR` → the SHA-1 of build 1's signing key is not registered against the Android client id; the line "Google sign-in is not available on this phone. Use your email and password." belongs only to a phone without Google Play services and must **not** appear on D1–D4.
Server: `users` row for G's e-mail with `role: "WORKER"`, the Google subject, `phone` 10 digits and no password hash; `inventory_hr_worker_signups_total` +1. Log out, sign in as **A** with e-mail + password → "Join a shop" again (A lost nothing).

#### J. Asking to join

**W6. Not found is one answer (R3.2, R3.3, R11.4).**
Join a shop: the field "Shop owner's email", the primary **Find shop**, **Log out**. Type `ramesh` → **Find shop**. Expect: "Enter a valid email address." under the field and no server call. Then three lookups: (a) an e-mail that is no Stockkart login; (b) the Cashier's e-mail (a login that owns no shop); (c) G's e-mail (a WORKER login).
Expect, all three identical: the red line "We couldn't find a shop for that email. Check it with your manager." and nothing else: no hint which of the three it was.
Server: `inventory_hr_worker_lookups_total{result="not_found"}` +3, `{result="found"}` unchanged.

**W7. Found, confirmed, waiting (R3.2, R3.4, R4.13, R10.5).**
Type the owner's e-mail → **Find shop**.
Expect: the card "Sri Ganesh Stores · owner Ramesh" (shop name, the first word of the owner account's name) with the primary now **Yes, this is my shop** and "Not my shop" on the card; **Find shop** is gone. Tap **Not my shop** → the field again. If the owner owns two shops: "Which shop is yours?" and one button per shop; pick one → the card. **Find shop** → **Yes, this is my shop**.
Expect: the Waiting screen: "Waiting for Sri Ganesh Stores to accept you", "Requested on Thu, 3 Apr 2025" (today, Asia/Kolkata), **Withdraw request** (red), **Log out**; no primary button; no field.
Server: `hr_join_requests` row `status: "PENDING"`, `snapshot: {name, phone, email, hasPhoto: true}`, `requestedAt` (server clock); `hr_notifications` row `type: "JOIN_REQUEST_RECEIVED"`, text "<A's name> asked to join", no phone or e-mail in it; `inventory_hr_worker_join_requests_total{event="created"}` +1, `inventory_hr_worker_lookups_total{result="found"}` +1 (or +2 with the "Not my shop" round). Web, as the approver: the HR bell shows "Join request" linking to the Join requests tab; the Employees page tab reads **Join requests (1)**.

**W8. Withdraw, and "already waiting" (R3.5, R3.6).**
Waiting → **Withdraw request** → the sheet "Withdraw your request to join Sri Ganesh Stores?" with **Cancel** / **Withdraw request** → **Withdraw request**.
Expect: the Join a shop screen within 5 seconds; no rejection card. Web: the tab reads **Join requests (0)** on reload and the list says "No one is waiting to join".
Server: the row `status: "WITHDRAWN"`, `decidedByUserId` = A's user id, `expiresAt` = now + 90 days; `inventory_hr_worker_join_requests_total{event="withdrawn"}` +1.
Then (two phones, else `n/a` for this half): on D2 sign in as **A** and request the shop (W7) → D2 shows Waiting. On D1 **Find shop** → **Yes, this is my shop**. Expect on D1: the grey line "You already have a request waiting." for a moment, then the Waiting screen (the state read lands on the one pending request). Server: one PENDING row for A, not two (the partial unique index).
Leave A waiting for W10.

**W9. Rate limits with a throwaway account (R3.8, R14.1).** Once per release, on one phone; the limits are per account and in memory (handbook `IN_MEMORY_STATE.md`), so this neither blocks A nor needs a restart.
Log out; **Create account** "Worker RL". Then five times: **Find shop** (owner e-mail) → **Yes, this is my shop** → **Withdraw request** → confirm. On the sixth **Yes, this is my shop**:
Expect: the red line "Too many attempts, try again later"; the screen stays on Join a shop; nothing created. Then **Find shop** again until the eleventh lookup of the hour: the same line, this time under **Find shop**.
Server: `inventory_hr_worker_join_requests_total{event="created"}` rose by exactly 5 for this account's run and `{event="withdrawn"}` by 5; `inventory_hr_worker_lookups_total` rose by exactly 10 (the refused eleventh is not counted); `hr_join_requests` has 5 WITHDRAWN rows for the account and no sixth. Log out; sign in as **A** → Waiting.

#### K. The manager's inbox (web) and what the worker sees

**W10. Reject with a reason (R4.1, R4.2, R4.7, R4.11, R4.13).**
Web, as the **Cashier** without "add and edit employees": Employees page. Expect: no **Join requests** tab, no count anywhere, no bell entry. As the **approver**: the tab **Join requests (1)**; the row: A's photo, name, phone, e-mail, "Requested 3 Apr 2025, 2:05 pm" (IST), the badge **Join**, the status **Pending**, and the buttons **Reject** / **Approve**; nothing else about A. Open the row: the drawer titled with A's name, the fields "Phone" and "Email", no "Possible match" section (A's phone and e-mail match no employee). **Reject** → the dialog "Reject request": "<A's name> will see that the request was not accepted.", the field "Reason (optional)" with the hint "Shown to the worker word for word · 0 / 200" and the placeholder "e.g. Wrong shop, or Ask Ramesh to add you", **Cancel** / **Reject**. Paste 201 characters → the error "The reason must be at most 200 characters", **Reject** disabled, the hint counts "201 / 200". Replace with "Wrong shop" typed with three spaces before and after it → **Reject**.
Expect: the toast "<A's name>'s request rejected"; the tab reads **Join requests (0)**; the Status filter **Rejected** lists the row with **Rejected**.
Server: the row `status: "REJECTED"`, `rejectionReason: "Wrong shop"` (trimmed), `decidedByUserId` = the approver, `decidedAt`, `expiresAt` = + 90 days; `hr_audit_events` row `action: "JOIN_REQUEST_REJECTED"` with the request id and the reason; `hr_notifications` row `type: "JOIN_REQUEST_REJECTED"`, `recipientUserId` = A, text "Sri Ganesh Stores did not accept your request: Wrong shop"; `inventory_hr_worker_join_requests_total{event="rejected"}` +1. Reject once more later with a reason of only spaces and confirm `rejectionReason` is absent and the notification text has no colon.

**W11. The worker sees the outcome card (R3.10, R4.12, R10.1).**
Phone, left on Waiting with the screen on.
Expect: within 65 seconds (the 60-second poll, then the re-route) the Join a shop screen with, at the top, the banner "Sri Ganesh Stores did not accept your request: Wrong shop" and, below the greeting, the amber card "Sri Ganesh Stores did not accept your request" with the line "Wrong shop" and the button **Ask another shop**. Tap the banner: it disappears (marked read on the server), the card stays. Kill and relaunch: the card is still there. **Ask another shop**: the card is gone; relaunch: still gone. Then **Find shop** → **Yes, this is my shop** → Waiting (request #2 for A).
Server: the notification row `read: true`.

**W12. Approve → create, while Waiting polls (R3.10, R4.4, R4.8, R4.11, R4.13, R2.5).**
Phone on Waiting, screen on, hands off. Web: the row → **Approve** (no possible match, so no dialog).
Expect, web: the toast "<A's name> added as an employee"; **Join requests (0)**; the Employees list has a new ACTIVE employee named as A with A's phone and e-mail, join date today, an auto code (`EMP-0nn`), and "Not paired". Users page: a second group **Workers** below the staff listing A's name, e-mail and that employee code; the staff seat count is unchanged.
Expect, phone: within 65 seconds, with no touch, the **Home** screen (W14 describes it) with the banner "Sri Ganesh Stores accepted you". Second variant (do it with B in W13): background the app before approving, approve, bring it back → Home within 5 seconds (the foreground re-read).
Server: `hr_employees` row `userId` = A, `createdByUserId` = the approver, `joinDate` = today, `status: "ACTIVE"`, every pay field empty; `users` row `shopId` = the shop; a `user_shop_memberships` row `role: "WORKER"`; the request `status: "APPROVED"`, `outcome: "APPROVED_CREATED"`, `employeeId`; audit rows `JOIN_REQUEST_APPROVED` (with `after.outcome`, `after.mode`), `EMPLOYEE_CHANGED`, `EMPLOYEE_LINK_CHANGED`; notification `JOIN_REQUEST_APPROVED` "Sri Ganesh Stores accepted you"; `inventory_hr_worker_join_requests_total{event="approved_created"}` +1.

**W13. Approve → link to a possible match, and the two refusals (R4.3, R4.4, R4.5, R4.9).**
Phone: Profile → **Log out** (A is not paired yet, so no switch question). **Create account** **B** with phone `P_B` (the hand-made employee's number), request the shop. Web: the row shows **Approve** as before; open it.
Expect: the section **Possible match** with the badge "Same email or phone", the sentence "This shop already has an employee with the same email or phone number. Link the request to them, or create a new employee.", and exactly three facts: "Employee" `EMP-0nn Worker B hand`, "Status" **Active**, "Linked to a login" "No". **Approve** → the dialog "Approve request": "Link to EMP-0nn Worker B hand, or create a new employee?" with **Create new** / **Link to existing**. (From the table, **Approve** on this row opens the drawer with the same dialog, R4.4.) **Link to existing**.
Expect: the toast "<B's name> linked to EMP-0nn Worker B hand"; no new employee in the list; "Worker B hand" keeps its code, name, phone and join date. Phone (Waiting): Home within 65 seconds, header name B, with the banner "Sri Ganesh Stores accepted you".
Server: the hand-made employee's `userId` = B and nothing else on it changed (compare the document before and after); the request `outcome: "APPROVED_LINKED"`, `employeeId` = that employee; audit `JOIN_REQUEST_APPROVED` with `after.mode: "LINK"` and `EMPLOYEE_LINK_CHANGED`; `inventory_hr_worker_join_requests_total{event="approved_linked"}` +1.
Refusals (same phone, two more throwaway accounts, each then rejected on the web): (a) sign up **C** with phone `P_A` (A's, now linked) → request → the match is A's employee with "Linked to a login" "Yes" → **Approve** → **Link to existing** → the red alert in the drawer "EMP-0nn <A's name> is already linked to another login"; the row stays **Pending**. (b) web: exit a hand-made unlinked employee "Worker X" with phone `P_X` → sign up **X** with `P_X` → the match shows **Exited** → **Link to existing** → "EMP-0nn Worker X has exited. Create a new employee instead."; still Pending; **Create new** → "<X's name> added as an employee". Bulk, optional when the inbox did not change: with C (match) and one plain request selected, **Approve selected** → "Approved 1. 1 needs your review", C still Pending and highlighted; **Reject selected** with one reason → every selected row Rejected with that reason.
Finish: phone Log out; sign in as **A** → Home (A).

#### L. Home and the Attendance module

**W14. Home: header, grid, status line, back (R6.4, R6.5, R6.6, R6.8, R10.1).**
Expect: A's avatar and name, "Sri Ganesh Stores", today's date as "Thu, 3 Apr 2025"; the banner stack (tap "Sri Ganesh Stores accepted you" → it goes, Home stays); then the grid: **Attendance** as the one large tile with the status line "Not checked in", then **History** and **Profile** as two half tiles in one row. No Payslips, Leave, Advances or "Coming soon" tile anywhere (the server listed `ATTENDANCE, HISTORY, PROFILE` and nothing else). Hardware back on Home exits the app; open **History** → back returns to Home; on Sign in, Join or Waiting, back exits the app (R6.8). Rotate the phone: nothing is lost.
Server: `GET /api/v1/hr/worker/me` (as A, with the Bearer token) → `state: "ACTIVE"`, `modules: ["ATTENDANCE","HISTORY","PROFILE"]`, `pairing.state: "NOT_PAIRED"`, `today.in: null`.

**W15. Enable biometric check-in: the wrong-employee code, then the right one (R7.1, R7.2, R7.3, R7.6, R7.9).**
Tap **Attendance**. Expect: the screen "Attendance" with "Back", the card "Enable biometric check-in." / "Ask your manager for a code." and the one primary **I have a code**. Web: on **B's** employee page → **Pair a phone** → read the code. Phone: **I have a code** → type B's code → **Continue**.
Expect: the red line "This code is for a different employee. Ask your manager." under the field; the code stays in the field; the manager's 15:00 countdown keeps running and the code is still usable by B (or the manager cancels it).
Server: B's `hr_pairing_codes` row still `status: "UNUSED"` with `attempts: 1`; `hr_audit_events` row `action: "PAIRING_CODE_REFUSED"` on B's employee with `attemptedByUserId` = A's user id.
Web: on **A's** employee page → **Pair a phone**. Phone: scan the QR.
Expect: **Is this you?** with "Shop" = Sri Ganesh Stores and "Employee" = **A's own name as the account has it** (edit A's name on the web employee page beforehand to something different, e.g. a nickname, to prove the screen shows the account's name, not the code's) → **Yes, this is me** → the consent screen of step 2 → **I agree** → **This phone is paired** → **Continue** → the Attendance screen now Enabled: the HR-module punch home (the one **Check in** button, today's "—" times). Tap **Check in**, pass the biometric → "Checked in at HH:MM". **Back** → Home: the Attendance tile reads "Checked in HH:MM" (the state is re-read on focus). **History** → the punch listed as in step 9, "Back". Airplane mode on: Home shows the amber line "Couldn't reach Stockkart. Try again when you have network." above the grid; **History** shows the same list with "Last updated HH:MM" at the top; **Attendance** → **Check out**, pass the biometric → "Saved on your phone…" as in step 14; **Profile** → **Edit details** → change the name → **Save** → "Couldn't reach Stockkart. Your details were not changed." and the name is unchanged. Airplane off: the queued punch drains (step 15) and the tile reads "Checked in HH:MM · out HH:MM" on the next focus.
Server: as step 2 for the pairing, plus `GET /api/v1/hr/worker/me` → `pairing.state: "PAIRED"`; the punch rows as step 7 / 15; `inventory_hr_app_punches_total{result="signature_failed"}` **unchanged** by anything in this step — a punch that carried the Bearer token would have been refused as `HR_TWO_CREDENTIALS` and counted there (R9.1). From here, run section 3 (steps 1–21) on this phone: the manager unpairs it first (step 3's **Unpair phone**; the module returns to Not enabled as in step 19), so step 1 begins at **I have a code**. W16 continues after section 3.

#### M. Profile, sessions and leaving

**W16. Profile, Edit details, Complete your profile, Request profile details (R8.1, R8.2, R8.3, R8.6, R8.7).**
Home → **Profile**. Expect, top to bottom: the avatar and name; the rows "Phone", "Email", "Shop", "Employee code", "Join date" (as "3 Apr 2025"); the primary **Edit details**; "Complete your profile"; "Theme" with **System** / **Light** / **Dark**; **Remove this phone** (red; present because the phone is paired); **Leave this shop** (red); **Log out** (red); the line "Version <x.y.z>". **Edit details** → the screen "Edit details" with "Full name", "Phone number" (helper line), the photo field, **Save**, **Cancel**; the e-mail is not on it. Change the name and the phone (`+91 ` prefix) → **Save** → Profile shows the new name and the 10-digit phone; Home's header too; the validation lines are those of W1. **Complete your profile** → the screen "Complete your profile": "Your shop may later ask you for these details. Nothing is collected in this version.", the headings "What your shop may ask for", "When", "How your details are protected", the sentences under them (Aadhaar last 4 / Virtual ID, PAN, address, a photo of each document; "Only when your shop requests it. You will see the request here."; masked, encrypted, never in notifications / exports / messages, deleted on request or 90 days after exit), **no input field**, and the one button **Back**. Web: A's employee page → **Request profile details**. Phone: leave Profile and open it again.
Expect: the amber badge "Your shop has asked for your details" above "Complete your profile"; Home shows the banner "Sri Ganesh Stores asked for your profile details", and tapping it opens Profile.
Server: `users` row name and phone updated; A's `hr_employees` row `name` and `phone` updated, nothing else; one `hr_audit_events` row `action: "EMPLOYEE_CHANGED"`, `actorUserId: "self"`, with `before` and `after` holding the old and new name and phone; A's `hr_join_requests` rows still carry the **old** name and phone in `snapshot` (R8.3); `profileRequestedAt` set on the employee, audit `PROFILE_REQUESTED`, notification `PROFILE_REQUESTED`. `GET /api/v1/hr/worker/profile` returns no pay, bank or UPI field.

**W17. Theme (R12.10).**
Profile → **Dark**. Expect: every screen dark at once (go Home and back). Kill and relaunch: still dark. **Log out** → the Sign in screen is still dark (the choice survives log out). Sign in as A → Profile shows **Dark** selected. Set **System**; switch the phone's dark mode on and off: the app follows within a second.

**W18. Remove this phone keeps the session (R7.7).**
Profile → **Remove this phone** → the sheet "Remove this phone?" with "Your shop will no longer accept check-ins from this phone, and everything the Attendance app saved on it is deleted. A manager can pair it again." and **Cancel** / **Yes, remove** → **Yes, remove**.
Expect: still on Profile, still signed in; the **Remove this phone** row is gone; Home → **Attendance** → "Enable biometric check-in." with **I have a code**. (Offline, the sheet ends in the HR-module line of step 17 and nothing changes.)
Server: as step 18 (`UNPAIRED`, `unpairedBy: "self"`, `unpairReason: "WORKER"`); `GET /hr/worker/me` → `pairing.state: "NOT_PAIRED"`. Stay unpaired for W19.

**W19. TalkBack scripted run: pair → punch → history (R12.9).**
Settings → Accessibility → TalkBack on. Web: **Pair a phone** on A's employee page. Phone, by swipe and double-tap only, with the screen dimmed if you like (TalkBack's screen curtain): Home → the Attendance tile announces "Attendance. Not checked in" → **I have a code** → the code field announces its label → type the 8 characters with the on-screen keyboard → **Continue** → "Is this you?" reads the shop and A's name → **Yes, this is me** → the consent headings and lists are read in order → **I agree** → **This phone is paired** → **Continue** → the punch button announces **"Check in"** (the direction, not just "button") → double-tap → the biometric sheet → pass → the confirmation "Checked in at HH:MM" is **announced without moving focus** (live region) → the button now announces "Check out" → **Back** → the Attendance tile announces "Attendance. Checked in HH:MM" → **History** → each row is one element reading date, time and direction → **Back** → Home.
Expect: every control has a spoken label in English; no control is announced as "unlabelled" or by its testID; focus order is top to bottom; the Log out and Leave sheets, if opened, read question, explanation and both buttons. Record anything that was unreadable. TalkBack off.

**W20. Log out keeps the pairing; same account needs no code (R1.1, R9.5, R9.6).**
Profile → **Log out** → the sheet of W4 → **Log out**.
Expect: the Sign in screen of W1, exactly the same controls and nothing more: a stored pairing adds no card and no "check in without signing in" (D11). Kill and relaunch: Sign in again. Sign in as **A**.
Expect: Home at once, no "Switch account?" sheet (the phone remembers that A made this pairing); **Attendance** → Enabled, no code, no "Is this you?"; History still lists today's punches.
Server: the pairing still `ACTIVE`; `inventory_hr_worker_app_logins_total{result="success"}` +1; no `unpair` call. (A punch while logged out needs no session on the server, R9.10: the live contract test proves it; the app offers no screen for it.)

**W21. Session ended (R9.3, R9.4).**
Airplane mode on; **Attendance** → punch → "Saved on your phone…" (1 waiting). From a browser, reset A's password through **Forgot password?** (it opens the web reset page; `AuthService.resetPassword` revokes every session). Airplane off.
Expect: the waiting punch drains within 5 seconds even though the phone's session is already revoked server-side (watch `hr_punches`; the envelope needs no session, R9.4); then, on the next read (Home → **History**, or the foreground), within 5 seconds the Sign in screen with the amber card "Your session ended. Sign in again." and the same four controls. Sign in with the **new** password.
Expect: Home, Attendance Enabled, History intact and listing the drained punch: nothing but the token was dropped.

**W22. Leave this shop, offline and online (R5.2, R5.3, R5.4, R5.5).**
Airplane mode on. Profile → **Leave this shop** → the sheet "Leave Sri Ganesh Stores?" with "Your attendance here will stop today." and **Cancel** / **Leave this shop** → **Leave this shop**. Expect: the red line "Couldn't reach Stockkart. Try again when you have network." under the row; still on Profile. Airplane off, repeat.
Expect: the Join a shop screen within 5 seconds; no shop name, no tiles, no history anywhere in the app; **Log out** → **Sign in** as A → Join a shop again (not Home).
Server: A's employee `status: "EXITED"`, `exitDate` = today, `updatedByUserId: "self"`; audit `EMPLOYEE_CHANGED` with actor `self`; within 60 seconds (`WorkerExitJob`) `membershipEndedAt` set, `users` row `shopId: null`, the WORKER membership `active: false` with `endedAt`; the pairing `UNPAIRED` with `unpairReason: "EMPLOYEE_EXITED"` (HR-module R3.4); `GET /hr/worker/me` → `state: "NO_SHOP"`. Web: the Workers group no longer lists A; the employee page shows the exit and lets the manager change the date. The phone still holds its pairing record: the next punch from the Attendance tile, after a re-approval, is refused as step 19 and the module returns to Not enabled.

#### N. A different account on a paired phone

**W23. Switch account: warning, unpair, wipe (R9.5, R9.7).**
Set-up: sign in as **B** (approved and linked in W13, unpaired) and pair this phone to B's employee through **I have a code**. Airplane mode on; **Attendance** → punch → "1 punch waiting to be sent"; **Back**; Profile → **Log out** (works offline: best effort). Kill the app. Airplane off and, within a few seconds, open the app and sign in as **A** (the sync worker backs off for a minute after a failed send, so the punch is usually still waiting; if the line below is missing, the queue drained first: repeat).
Expect: straight from **Sign in**, before any screen of A's, the sheet "Switch account?" with "This phone is paired to another record. Switching removes that pairing from this phone. 1 punch that was not yet sent will be lost" (two or more: "N punches that were not yet sent will be lost"; none: the sentence stops at "phone.") and **Cancel** / **Switch account**. The phone decided this alone, by comparing A with the account that completed the pairing (B, remembered across the log out, R9.5); no server call was made. **Cancel** → still on Sign in, nothing stored, nothing changed; kill and relaunch → Sign in again (the pairing and the punch are still there; `GET /hr/worker/me` was never called with A's token). Sign in as **A** again → **Switch account**.
Expect: A's own screen within 5 seconds (Join a shop after W22, or Home before it); **Attendance** shows Not enabled; B's punch never arrives.
Server: B's pairing `UNPAIRED`, `unpairedBy: "self"`, `unpairReason: "WORKER"` (the one `unpair` call, made before the wipe); no new `hr_punches` row for B; B's employee page "Not paired". Variant, once: the same with airplane mode on during **Switch account** → the sheet, confirm → the phone is wiped anyway and the server's pairing stays `ACTIVE` with no further punches until the manager unpairs it (R9.7).

#### P. Layout, type and colour

**W27. Font scaling at 200 % on every screen (R12.2).**
Phone Settings → Display → Font size → largest (and Display size → largest where the phone offers it). Walk every screen and sheet: Sign in (with and without the "Your session ended" card), Create account with all four validation lines showing, Almost done (Google), Join a shop with the rejection card and the found card, "Which shop is yours?", Waiting, Blocked, Offline ("Couldn't reach Stockkart. Try again when you have network." with **Retry**), Home with "Checked in 09:12 · out 18:05" on the tile, Attendance Not enabled, the pairing code field, "Is this you?", the consent lists, "This phone is paired", the check-in screen (date and live clock, status line, punch button Check in and Check out, the Today card with two rows, both chips) with a refusal card beneath the button, History with "Last updated", Profile, Edit details, Complete your profile, and the five sheets (Log out, Withdraw, Remove this phone, Leave this shop, Switch account).
Expect: no text is cut, clipped or overlapping; every button label is fully visible (labels wrap onto a second line rather than truncate); screens scroll where the content no longer fits; on the check-in screen the live clock is still the largest text, the punch button keeps its diameter (about 200 dp, never wider than 60 % of the screen) and its label shrinks to fit instead of wrapping — the one label in the app that may; the sizes stop growing at 200 % even if the phone's slider goes further (`maxFontSizeMultiplier = 2`). Note any screen where a control fell off the bottom without a scroll. Set the font size back.

**W28. Pseudo-locale screenshots (R12.11).** Once per release.
Install build 2 (`EXPO_PUBLIC_PSEUDO_LOCALE=1`). Every text the app owns now reads as `[Find shop~~~~]`: brackets, the English, and `ceil(40 %)` of its length in `~`. Server texts (refusals, notification lines) and values (names, times, codes) stay unbracketed; that is expected.
Walk the screen list of W27 at the phone's default font size and take one screenshot per screen; attach them to the release ticket.
Expect: no label ends in "…", no two texts overlap, no bracket is cut off at an edge, no fixed-width label hides its tail; the tile labels, button labels and the "Requested on" line wrap. A single truncated or overlapping label fails the step.

**W29. Contrast spot check, violet & peach set: gradient band, punch button IN and OUT, tinted status cards and chips, in light and dark (R12.4).**
Once with Profile → **Light**, once with Profile → **Dark**, screen brightness at about 50 %, in daylight. Eyeball the pairs below on the screens named; the bar is 4.5:1 for text under 24 sp and 3:1 for larger text, icons and outlines. The ratios are the ones `src/theme/contrast.test.ts` computes from `src/theme/tokens.ts` (the gate fails the build when any drops below its bar); recompute them when the token file changes.

| Pair (token on token)                                       | Where to look                                                                                                            | Light           | Dark            | Bar |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------- | --------------- | --- |
| `textPrimary` on `brandSoft` / `accentSoft`                 | the greeting on the Home band, read at its violet top-left and at its peach bottom-right                                 | 14.1 / 14.6     | 12.4 / 12.2     | 4.5 |
| `textSecondary` on `brandSoft` / `accentSoft`               | the shop name and date on the Home band, both ends                                                                       | 5.8 / 6.0       | 6.9 / 6.8       | 4.5 |
| `textInverse` on `success`                                  | "Check in" on the punch button (next direction IN)                                                                       | 5.5             | 9.8             | 4.5 |
| `textInverse` on `danger`                                   | "Check out" on the punch button (next direction OUT); the filled confirm button of every sheet                           | 5.4             | 7.0             | 4.5 |
| `textSecondary` on `bgMuted`                                | the punch button's label while attendance is Not enabled                                                                 | 5.8             | 6.9             | 4.5 |
| `textPrimary` on `warningSoft`                              | the title of every warning card: "Your session ended…", Waiting, Offline, the offline notice under the punch button      | 15.1            | 11.7            | 4.5 |
| `textPrimary` on `dangerSoft`                               | the title of every danger card: a refusal under the punch button, "… did not accept your request" on Join                | 14.0            | 12.8            | 4.5 |
| `textPrimary` on `successSoft`                              | the title of the saved / stored card under the punch button                                                              | 14.8            | 11.1            | 4.5 |
| `warning` / `danger` / `success` on their soft tint (icons) | the leading glyph of each tinted card and chip: the Waiting hourglass, the refusal cross, the saved check                | 4.5 / 4.5 / 4.9 | 9.1 / 5.3 / 6.5 | 3   |
| `textPrimary` on `bgSurface`                                | the location and biometric chips' text on the check-in screen                                                            | 14.9            | 16.1            | 4.5 |
| `textPrimary` on `warningSoft` (chip)                       | the "Your shop has asked for your details" badge on Profile                                                              | 15.1            | 11.7            | 4.5 |
| `accentText` on `accentSoft`                                | the leading glyph of a peach chip (none drawn in this version; check if one appears)                                     | 4.5             | 8.1             | 3   |
| `textOnAccent` on `accent`                                  | the Profile tile's glyph on its peach circle; the camera badge on the photo picker                                       | 10.0            | 11.2            | 4.5 |
| `textInverse` on `brand`                                    | the label of every primary button (Sign in, Find shop, I have a code, Save); the selected theme pill; the avatar initial | 7.1             | 6.9             | 4.5 |
| `brand` on `brandSoft`                                      | the Attendance tile's glyph, the Join result's store glyph, the initial on the Home and Profile avatars                  | 6.0             | 5.1             | 3   |
| `danger` on `bgElevated`                                    | the danger rows of Profile (Remove this phone, Leave this shop, Log out), OUT glyph in History                           | 5.4             | 6.4             | 4.5 |
| `textMuted` on `bgCanvas`                                   | "Version x.y.z" on Profile (the Home date is on the band, in `textSecondary`)                                            | 4.8             | 5.0             | 4.5 |
| `borderStrong` on `bgElevated`                              | the outline of every field and secondary button, the unselected theme pills                                              | 3.5             | 3.6             | 3   |

Expect: every pair readable at arm's length in both themes; the band's greeting as clear over the peach end as over the violet one; the punch button's label as clear on red as on green. No cell is below its bar at the time of writing (`theme/contrast.test.ts` lists exactly these pairs and more, with no exception); the step passes only when the recomputed table still has no cell below the bar and the eye agrees. Set the theme back to **System**.

#### Q. The web side of a WORKER login

**W30. WORKER on the web: My HR only; not-in-shop page (R2.1, R2.2, R2.5).** Once per release, in a browser.
Sign in to the web as **B** (a WORKER with a linked ACTIVE employee).
Expect: the browser lands on `/dashboard/hr/me` (My HR) and the navigation shows **My HR** and nothing else; typing `/dashboard/hr/employees`, `/dashboard/hr/attendance` or `/dashboard` in the address bar returns to `/dashboard/hr/me`; in the developer tools, `GET /api/v1/hr/employees` with B's token answers 403 with the access-denied envelope, and `GET /api/v1/hr/me` answers 200. Sign out; sign in as **G** (a WORKER with no shop).
Expect: the page titled "Stockkart Team" with the one sentence "Your account is not part of a shop yet. Ask to join from the Stockkart Team app." and the button **Sign out**; no menu, no module. As the approver: Users page → the **Workers** group lists A and B with name, e-mail and employee code, below the staff, and the plan's seat count ignores them; Users → change role on a Worker row is not offered, and giving a staff member the WORKER role is not offered.

#### R. Phone is mandatory (worker-app R1.10–R1.13, D16)

**W31. Sign in with a Google account that has no Stockkart account → the phone step, no "sign up first" text (R1.10, R1.13).**
Log out. Use a Google account **H** on the phone that has never signed up to Stockkart (web or app). **Sign in** screen (not Create account) → **Continue with Google** → pick H.
Expect: no red line, nowhere the sentence "No account found for this Google account. Please sign up first."; the screen "Almost done, <H's first name>" (or "Almost done" when Google sent no name) with "Phone number", its helper, "Photo (optional)", the primary **Create account** and "Back". Tap **Back** → the **Sign in** screen (not Create account). **Continue with Google** again with H → the same step; type a valid number, pick a photo → **Create account** → "Join a shop" with "Hello, <H's name>". No second Google chooser was shown for the sign-up: the token from the one pick was reused.
Then, negative, on D1 only: repeat with a Google account **I** with no Stockkart account, reach the step, and wait until the ID token has expired (Google's tokens last about an hour; alternatively set the phone's clock two hours ahead before tapping Create account, then set it back). Type a valid number → **Create account**. Expect: "Google sign-in expired. Try again." under the button with a **Continue with Google** button; the typed number and the picked photo are still there; pick I again → the account is created without retyping anything.
Server: `users` row for H with `role: "WORKER"`, `phone` 10 digits, no password hash; `inventory_user_auth_total{source="worker-app"}` +1 for the refused login and `inventory_hr_worker_signups_total` +1; no row for I until the retry.

**W32. Web-created Google login without a phone → "Add your phone number" before Home (R1.11, R1.12).**
In a browser, sign up to the web with a Google account **J** (Create account → Continue with Google, staff role) and leave the phone blank, or take any existing staff login whose `users.phone` is empty (`db.users.find({ phone: { $in: [null, ''] } })`; on D5/D6, where Google is not configured, clear the phone of a password login with `$unset` and sign in with e-mail and password). On the phone: **Sign in** → J.
Expect: the screen "Add your phone number" with the helper "We'll use this number for your shop to contact you", "Phone number", "Photo (optional)", the primary **Save** and **Log out**; nothing else, no Back. Hardware back → the app closes (relaunch: the same screen). Airplane mode on → **Save** with a valid number → "Couldn't reach Stockkart. Check your connection and try again."; the screen stays; kill and relaunch in airplane mode → still "Add your phone number" (not Home offline, not the Retry screen). Airplane mode off → **Save** with `12345` → "Enter a 10-digit mobile number." and no request in the server log; **Save** with `+91 98765 43210` → the screen the account's state names (for a staff login with no employee: "This app is for workers…"; for a WORKER with no shop: "Join a shop"). Relaunch → the same screen, not the phone step. Meanwhile, from the web, clear J's phone again (`db.users.updateOne({ email: 'j@…' }, { $unset: { phone: '' } })`) and bring the app to the foreground → "Add your phone number" again, within one state read.
**Log out** from the step → **Log out of Stockkart?** → confirm → **Sign in**.
Server: `users` row for J has `phone: "9876543210"` after the Save and the `name` unchanged; the request was `PUT /api/v1/users/me/profile` with body `{"phone":"9876543210"}` and no `name` key; the earlier `12345` produced no request; `GET /api/v1/hr/worker/me` after the Save answers `account.phone: "9876543210"`.

### 6.3 Server-side checks for section 6

```js
// the worker A by e-mail; the account must hold no device id, contact, ad id or location (R11.1)
const a = db.users.findOne({ email: 'a@example.in' });
db.user_shop_memberships.find({ userId: a._id.toString() });
db.user_photos.find({ userId: a._id.toString() }, { bytes: 0 });

// join requests: snapshot frozen at request time, decision stamps, 90-day expiry (R3.9, R4.12)
db.hr_join_requests.find({ userId: a._id.toString() }).sort({ requestedAt: -1 });

// the audit rows this section writes: JOIN_REQUEST_APPROVED / JOIN_REQUEST_REJECTED /
// PAIRING_CODE_REFUSED / PROFILE_REQUESTED / EMPLOYEE_CHANGED (actorUserId "self") / EMPLOYEE_LINK_CHANGED
db.hr_audit_events
  .find({
    action: {
      $in: [
        'JOIN_REQUEST_APPROVED',
        'JOIN_REQUEST_REJECTED',
        'PAIRING_CODE_REFUSED',
        'PROFILE_REQUESTED',
      ],
    },
  })
  .sort({ at: -1 })
  .limit(20);

// notifications to the worker: names, shop name, dates and the reason only (R10.3)
db.hr_notifications.find({ recipientUserId: a._id.toString() }).sort({ createdAt: -1 });
```

Fail the run if any `hr_join_requests`, `hr_notifications` or `hr_audit_events` document contains a Bearer token, a photo, a key, an Aadhaar or PAN value, or if a notification text contains a phone number or an e-mail address; if `users` or `hr_employees` has any field named like `aadhaar`, `pan`, `address` or `document` (R8.9, R11.1).

Counters (raw `/actuator/prometheus`): `inventory_hr_worker_signups_total`; `inventory_hr_worker_join_requests_total{shop,event}` with `created = approved_created + approved_linked + rejected + withdrawn + pending` over the run (R14.2); `inventory_hr_worker_lookups_total{result}`; `inventory_hr_worker_app_logins_total{result}`; `inventory_user_auth_total{source="worker-app"}`. Grafana `inventory-api / 03 module`: exactly one new panel, **Join requests per event**, filterable by the **shop** variable, showing the `created`, `approved_created`, `approved_linked`, `rejected` and `withdrawn` series of this run; the HR-module panels of 5.3 unchanged.

## 7. Results table

Copy once per release into the release ticket. One column per device; `P` pass, `F` fail (link the bug), `n/a` not applicable to that device (state why in the notes). The two iPhone columns are informational in this version. The `W` rows (section 6) are required on D1 and D2; D3 and D4 may be `n/a` except W27 (font scaling), which runs on every Android phone; rows marked `once` are ticked in the D1 column only and `n/a` elsewhere.

| Step                                              | D1 StrongBox | D2 TEE-only | D3 Android 9 | D4 weak face | D5 iPhone Face ID | D6 iPhone Touch ID |
| ------------------------------------------------- | ------------ | ----------- | ------------ | ------------ | ----------------- | ------------------ |
| Device (make, model)                              |              |             |              |              |                   |                    |
| OS version / API level                            |              |             |              |              |                   |                    |
| App build (Profile → Version) / release run       |              |             |              |              |                   |                    |
| Backend build / commit                            |              |             |              |              |                   |                    |
| Tester                                            |              |             |              |              |                   |                    |
| Date                                              |              |             |              |              |                   |                    |
| W1 Sign-up validation texts, no call              |              |             |              |              |                   |                    |
| W2 Sign-up not reachable, nothing stored          |              |             |              |              |                   |                    |
| W3 Sign-up with photo → Join a shop               |              |             |              |              |                   |                    |
| W4 Duplicate e-mail refusal (text recorded)       |              |             |              |              |                   |                    |
| W5 Google sign-in, phone step, wrong audience     |              |             |              |              | n/a               | n/a                |
| W6 Not found: three cases, one answer             |              |             |              |              |                   |                    |
| W7 Found → confirm → Waiting, approver notified   |              |             |              |              |                   |                    |
| W8 Withdraw; already waiting (two phones)         |              |             |              |              |                   |                    |
| W9 Rate limits: 5 joins / 24 h, 10 lookups / h    | once         | n/a         | n/a          | n/a          | n/a               | n/a                |
| W10 Inbox: tab gating, row, reject with reason    |              |             |              |              |                   |                    |
| W11 Worker sees outcome card + banner             |              |             |              |              |                   |                    |
| W12 Approve → create while Waiting polls          |              |             |              |              |                   |                    |
| W13 Approve → link; linked-elsewhere; exited      |              |             |              |              |                   |                    |
| W14 Home header, grid, status line, back          |              |             |              |              |                   |                    |
| W15 Wrong-employee code; enable; punch; history   |              |             |              |              |                   |                    |
| W16 Profile, Edit details, stub, Request profile  |              |             |              |              |                   |                    |
| W17 Theme survives relaunch and log out           |              |             |              |              |                   |                    |
| W18 Remove this phone keeps the session           |              |             |              |              |                   |                    |
| W19 TalkBack: pair → punch → history              |              |             |              |              |                   |                    |
| W20 Log out keeps pairing; same account, no code  |              |             |              |              |                   |                    |
| W21 Session ended; queue drains without session   |              |             |              |              |                   |                    |
| W22 Leave this shop offline / online              |              |             |              |              |                   |                    |
| W23 Switch account: warning, unpair, wipe         |              |             |              |              |                   |                    |
| W27 Font scaling 200 % on every screen            |              |             |              |              |                   |                    |
| W28 Pseudo-locale screenshots, no truncation      | once         | n/a         | n/a          | n/a          | n/a               | n/a                |
| W29 Contrast spot check, violet & peach, L + D    |              |             | n/a          | n/a          |                   |                    |
| W30 WORKER on the web: My HR only, not-in-shop    | once         | n/a         | n/a          | n/a          | n/a               | n/a                |
| W31 Google sign-in, no account → phone step       |              |             |              |              | n/a               | n/a                |
| W32 No phone → "Add your phone number" first      |              |             |              |              |                   |                    |
| 6.3 Worker rows, counters, Grafana panel checked  | once         | n/a         | n/a          | n/a          | n/a               | n/a                |
| 1 Capability gate names the setting               |              |             |              |              |                   |                    |
| 2 Pair by QR                                      |              |             |              |              |                   |                    |
| 3a Typed lowercase + hyphen accepted              |              |             |              |              |                   |                    |
| 3b Invalid character refused locally              |              |             |              |              |                   |                    |
| 3c Typed with a space, pairing completes          |              |             |              |              |                   |                    |
| 4 Key in secure hardware (class recorded)         |              |             |              |              |                   |                    |
| 5 Sheet, no PIN/pattern, cancel sends nothing     |              |             |              |              |                   |                    |
| 6 Wrong finger/face, lockout                      |              |             |              |              |                   |                    |
| 7 Accepted punch, server time                     |              |             |              |              |                   |                    |
| 8 Second punch within 30 s prompts, duplicate     |              |             |              |              |                   |                    |
| 9 History / Settings without a sheet              |              |             |              |              |                   |                    |
| 10 New enrolment → KEY_INVALIDATED → Pair         |              |             |              |              |                   |                    |
| 11 Uninstall → reinstall → Pair (iOS: record)     |              |             |              |              | caveat            | caveat             |
| 12 Mock location, Block                           |              |             |              |              | n/a               | n/a                |
| 13 Mock location, Allow and flag                  |              |             |              |              | n/a               | n/a                |
| 14 Airplane-mode punch saved, count line          |              |             |              |              |                   |                    |
| 15 Reconnect drains, Recorded offline             |              |             |              |              |                   |                    |
| 16 Refusal card with OK                           |              |             |              |              |                   |                    |
| 17 Remove this phone offline → kept               |              |             |              |              |                   |                    |
| 18 Remove this phone online → Pair                |              |             |              |              |                   |                    |
| 19 Manager unpair → 403 → Pair ≤ 5 s              |              |             |              |              |                   |                    |
| 20 Re-consent gate                                |              |             |              |              |                   |                    |
| 21 http:// API URL refused at build (once)        |              |             |              |              |                   |                    |
| 5.1 Register / employee screens checked           |              |             |              |              |                   |                    |
| 5.2 Database rows checked (no secrets, no coords) |              |             |              |              |                   |                    |
| 5.3 Metrics / Grafana checked                     |              |             |              |              |                   |                    |

Notes (step → device → what was seen, e.g. "10 → D5 → one failed Face ID sheet, then Pair"; "11 → D5 → opened on Home, Keychain kept the pairing"; "W4 → D1 → 'User with this email already exists'"; "W29 → D2 → greeting faint over the peach end of the band"):

- …

Sign-off: Android release may proceed when every D1–D4 cell for steps 1–21, W1–W23, W27–W30 and 5.1–5.3 / 6.3 is `P` or a justified `n/a`, the W28 screenshots are attached, and the raw `signature_failed` counter moved only by the requests of the unpaired phone in steps 3 and 19.
