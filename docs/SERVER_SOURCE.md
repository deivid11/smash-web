# Server ISO source, browser rendering

The user requested that the ISO stay on the server while each browser renders the game assets. The server now verifies and opens the ISO once, serves the compiled application, and delivers only the model/animation ranges needed by the viewer.

```text
Server                                      Browser
private ISO (read-only)
  ├─ verify version + executable SHA-1
  ├─ identify 21 approved runtime resources
  └─ bounded HTTP asset ranges ────────────→ HSD parsing + texture decoding
                                             └─ animation + Three.js/WebGL
```

No local ISO selection is needed in server mode. This is **not** video streaming or server-side rendering. Moving the camera, advancing animation frames, and rendering pixels do not require per-frame server requests. The playable prototype now runs local combat/physics in the browser; the asset server still does not run game simulation or multiplayer netcode.

## Launch

From the repository root, with the existing port free:

```sh
npm run build
npm run serve
```

The default is `0.0.0.0:5273`. The landing page redirects to the playable prototype at `/play.html`; the automatic asset viewer remains at `/viewer.html`. The port lab remains available at `/index.html`.

Configuration:

| Variable | Meaning |
| --- | --- |
| `SMASH_DISC_SOURCE` | `server` (default): this host streams the allowlisted assets of its own verified ISO. `client`: players must select their own ISO in the browser; see [Client-disc mode](#client-disc-mode). |
| `SMASH_CLIENT_ACE` | Client-disc mode only. `optional` (default), `required`, or `off`: whether players may, must, or cannot add the ACE 2.0 extension ISO. |
| `MELEE_ISO` | Explicit server ISO path. Relative paths resolve from the project root. |
| `MELEE_ACE_ISO` | Optional ACE 2.0 extension ISO for server mode. Unset = original roster only. |
| `MELEE_LOOK_ISO` | Optional cosmetic look disc for server mode (currently Animelee Complete Edition); see [Cosmetic looks](#cosmetic-looks). `MELEE_ISO` must then be the original disc. |
| `SMASH_HOST` | Bind address, default `0.0.0.0`. |
| `SMASH_PORT` | Port, default `5273`. |
| `SMASH_ALLOWED_HOSTS` | Additional permitted DNS hostnames, comma-separated. Literal IP addresses, localhost, and this machine's hostname are accepted by default. |

`npm run serve` also loads an optional repository-root `.env` (ignored by Git; template in [.env.example](../.env.example)); variables already present in the environment win.

Without `MELEE_ISO`, the server uses the local ISO path recorded in [private/disc-report.json](../private/disc-report.json). That report is not itself served. Startup fails before listening if the ISO/version/executable cannot be verified or a required asset is missing.

The current managed user service is named `smash-web-server`; it replaced the static-only `smash-web-lan` service. It is a transient user service, not a boot-enabled installation. For ordinary manual use, `npm run serve` is sufficient; do not start a second process on the same port.

## Client-disc mode

With `SMASH_DISC_SOURCE=client` the host opens **no ISO**: `MELEE_ISO`/`MELEE_ACE_ISO` are ignored, `GET /api/source` answers `{"version":1,"mode":"client","ace":"…"}` with no disc identity or file table, and every `/api/assets/NAME` is a `404`. The play and viewer pages receive an extra `<meta name="smash-disc" content="client" data-ace="…">` marker.

On that marker the play page holds boot on a disc gate ([web/src/play/disc-gate.tsx](../web/src/play/disc-gate.tsx)): the original USA v1.02 ISO is always required, and the ACE 2.0 ISO is optional, required, or hidden per `SMASH_CLIENT_ACE`. Both files are verified by executable SHA-1 and read in the browser only ([lib/hsd/local-source.ts](../lib/hsd/local-source.ts)); nothing is uploaded or downloaded. After the first load the game files this project uses (not the disc image; roughly 220 MB, or 390 MB with ACE) are saved in the browser's own storage, manifest last, so reloads and later visits boot from that copy without asking again. An interrupted save is discarded and the disc is asked for once more; `/play.html?disc` forces the disc screen (for example to add the ACE disc later) and Options → Clear downloaded data forgets the copy. Without the ACE disc only the original roster is available.

Players who downloaded game data while the host still ran in `server` mode are **not** asked for a disc: the play page boots from that stored data first (the same cache-only reader as offline play), and opens the disc gate only when nothing usable is stored. Stored data is partial by nature — only the fighters and stages that player had downloaded load; the rest report a load failure. `/play.html?disc` forces the gate so such a player can switch to their own ISO. Clearing site data removes the stored copy and brings the gate back.

The local manifest lists the same names, order, and rebased extension offsets as the server's, so the content fingerprint equals that of a server streaming the same discs. Online rooms therefore match only players who loaded the same disc set (original-only and original + ACE do not mix). The bundled Android/TV shell has no disc picker and needs a `server` host.

## Cosmetic looks

A host may offer a player-selectable **look**: alternate bytes for some allowlisted assets, served on top of the verified original disc. The only look this build knows is Animelee Complete Edition, a third-party cel-shaded mod applied to NTSC 1.02 (identical executable). [lib/hsd/looks.ts](../lib/hsd/looks.ts) pins 137 files as `[original SHA-256, Animelee SHA-256]`: stages, costumes, `EfCoData.dat`, the fighter files it rebuilt for article/hat models, and two Kirby hat archives.

- **Server.** With `MELEE_LOOK_ISO` the server opens that disc read-only and offers only files whose original *and* look bytes match their pins. It lists them under `looks` in `/api/source`, in the look disc's own address space, and serves them as `/api/assets/look/<id>/<name>`. The disc table (`files`) stays the original's. A look disc that matches no pinned file stops startup.
- **Client.** Options → Display → LOOK stores the choice per browser (`localStorage` key `smash-web.look`). With nothing stored, the host's first look is used; `original` keeps the disc art. A change applies on the next page load, and portraits are cached separately per look. Offline boots reuse the stored choice; look files are cached by their own content hashes, so switching back and forth downloads nothing twice.
- **Cosmetic only.** The room fingerprint is computed from the original disc table, so players with either look share rooms. The simulation must therefore read identical data. `tests/unit/look-real.test.ts` (needs `MELEE_DISC_PATH` and `MELEE_LOOK_DISC_PATH`) checks the pins and every parsed core/fighter/stage table; only render-model skeletons of articles, hats and the stage model may differ. It also replays CPU matches on the five restyled stages and requires identical state hashes with and without the look.
- **Known adjustments.** Animelee's rebuilt costumes drop the CLASSICAL_SCALE joint flag, which changes how scale inherits and so moves hurtboxes. The client restores the original disc's bit per joint (pinned masks; `lookModelPatch`) and keeps Animelee's meshes, materials and skinning flags. Poses can therefore differ slightly from Animelee's own renders when an animation scales a joint. `PlNsBu.dat` and `PlNsGr.dat` are excluded (their skeletons drift by about 4e-6). ACE fighters keep their own art.
- **Limitations.** This is not the Dolphin HD texture pack, and it is not equivalent to Animelee on Dolphin. Client-disc hosts (`SMASH_DISC_SOURCE=client`) offer no looks. Serving the mod redistributes Nintendo-derived data in the same way as the base assets, and remains the host operator's decision.

## Read-only API

### `GET /api/source`

Returns protocol version 1, game identity, verified executable SHA-1, and the 21 allowlisted runtime entries (defined by `SERVER_ASSETS` in [lib/hsd/source-protocol.ts](../lib/hsd/source-protocol.ts)). The first ten remain the required viewer baseline; common gameplay, effects, and audio are additional capabilities. The four newest exact resources are original menu/Battlefield/Final Destination HPS music and the US character narrator bank; see [docs/MENU_AUDIO_STAGES.md](MENU_AUDIO_STAGES.md). No host paths, full disc index, original executable bytes, or private report are returned.

### `GET /api/assets/NAME`

Returns bytes of an explicitly allowed asset. The browser uses a single HTTP `Range` header such as `bytes=0-255`. Successful partial responses return `206`, exact `Content-Range`/`Content-Length`, and `Cache-Control: private, no-store`.

Both whole-asset and range requests are bounded to 16 MiB per response. Single bounded/open-ended/suffix ranges are supported; multiple, malformed, or unsatisfiable ranges return `416`. There are at most eight active asset responses and 64 connections, with bounded timeouts. This is not a production traffic-abuse protection system.

Allowlist:

- Battlefield, Final Destination, and Yoshi's Story archives.
- Mario trophy archive.
- Fox/Mario/Kirby model, fighter metadata, and animation archives (Kirby's copy-ability and costume archives are not exposed).
- Common gameplay/bone-map data, Fox/Mario/Kirby effect archives, and the US main/Fox/Mario/Kirby SSM banks plus the US SEM table.

The exact names are defined in [lib/hsd/source-protocol.ts](../lib/hsd/source-protocol.ts). The API is not a general-purpose disc reader. There is no full-ISO download, offset-based arbitrary-disc endpoint, filesystem browser, upload route, original executable route, or route for unrelated stage/music files.

`HEAD` works without reading asset data. Write/upload methods return `405`. Unlisted files and private paths return `404`. Unexpected Host/origin values are rejected. Static file serving is limited to the compiled viewer/lab and known code/notice directories, with real-path containment checks that also reject symlink escapes.

## Browser behavior

The asset server injects a non-secret HTML marker into the viewer page. That marker enables automatic `/api/source` discovery and initial Battlefield/Fox/Mario loading. Static-only Vite builds have no marker, so they keep the existing local file picker without making failing API probes.

[lib/hsd/server-source.ts](../lib/hsd/server-source.ts) adapts named HTTP ranges to the existing bounded asset reader. It validates the source manifest, forbids reads outside the exposed assets, and checks returned byte ranges/lengths. HSD parsing and rendering code is shared between server and local modes.

The UI labels the active source. The optional local-file button still works, without uploading its input. A missing/failed server asset produces an explicit error rather than a fake rendered scene.

## Verification

- **241 unit tests passed**, including manifest validation, byte-range parsing, bounded reads, private-path/symlink denial, method/Host/origin guards, error sanitization, and concurrent-read limits.
- **14 local/static browser tests passed** with the real ISO supplied.
- **19 server-backed Chromium tests passed**, including playable input, specials and original-audio checks, and covering automatic loading without a File object, original asset rendering, partial animation requests, frame seeking without network requests, blocked routes, transport failures, and optional local-mode fallback.
- Live testing through the LAN HTTP address also passed: **zero browser-selected files**, seven asset requests, **1,752,829 bytes of game asset data** for the default scene. Browser code and metadata are additional transfers. The complete disc is 1,459,978,240 bytes and is not downloaded.

Run the integration suite against a real configured ISO:

```sh
npm run check
npm run test:server-browser
```

The server suite uses loopback port 5274 and the built application. `MELEE_DISC_PATH` can supply the ISO to both test suites; the server suite also supports `MELEE_ISO` or the private import report. `SMASH_SERVER_ARTIFACT_DIR` selects an external screenshot directory.

## Trust and rights boundary

This is a **trusted-LAN service with no authentication**, not an Internet deployment. Clients on the allowed network can request and save the allowlisted asset data; streaming it does not prevent copying. Do not publicly expose the service without addressing authentication, TLS, abuse protection, and rights to distribute the assets.

Game assets remain excluded from Git and the static build. Serving selected assets at runtime was explicitly requested by the user; it does not grant any broader Nintendo/HAL redistribution rights. The full ISO, private reports, machine configuration, and unrelated disc files remain unavailable through HTTP.

## Play-mode transport

The play session wraps `fetch` with the middleware in [lib/hsd/server-source.ts](../lib/hsd/server-source.ts)'s sibling [lib/hsd/asset-fetch.ts](../lib/hsd/asset-fetch.ts): whole-file coalescing for assets up to 2 MiB and a Cache Storage cache keyed by disc identity. The HTTP API is unchanged; the server additionally compresses static files (Brotli/gzip), emits strong ETags with 304 revalidation, and marks hashed bundles immutable. See [PERFORMANCE.md](PERFORMANCE.md).
