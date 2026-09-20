# Legal guidance for users and operators

This document is practical guidance written by the project, **not legal advice**. No
notice, disclaimer or configuration in this repository makes an infringing use lawful.
Laws differ by country; if you plan to run a host that strangers can reach, talk to a
lawyer first. The short legal notice lives in the [README](../README.md#legal-notice-and-intended-use).

## 1. What this project is

A non-profit **fan project**: an independent, unofficial, noncommercial research prototype
made by fans out of appreciation for the original game. Being a fan project is a statement
of intent, not a legal defence — it grants no rights in anyone's material. It is not affiliated with,
authorized, sponsored or endorsed by Nintendo, HAL Laboratory, Sega, Capcom, the
doldecomp/melee contributors, the ACE/Akaneia/m-ex authors, or any other rightsholder.
"Super Smash Bros.", "Melee" and every character, stage and music name are trademarks
or copyrighted works of their owners and are used here only to describe compatibility.

The project's own source code is what this repository contains. It contains **no** disc
image, game asset, original executable or compiled upstream code, and it grants no right
to any of them.

## 2. The four kinds of material, and who may distribute them

| Material | In this repository? | Status |
| --- | --- | --- |
| Project source (TypeScript, scripts, docs) | Yes | The authors' own work, licensed under the [PolyForm Noncommercial License 1.0.0](../LICENSE.md): free to use, modify and share for noncommercial purposes; no commercial use. |
| Game assets (models, textures, animations, audio, music) | No | Owned by the rightsholders. Owning a disc does not give you the right to pass them to anyone else. |
| Compiled gameplay WASM (`web/public/wasm/`) | No (built locally) | Compiled from the doldecomp/melee decompilation, which is derived from the original game code. Building it for yourself is a research act; **serving it to the public is distribution of a derivative work** and "bring your own disc" does not cover it. |
| ACE 2.0 extension content | No | A third-party mod with no redistribution licence, including characters owned by other companies. Same rules as game assets. |

## 3. Disc modes and what each one means legally

Set in `.env` (see [.env.example](../.env.example) and [SERVER_SOURCE.md](SERVER_SOURCE.md)).

| Mode | What the host sends | Appropriate for |
| --- | --- | --- |
| `SMASH_DISC_SOURCE=server` | Your code **and game assets** streamed from your ISO | Your own devices and a trusted private LAN only. On a public address this is distribution of copyrighted assets to everyone who connects. |
| `SMASH_DISC_SOURCE=client` | Your code only; every player reads their own ISO inside their browser, nothing is uploaded | Any host reachable by people other than you. |

Important limits of `client` mode:

- It removes asset distribution. It does **not** remove the compiled-WASM question above.
- Browsers that downloaded assets while the host ran in `server` mode keep working from
  that stored data. That is a deliberate convenience, and it means copies you distributed
  earlier stay in use. If you want a clean break, tell those players to clear the site's
  data (or ask for the purge-on-switch behaviour to be enabled) — switching modes does not
  undo an earlier distribution.
- Never link to, host, describe how to find, or accept uploads of disc images. Players
  must use a copy they lawfully own and dumped themselves; whether dumping is permitted
  depends on their country.

## 4. Operator checklist

Private use (you, your household, a LAN party of friends): either mode; keep the port off
the Internet.

Anything reachable from the Internet:

1. `SMASH_DISC_SOURCE=client`. Never expose a `server`-mode host publicly.
2. **No money.** No paid accounts, entry fees, prize pools, ads, sponsorships, donations
   or merchandise tied to the service. Monetization is the single biggest escalation of
   risk.
3. Prefer invite-only access (VPN, allowlist, shared password at the proxy) over an open
   public site. Do not advertise it.
4. Do not present it as an official or licensed product. Keep the "unofficial research
   prototype" wording visible. Avoid rightsholder logos, box art and official artwork in
   pages, social posts or store listings.
5. Do not distribute prebuilt packages that embed third-party material: no APKs with
   packed assets (`pack:tv-assets` output), no `dist/` containing the WASM, no asset
   caches, no Docker images with an ISO.
6. Publish a contact address and act on rightsholder requests immediately (section 8).
7. Publish a privacy notice if accounts, telemetry or voice are enabled (section 6).

## 5. Multiplayer, rooms and tournaments

The relay forwards controller inputs, state hashes and room messages between browsers.
It runs no game logic and carries no game assets; each browser simulates the match from
its own data. It does not re-implement any rightsholder's online service. On its own it
is the least sensitive part of the system.

What raises the profile is organized play. Rightsholders — Nintendo in particular — have
acted against unlicensed competitive events and against tournaments using modified or
emulated versions of this game, and publish community tournament guidelines that exclude
modified software. Therefore:

- Keep brackets private and among friends. Do not run public, advertised, streamed-for-
  profit or prize events on this software.
- Do not charge entry or offer prizes.
- Do not use rightsholder trademarks to name or promote an event.

## 6. Personal data (accounts, friends, telemetry, voice)

Operating a host with accounts makes **you** responsible for that data (in Mexico under
the LFPDPPP; under GDPR/UK GDPR if people in Europe use it; under COPPA-style rules if
children do). What the software handles:

| Data | Where | Notes |
| --- | --- | --- |
| Username, display name, avatar, title | SQLite (`SMASH_DB_PATH`) | No e-mail address or real name is requested. |
| Password | SQLite | Stored only as a salted scrypt hash. Session tokens are stored hashed. |
| Cloud saves, match history, friendships | SQLite | Deleted with the account (cascade). |
| Presence, room invites | Memory only | Lost on restart. |
| Performance telemetry (`/api/perf`) | JSONL files (`SMASH_PERF_DIR`) | Device/performance figures; disable with `SMASH_PERF_DIR=off`. |
| Visit and usage statistics (`/api/visit`) | SQLite (`SMASH_ANALYTICS_DB`) | Pseudonymous, not anonymous. One row per page visit: a random visitor number generated by the browser, page class (never the path), device class and browser family (never the user-agent string), screen size, language, time zone, referring site host (never its URL), a short campaign tag, load time, and which modes/stages/fighters were played. Event types and fields are allowlisted; no name, account, inputs, chat or error text. No raw IP address is stored: only a hash under a salt that rotates daily, so it cannot link days. Browsers sending Do-Not-Track/GPC are stored with neither visitor number nor address hash. Players can switch it off in Options → Privacy, which stops reporting and deletes the browser's visitor number but not rows already stored — the operator deletes those on request. `SMASH_ANALYTICS_DB=off` disables it. |
| IP addresses | Your reverse proxy / server logs | Set a short retention. |
| Voice chat | Peer-to-peer WebRTC, never recorded or stored by the host | Participants' IP addresses are visible to the other participants of the same call. A TURN relay, if configured, sees encrypted traffic. |

Minimum duties for a host that others use:

- A short privacy notice stating who operates the host, what the table above says, why
  it is kept, how long, and a contact for access/correction/deletion requests.
- A working deletion path: users can delete their own account in the PROFILE screen
  (`DELETE /api/account`); honour manual requests too.
- State a minimum age (13+, or 16+ where GDPR applies without parental consent) or keep
  the host invite-only among people you know. Voice chat with strangers has no moderation
  tools; keep voice to friends/invited parties.
- Keep the database outside the web root, back it up privately, serve only over HTTPS on
  public addresses, and disable what you do not need: `SMASH_DB_PATH=off` removes accounts
  entirely.

## 7. Contributors

- Contribute only code you wrote. Never commit disc images, extracted assets, reference
  executables, compiled upstream code, asset caches or private reports (see
  [CONTRIBUTING.md](../CONTRIBUTING.md)).
- Do not paste decompiled or disassembled code from sources whose terms forbid it, and
  never anything from leaked proprietary material.
- Ported behaviour must cite its public source (the pinned doldecomp/melee revision or a
  documented format reference) in [third_party/NOTICE.md](../third_party/NOTICE.md).

## 8. Rightsholder requests

If you own rights in material you believe this project or a host running it misuses,
contact the operator of that host (and the repository owner for repository content).
Operators should comply promptly: take the host offline or remove the material first,
discuss afterwards. The project does not contest takedown requests from the owners of
the game.

## 9. No warranty

The software is provided "as is", without warranty of any kind, express or implied,
including merchantability, fitness for a particular purpose and non-infringement. The
authors are not liable for any claim, damages or other liability arising from its use.
Each user and operator is solely responsible for ensuring that their own use complies
with the law and with the licences of any material they supply.
