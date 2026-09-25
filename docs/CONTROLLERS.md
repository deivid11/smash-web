# Local browser controllers

Open **Controllers** (or **Options → Controllers**) on the client that will play. The page supports controllers exposed by that client's **Gamepad API**, over USB or OS-managed Bluetooth. It does not connect a controller to the central game/asset server.

## Pairing and discovery

1. Pair the controller in the client's OS Bluetooth settings, or connect a USB cable/compatible adapter.
2. Put the controller in the appropriate pairing mode. Xbox normally uses its Pair button; DualShock 4 uses PS + Share; DualSense uses PS + Create. Older Xbox models may require USB/an adapter. Use the controller manufacturer's instructions if these differ.
3. Focus the game tab, press a controller button, and select **Connect / detect**. Browsers can hide controllers until user activation.
4. Confirm that an actual browser-connected device appears. Test its buttons/axes, verify its player assignment, then release all buttons and center its stick before resuming gameplay.

The panel includes Windows, macOS, Linux, Android and iOS OS-settings guidance. It never invokes server commands, installs drivers, silently pairs devices, or uses Web Bluetooth to impersonate a Gamepad connection. Gamepad API does not report whether a controller's underlying transport is Bluetooth or USB; “Browser connected” means only that the browser reports a connected gamepad.

Some browsers or embedding policies deny Gamepad API, especially on insecure LAN HTTP origins. The panel reports API absence and actual security/read errors. A top-level trusted HTTPS origin or localhost can help; keyboard and touch remain available. Retry discovery after changing permissions or connecting a device.

Mobile browsers and Android WebViews expose no Gamepad API at all, so phone-paired controllers need the native shell: see [ANDROID.md](ANDROID.md) (`npm run android:build`, minSdk 30 / targetSdk 36) for the APK that feeds phone-paired pads plus rumble through the `SmashPad` bridge.

## Automatic mapping and labels

Recognized Xbox, PlayStation, Nintendo and GameSir controllers with a valid **browser-standard** layout receive the Smash Bros. layout below: **A attacks, B specials, X / Y jump, bumpers grab, triggers shield, right stick smashes, Start pauses**. Nintendo pads label their positions the other way round (A east, B south), so their attack/special buttons swap to keep the labels true. GameSir pads use the Xbox face/shoulder layout, including modes that report generic codes under a GameSir ID; a GameSir in Xbox mode already arrives as an Xbox pad.

| Action | Physical standard button | Xbox | PlayStation | Nintendo |
| --- | --- | --- | --- | --- |
| Attack | South (Nintendo: east) | A | Cross | A |
| Special | East (Nintendo: south) | B | Circle | B |
| Jump | West or north | X / Y | Square / Triangle | Y / X |
| Grab | Either shoulder | LB / RB | L1 / R1 | L / R |
| Shield / dodge | Either trigger | LT / RT | L2 / R2 | ZL / ZR |
| Strong attack (spare smash button) | Right stick click | RS | R3 | Right stick click |
| Move / aim | Left stick or D-pad | Same | Same | Same |
| Smash attacks (C-stick) | Right-stick flick (hold to charge) | Same | Same | Same |
| Pause / resume (local match) | Start | Menu | Options | + |

A valid saved remap for the same capability key still wins over this default, so players who calibrated the older layout keep it.

Model identification and labels are best-effort hints from the browser's ID and mapping, not a hardware certification. Nintendo vendor ID `057e` is **not** treated as proof of a Wii model. Sony pads that only name themselves **Wireless Controller** (their Bluetooth name on Android, Linux and macOS) are identified as PlayStation; the Android shell also passes real USB/Bluetooth vendor/product ids, so any Sony `054c`, Microsoft `045e` or Nintendo `057e` pad is recognized there. **Every controller is automapped**: any valid standard layout (known brand, unknown brand or Wii-family adapter) sends gameplay input immediately, and a raw layout gets a best-guess mapping (see below). Raw controllers never acquire guessed face-button labels just because their ID mentions Xbox/PlayStation/Nintendo.

On an assigned browser-standard controller, Start / Menu (canonical button 9) works like Smash: in a local match it pauses and resumes (the Melee pause camera stays up; **L+R+A+Start** while paused quits to character select), on character/stage select it is READY TO FIGHT (see the floating hands below), and elsewhere — mode select, results, online matches — it toggles Game options. Its separate rising-edge state survives gameplay disable/enable transitions, so holding it cannot repeatedly reopen the menu. It is disabled during calibration or if button 9 is remapped to gameplay. Raw devices get no guessed menu binding; this UI action never enters network input. Local options pause through the existing UI, while online options keep the shared match running with neutral local controls.

Stick drift inside the configurable deadzone is suppressed; amplitude **outside** that deadzone is preserved. For example, standard input `-0.3` remains `-0.3`, so original-data walking thresholds are not replaced by a new movement curve. Invalid/nonfinite axes are neutralized.

Smash attacks work three ways, all firing the same original smash data and charge (60-frame, original multiplier): hold the Strong button with a direction, flick the right stick (grounded side/up/down, directional aerials in air — hold it to charge, release to unleash), or flick the left stick fast while pressing Attack (A). The left-stick windows reuse the original PlCo stick-timing thresholds also used for item throws (side: full 0.8 tilt within 6 frames of the slam; up/down: past ±0.6625 within 4 frames), so held directions keep tilts, run keeps the dash attack, and crouch keeps the down tilt. The C-stick never steers normal movement, tap-jumps, fast-falls, drops through platforms or steers specials. It counts for mash-outs. On a ledge it uses the native directional options: up attacks, toward the stage rolls, and away/down releases after neutral rearming; those releases are not also fired as aerial attacks.

## Nintendo Switch controllers

Switch pads are automapped to the Smash layout with their own labels kept true: **A attacks, B specials, X / Y jump, L / R grab, ZL / ZR shield, right stick smashes, right-stick click is Strong, Minus taunts, Plus pauses**.

- **Official pads** (Pro Controller, Joy-Con, charging grip, and pads that present themselves as one, such as 8BitDo in Switch mode): Chrome and Firefox remap them to the browser-standard layout themselves, and the Nintendo profile swaps Attack/Special so the printed A still attacks.
- **Licensed pads** (HORI HORIPAD / Pokkén pad, PowerA wired and Fusion pads, PDP Faceoff / Afterglow / Rock Candy) are recognized by USB id (`0f0d`, `20d6:a71x`, `0e6f:018x`) or by a HORI / PowerA / PDP name that mentions Switch, so they get the Nintendo profile too — without it their printed B would attack. The same brands' Xbox pads stay Xbox.
- **Raw Switch pads** (no browser remap) are mapped from their known button order instead of the generic guess: official pads report B 0, A 1, Y 2, X 3; licensed pads report Y 0, B 1, A 2, X 3; both continue L 4, R 5, ZL 6, ZR 7, Minus 8, Plus 9, stick clicks 10 / 11, Home 12, Capture 13. The right stick binds to axes 2 / 3 (2 / 5 where the driver lists all ten HID axes) only when both rest centered. Plus (9) opens pause/options exactly like Start. The panel still flags this mapping as automatic: remap it if a button is off.
- **Not covered:** a raw pad's D-pad usually arrives as a hat axis whose index and encoding differ per driver, so it stays unbound (the left stick navigates); calibrate it if you need it. A single sideways Joy-Con works only as far as the browser's own remap goes, Joy-Con pairs are not combined here, and identification is a best-effort reading of the ID string, not a hardware certification.

## Menu navigation (controller-only play)

Every menu is controller-navigable; mouse, touch and keyboard keep working:

- **Move focus:** D-pad or left stick (up/down/left/right, spatial so grids keep rows/columns, with hold-to-repeat).
- **Confirm:** A — the Attack button (Xbox A, PlayStation Cross, Nintendo A) activates the focused button, link, checkbox or details; it focuses text fields and dropdowns.
- **Back:** B — the Special button (Xbox B, PlayStation Circle, Nintendo B) closes the item switch, closes options, presses BACK, or returns from Rift Descent setup/intro/shop/endings. The first press blurs a text field; the second press goes back.
- **Options:** Start (outside character/stage select and local matches); View / Select (canonical button 8) on character and stage select.
- **Paused match:** right stick orbits the pause camera, RT / LT zoom, Start resumes, L+R+A+Start quits to character select. Holding both triggers keeps A from pressing Resume so the chord is safe.
- **Dropdowns/sliders:** left/right on a focused select or range changes its value (stocks, time, CPU level, item frequency, Rift length/wrath, music volume); up/down still moves focus.
- Covers mode select, LAN create/join and room setup, options/controllers, item switch, all Rift Descent screens (setup fighter grid/seed/length/wrath/heat/tower, branch cards, floor intro FIGHT, 1-of-3 boons, Charon shop, victory/gameover) and mid-match controls (pause, rematch, fighters, walk, HUD, options, fullscreen, pocket consumables, center-overlay start/resume/play-again).
- Any connected controller navigates the shared menus — slot assignment only gates gameplay, so a second pad can help before its seat exists. Mapped pads (including automapped and best-guess raw pads) navigate through their mapping; a standard-layout pad whose standard mapping cannot validate (too few buttons) falls back to raw standard indices for menus only, and stays neutral in gameplay until calibrated. Calibration pauses menu navigation so Listen captures stay unambiguous. Focus rings mirror `:focus-visible` under `.gamepad-focus` because programmatic focus does not always match it. The menu bar shows the connected pad (`🎮 XBOX · P1`) and the button legend.

### Floating hands on character and stage select

Character select (local and LAN) and stage select use Smash-style pointing hands instead of focus hopping ([web/src/play/menu-hands.ts](../web/src/play/menu-hands.ts)). Every connected controller gets its own hand, tinted with the player colour of its seat (its human ordinal picks the seat; a spare pad without a seat shows a grey 🎮 hand and still points and clicks, so a second player can set an OFF panel to HUMAN and take it):

- **Left stick** glides the hand — dead zone, ease-in curve, slower over targets; pushing into the top/bottom edge scrolls tall screens. The **D-pad** hops to the next control in that direction. A fingertip resting in a grid gap snaps to the nearest card.
- **A** picks what the hand points at: a fighter for the hand's seat, a player panel (carrying that seat's token, like Melee's CPU coin, so the next fighter goes to that seat), selects cycle, buttons press. **B** drops a carried token, otherwise goes BACK.
- **X / Y** cycle the seat's costume (or a hovered select); on stage select they pick a random stage. **LB / RB** switch the active seat. **Start** is READY TO FIGHT (CHOOSE STAGE, then start). **View / Select** opens options. The **right stick** scrolls.
- Hover lights the target in the hand's colour; a legend at the bottom shows the family's glyphs (A/B/X/Y, ✕/○/□/△, or Nintendo A/B/Y/X). Keyboard/programmatic focus warps the leading hand onto the focused control, so Tab and the hands never disagree; mouse and touch keep working underneath.
- Hands click the same DOM buttons a mouse would, so React callbacks keep owning every setup change. Dialogs, the item switch and Rift Descent's setup form keep focus navigation. Reappearing hands ignore buttons already held, so the press that closed a dialog never acts twice.

## Raw devices and calibration

A raw/nonstandard controller is automapped by best guess when it can be: left stick on axes 0/1 (only when they rest centered), the same Smash order as the standard layout — Attack 0, Special 1, Jump 2/3, Grab 4 (4/5 and Strong 11 when twelve or more buttons exist, otherwise Strong 5), Shield 6/7. The smash-stick and D-pad stay unbound because trigger axes and hats differ per driver. The panel says **Auto-mapped by best guess** — if buttons feel wrong, remap. Raw pads with fewer than seven buttons or no centered stick axes cannot be guessed and send no gameplay input until calibrated; saved raw profiles still require an explicit **Use saved profile** (capability keys can collide).

- Select **Calibrate raw buttons** or **Remap / calibrate**.
- Center the sticks first. Listen for left-stick horizontal movement, then move right. Center again; listen for left-stick vertical movement, then move up. Optionally bind the right (smash) stick the same way, or clear it to leave C-stick flicks unbound.
- For controllers without usable stick axes, bind **all four D-pad directions** instead. This supports axisless raw layouts without assuming Wii button indices.
- Listen for Jump, Quick, Strong, Special, Shield and Grab. Walk is optional. Press one button at a time; already-held buttons must be released and pressed again.
- Rebinding a button deliberately removes its former assignment. A physical button cannot silently fire two gameplay actions. Missing essential actions or movement prevent saving.
- Save and inspect the live button/axis test before playing. Gameplay input stays neutral while calibration is open.

Wii remotes, Wii U/Classic controllers, attachments and adapters often require OS-specific drivers/translation software and may not appear in Gamepad API at all. Those drivers are not provided here. The panel does not combine Joy-Con into a virtual controller or claim that all Wii hardware is supported.

## Assignments and reconnects

- Solo / one-human play uses **one local human control source**. Local play supports **one to eight local human sources**; CPU and OFF seats do not consume a source.
- Online always uses **one local human source**, regardless of the total human/CPU seat count. Other humans' controllers belong to their own browsers.
- An all-CPU local exhibition keeps one **menu-only** source. The host ignores gameplay vectors; Menu / Options (standard button 9) can still open options on an assigned, confirmed controller while gameplay is disabled. Calibration/remapping rules for button 9 still apply.
- Source numbers are **human ordinals**, not fighter seat numbers. For HUMAN seats P3 and P6, input source 0 belongs to P3 and source 1 to P6; the session owns that mapping. The controller hub never maps CPU/OFF seats itself. Optional panel labels can show actual fighter seats without changing numeric source assignments.
- The first two human ordinals retain the existing two keyboard layouts. Touch UI belongs to the first human. Extra humans require independently exposed controllers. Eight mocked sources are supported by the adapter; **eight physical gamepads are not guaranteed**. Browser, OS, adapter and hardware limits may expose fewer devices.
- Assignments reserve a browser index/session descriptor, not the compacted order of connected pads. Disconnecting human 1 does not turn human 2 into human 1.
- A reconnect at the same index retains its reservation and waits for neutral controls. If the browser changes the index, assign the device manually or forget its old disconnected reservation.
- Gamepad API has no persistent physical UUID. Identical controllers cannot be reliably distinguished across arbitrary reconnects/browser restarts; no such identity persistence is claimed.
- Explicitly unassigned devices stay unassigned. Expanding from one to eight human sources automatically assigns eligible waiting pads to available ordinals, without overriding manual bindings or disconnected reservations. Shrinking to one leaves sources 2–8 reserved but inactive; expanding again restores those reservations without shifting anyone. Inactive reservations cannot trigger Menu / Options, and holding Menu during expansion is not a new button press.
- Buffered button taps survive a stalled online input tick until that tick actually consumes them. Disconnect, reassignment, menu transitions and disabled input clear latches to prevent stuck buttons.

## Input and panel API

[web/src/input/controller-hub.ts](../web/src/input/controller-hub.ts) exports `LocalControllerCount` (`1 | 2 | 3 | 4 | 5 | 6 | 7 | 8`), `MAX_LOCAL_CONTROLLERS` (8), and `LocalControllerInputs` (`[PlayerInput, PlayerInput, ...PlayerInput[]]`). `ControllerSnapshot.localPlayerCount` and `ControllerHub.setLocalPlayerCount` use that count; runtime calls reject non-integers and values outside 1–8. `inputs(consume = true)` returns exactly `max(2, localCount)` entries, with the padded second entry neutral for one local source.

[web/src/play-input.ts](../web/src/play-input.ts) exposes the same `setLocalPlayerCount` and tuple shape from `poll(consume = true)`. The deprecated `playerCount` field is retained as host metadata only: total simulated/remote players do not size local inputs. `poll(false)` retains keyboard and gamepad tap latches across delayed online ticks; `consumeLatches()` clears them only after the host accepts the input. Actual count changes clear stale keyboard/touch/controller state; a no-op count setter does not consume pending taps. Controller neutral-release gating remains in place after mode changes.

[web/src/play/controller-panel.tsx](../web/src/play/controller-panel.tsx) accepts `{ hub, online, localCount, spectating?: boolean, slotLabels?: readonly string[] }`. `online` forces one local source; local `spectating` forces one menu-only source and explains that CPU fighters ignore gameplay controls. The host must enforce this by ignoring gameplay vectors / disabling gameplay input, while continuing render scans so Menu works. `slotLabels[ordinal]` is an optional escaped, bounded display label such as `P3 / Fox`; numeric assignment values remain ordinals. The panel does not own actual fighter-seat mapping.

Focused mocked-input/structural UI coverage is in [tests/unit/controllers.test.ts](../tests/unit/controllers.test.ts), [tests/unit/play-input-controllers.test.ts](../tests/unit/play-input-controllers.test.ts), [tests/unit/controller-panel.test.ts](../tests/unit/controller-panel.test.ts), and the controller case in [tests/unit/player-capacity.test.ts](../tests/unit/player-capacity.test.ts). This includes sparse eight-pad discovery, 1→8→1→8 reservations, disconnection, manual unassignment, inactive Menu suppression, deferred latch consumption and exhibition explanation. Structural rendering tests do not establish browser layout or physical hardware behavior.

## Storage, privacy and scope

At most 16 validated mappings are stored under `smash.controller-mappings.v1` in localStorage (bounded versioned schema; no raw device ID, serial number, Bluetooth address or identity data). Capability keys contain only model family, standard/raw layout and button/axis counts. These keys can collide for unrelated raw hardware, so saved raw profiles always require explicit confirmation in a new controller session. Invalid or unavailable storage does not disable keyboard/touch or an already-calibrated session mapping.

Sampling occurs every gameplay poll/render scan. Only diagnostic React snapshots are throttled to 10 Hz; controller input itself is not delayed by that UI limit. This is an input adapter for the limited playable source-port prototype, not a replacement gameplay engine or a claim of original controller timing/cross-browser equivalence.

Automated tests use mocked browser records and actual application gameplay. They verify profile recognition, finite/deadzone handling, preserved analog amplitude, calibration (including axisless D-pad), stable assignments, reconnection safety, permissions fallback and menu/online integration. They do **not** establish successful physical Bluetooth pairing on every controller/OS/browser combination. Physical hardware should be verified with the live test on the intended client.

## Touch layout

[web/src/play/touch-controls.tsx](../web/src/play/touch-controls.tsx) renders a floating analog stick (base appears under the first touch anywhere in the left half, 64 px travel, 10% dead zone, response curve so roughly 20-55 px of travel walks and a full push runs, and the base follows the thumb when it travels past the radius) that feeds `PlayInput.setStick` as the first human's analog axes, merged like a gamepad stick, and a six-button cluster mapped to the P1 key codes (Space, J, K, L, U, I). The cluster tracks pointers by id so fingers can slide between buttons and hold several at once; taps stay latched until the next simulation tick. Portrait viewports reserve a bottom panel (`--touch-panel`) so the arena, HUD and controls never overlap. Browser tests drive the stick with synthetic pointer events through [tests/server-browser/helpers/touch.ts](../tests/server-browser/helpers/touch.ts).
