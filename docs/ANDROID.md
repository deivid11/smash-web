# Android shell (recent phones): native gamepads + rumble in an APK

Mobile browsers and Android WebViews expose **no HTML5 Gamepad API**, so a
controller paired to a phone is invisible to `navigator.getGamepads`. This
shell wraps the built browser code in a one-activity WebView and feeds
phone-paired controllers through a native `window.SmashPad` bridge that the
web tick already polls (see [web/src/android-bridge.ts](../web/src/android-bridge.ts)).

## Targets

- `compileSdk` / `targetSdk`: **36** (Android 16)
- `minSdk`: **25** (Android 7.1) — installs on recent phones and older
  Fire OS sticks/tablets too. Newer APIs degrade gracefully: per-device
  gamepad vibrators need API 31+ (older shells use the handset motor) and
  `VibrationEffect` needs API 26+ (legacy vibrate calls below that).
- Language: Java 17, framework APIs only (no AndroidX), one Activity.

## What the shell does

- Serves the packaged web bundle (repository `dist-android/`, copied into the
  APK at build time) at the virtual origin of the configured game host (`ORIGIN_HOST` in `MainActivity.java`, written `https://YOUR_HOST` below): every
  non-`/api` request on that host is answered from the APK by
  `PackagedOrigin` (same technique as AndroidX `WebViewAssetLoader`), unknown
  paths get a local 404, and `/api/*` goes over the WebView's real network
  stack to the hosted server. Why not `file://`: file pages cannot `fetch()`
  (the gameplay WASM never loads), Cache Storage rejects `file://` keys (the
  offline download silently never persists), and interception of `file://`
  subresources is unreliable. `copyWebDist` fails the build when
  `dist-android/play.html` or the gameplay WASM is missing (a separate
  always-run check: an empty Copy source is skipped before `doFirst` runs).
- Forwards every gamepad key/motion event into `SmashPadBridge`
  ([MainActivity.java](../android/app/src/main/java/dev/smashweb/play/MainActivity.java),
  [SmashPadBridge.java](../android/app/src/main/java/dev/smashweb/play/SmashPadBridge.java)):
  17 standard-layout buttons + 4 stick axes per pad, hat/trigger doubles
  included, matching [docs/CONTROLLERS.md](../docs/CONTROLLERS.md).
- Exposes `getPads()` (JSON snapshot), `rumbleAll()` (gamepad vibrators,
  API 31+ device vibrators) and `vibrateCsv()` (phone handset).
- Pairing stays in **Android Settings → Bluetooth** (or USB OTG); the shell
  only reads already-connected devices.
- `/api` reads are ordinary same-origin fetches (genuine 206 range replies,
  the `/api/rooms` WebSocket works too). Service workers are not registered in
  the shell and existing ones are removed; a `ServiceWorkerClient` also answers
  worker fetches from the APK so a server-hosted build can never replace it.

The web side needs no Android-specific code paths beyond the bridge: the
standard controller mapping, calibration, slots, menu navigation and the
rumble levels in Options all apply unchanged. Prototype scope from the
project guardrails still holds — this is the same limited playable slice,
not the complete engine.

## Build

Prerequisites: JDK 17+, Android SDK with platform 36 + build-tools 36
(for example `~/Android/Sdk`), set the game host once in the ignored
`android/local.properties` (`smash.originHost=YOUR_HOST`, or export `SMASH_ORIGIN_HOST`), then from the repository root:

```sh
npm run android:build
```

The APK lands at
`android/app/build/outputs/apk/debug/app-debug.apk`.

## Install and run

```sh
npm run android:install
```

or manually:

```sh
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

1. Open **Smash Web** on Wi-Fi: it loads `https://YOUR_HOST/play.html`
   and downloads the game data on first visit (watch the boot progress).
2. Pair the controller in Android Bluetooth settings (Switch Pro: hold the
   sync button; Xbox: Pair button; DualSense: PS + Create), or plug USB OTG.
3. Press any controller button, then **Connect / detect** in Controllers.
   The pad appears as a standard-layout device.
3. Options → **RUMBLE** controls gamepad + handset vibration; **Test rumble**
   verifies the path without starting a match.

## Offline play (download once, update on change)

The first online visit persists the game data on the phone: the source
manifest plus every downloaded asset range in Cache Storage, keyed by disc
identity (`lib/hsd/asset-fetch.ts`). The app shell itself always ships in the
APK. Later launches with no network boot from that cache and replay
byte-identical ranges, so rollback hashes still match online peers. Small
files are downloaded whole once and sliced locally; the offline reader
(`cachedDiscReader` in `lib/hsd/server-source.ts`) slices the same whole-file
entries. If boot fails, the main menu shows a **Game data failed to load**
card with the exact cause and a **Retry** button.

- Nothing re-downloads while the server manifest identity is unchanged —
  an update retires the old caches and fetches fresh ranges automatically.
- If a fighter/stage was never opened online, offline boot names it and
  asks for one more online visit (ranges download on demand + in the
  background prefetch, so one full online session normally covers all).
- The offline cache holds the same streamed asset ranges the server
  allowlists, never the ISO itself.

## Updates: three independent layers

| Layer | What | Versioned by | Update needs | Publish with |
|---|---|---|---|---|
| ISO assets | fighters, stages, audio streamed from the server disc | per-asset SHA-256 in `/api/source` | nothing (automatic) | server deploy |
| Game code | HTML/JS/CSS/WASM (`dist-android/`) | `web-bundle.json`: bundle version + per-file SHA-256 | nothing: download + reload, **no reinstall** | operator's deployment tooling |
| Native shell | APK: WebView host, controllers, rumble, fullscreen, updater | `versionCode` | reinstall prompt | operator's deployment tooling |

Only native (Java/Android) changes need an APK; JS or asset changes reach phones
without reinstalling. Deployment automation is operator-specific and is not included
in the repository. Require passing typecheck/tests, validate the staged frontend and
relay together, and verify the deployed copies before announcing an update.

### ISO assets (content-addressed)

`server/iso-source.ts` adds `sha256` to every manifest file (persisted beside the ISO
in `.smash-asset-sha256.json`, rehashed only when either disc changes). The web cache
(`lib/hsd/asset-fetch.ts`) stores hashed assets under `content/<sha256>` in one shared
Cache Storage cache, so a disc identity change re-downloads only the files whose bytes
changed. Whole-file downloads are checked against the hash before use. Entries from
the older per-identity layout move to content keys the first time they are read, with
no re-download, and content entries the manifest no longer lists are pruned.

### Game code bundles

`npm run android:web` (also part of `android:build`) writes
`dist-android/web-bundle.json`: `version` (seconds), `label`, `shellApi` and
`files: {"/play.html": {"sha256", "size"}, …}` (source maps excluded).
`scripts/web-bundle-manifest.ts` generates it; `ANDROID_SHELL_API` in
`web/src/android-bridge.ts` must match `WebBundles.SHELL_API` and is bumped when web
code needs a new native method.

The server exposes `GET /android/web/latest.json` and immutable
`GET /android/web/objects/<sha256>`. **By default the bundle is derived from the
deployed website build** (`server/web-bundle.ts`): the server hashes its static root
(source maps and symlinks excluded), takes `version` from `play.html`'s build time and
`shellApi` from the `smash-shell-api` meta that `vite.config.ts` stamps into every
build, and refreshes whenever `play.html` changes. Any site deploy — whatever script
or agent ran it — therefore reaches installed apps with no extra step. A bundle
published by hand into `SMASH_ANDROID_DIR/web/` (`publish-web.sh`) is served only while
its version is newer than the site build. The shell
(`android/app/src/main/java/dev/smashweb/play/WebBundles.java`):

- serves the newest compatible bundle: the downloaded one when its version beats the
  bundle packaged in the APK, else the packaged assets;
- on launch/resume (with the APK check), downloads only objects it does not hold,
  verifies each SHA-256, and stages the bundle as pending;
- when you are not in a match, asks **Reload now / Later**. Later (or a running
  match) applies it at the next launch; a page never mixes two bundles;
- skips bundles whose `shellApi` exceeds the shell, so the APK update arrives first;
- keeps working offline on the last activated bundle and deletes objects no bundle
  references.

Options → Downloaded data shows `app <version> · game <bundle>` and **Check for
updates** (APK first, then game code).

### Native shell (APK)

- **Versions:** every build gets a larger `versionCode` (minutes since the Unix
  epoch; `-PsmashVersionCode=N` overrides it) and a readable `versionName`
  (`yyyy.MM.dd-HHmm` UTC). Options → Downloaded data shows the installed build
  and a **Check for updates** button (native `window.SmashUpdate`).
- **Channel:** `server/http.ts` serves `GET /android/latest.json` and immutable
  `GET /android/smash-web-<versionCode>.apk` from `SMASH_ANDROID_DIR` (a
  host-only directory outside the code tree, so code/dist deploys never wipe
  releases; unset = 404). Nothing else under `/android/` is exposed and symlink
  escapes are refused (`tests/unit/android-release-server.test.ts`).

  ```json
  {"versionCode": 29826815, "versionName": "2026.09.17-0135",
   "apk": "smash-web-29826815.apk", "sha256": "<64 hex>", "size": 4473382}
  ```

- **Client** (`android/app/src/main/java/dev/smashweb/play/AppUpdater.java`):
  checks on launch and on resume (at most every 30 minutes). If the version is
  newer, it asks **Update / Later**, downloads into the app cache, and checks
  the exact size and SHA-256. It then installs through `PackageInstaller`.
  Android shows its own confirmation, and on first use asks once for
  **Install unknown apps → Allow from this source**; after that the update
  continues automatically. Android only accepts an update signed with the same
  key as the installed app. Install-status broadcasts require a
  signature-level permission, so other apps cannot inject a fake confirmation.
  Release builds only trust the https channel. Debug builds accept
  `--es SMASH_UPDATE_URL http://10.0.2.2:<port>/android/latest.json` (plain
  HTTP only to the emulator host alias) for local testing.
- **Signing key:** builds are signed with the local debug keystore
  (`~/.config/.android/debug.keystore` on the build machine). Losing it means
  phones must uninstall and reinstall once; keep a backup.
- Google Play Protect may ask to scan a sideloaded update; **More details →
  Install without scanning** (confirmed with the device PIN) installs it
  without uploading the app.

## LAN dev loop (no rebuild)

Point the installed shell at the trusted-LAN server instead of repackaging:

```sh
adb shell am start -n dev.smashweb.play/.MainActivity \
  --es SMASH_URL "http://<lan-host>:5273/play.html"
```

This serves the built browser code plus the curated ISO asset API only —
never the repository, ISO bytes for hashing stay client-side per guardrails.

## Limitations

- Gamepad input inside the shell is polled each web tick like the Gamepad
  API; exact Bluetooth latency and per-vendor trigger curves are hardware
  behavior, not something automated tests certify — verify on the target
  phone with the Controllers panel live test.
- Rumble waveforms are the same bounded dual-rumble approximations as
  desktop (see [lib/game/rumble.ts](../lib/game/rumble.ts)); durations and
  triggers mirror the original call sites, not the disc `LbRb.dat` tracks.
- Emulator system images (API 35 Play image in this SDK) carry no Bluetooth;
  validate real pads on hardware.
