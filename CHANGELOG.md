# @typecad/ui

## 1.0.0-alpha.17

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @typecad/cuttlefish@1.0.0-alpha.17

## 1.0.0-alpha.16

### Patch Changes

- Updated dependencies
  - @typecad/cuttlefish@1.0.0-alpha.16

## 1.0.0-alpha.15

### Minor Changes

- fbd0820: Remove the Arduino wiring-compat layer and migrate the runtimes onto a
  thin-HAL clock contract.
  
  Wiring compat deleted: the Zephyr strategy no longer detects or shims bare
  wiring calls — pinMode/digitalWrite (and the INPUT/OUTPUT/INPUT_PULLUP/
  HIGH/LOW #defines they needed), pulseIn/pulseInLong (__tc_wiring_pulse_in),
  and the bare shiftOut/shiftIn shims are gone; the ambient detector now only
  carries the live APIs (random/randomSeed, noInterrupts/interrupts). The
  free-function pwmWrite/tonePlay/toneStop/wdtEnable/wdtReset/httpSendStart
  stubs and their plugin cases are removed, and with them the orphaned
  pwm.write, tone.play and tone.stop op kinds end-to-end (IR union, kinds
  registry, lowering, manifest, peripheral-usage, capability/validation arms).
  http.send_start stays — the async state machine produces it directly for
  awaited HTTP. Pin-capability and mode-validation now key on the thin
  pwm.set_pulse/set_duty/set_period/tone ops.
  
  safety: the pin-mode intercept is rebuilt on the thin HAL — v3 scans
  gpio.configure/gpio.read_cfg flag tokens (pure token lists only; runtime
  expressions record Unknown; open-drain counts as Output) and injects the
  same safety.record_pin_mode companion, so safe.read's mode verification
  works again on thin-HAL programs.
  
  Runtime clock contract: millis() is replaced by __tc_now_ms() — Zephyr
  defines it as k_uptime_get_32(), native as a steady_clock count, and the
  async/promise runtimes, cooperative scheduler, and the UI per-frame tick
  all lower onto it via currentTimeMillis(). The micros/map/constrain shims
  and their gating machinery are deleted. The UI runtime header now declares
  the clock extern and carries its own __ui_constrain clamp instead of
  calling the Arduino-named helpers; the byte-identity baseline is
  regenerated. Programs that can never read the clock get the definition
  stripped from the emitted header.

### Patch Changes

- fbd0820: Legacy-HAL removal Phase 1a — the remaining Arduino UI demos ported to Zephyr, with three engine bugs the ports surfaced and fixed:
  
  **New Zephyr demos** (each transpiles AND full west-builds for `esp32s3_devkitc`):
  - **`demos/zephyr-ui`** — the framework-zephyr port of demo-ui: the showcase.ui + neobrutalism theme on the shared ST7796S + FT6336U rig. The largest UI program yet compiled on Zephyr — lists, forms, canvases, keyframe animations, navigation.
  - **`demos/zephyr-weather`** — port of demo-weather: the BME688-style weather dashboard with ui.signal bindings + setInterval polling.
  - Scope note: **demo-ui-sd13 is NOT ported** — the ssd1306-zephyr profile deliberately has no CuttlefishGFX mono UI adapter ("direct display.* only" per the manifest), so a `.ui` entry cannot target mono on Zephyr. Porting it means writing that adapter (~1–2 days + hardware validation); recorded as deferred rather than half-shipped.
  
  **Engine fixes the ports forced**:
  1. **Zephyr console lowering** (`framework-zephyr/src/strategy.ts`): multi-arg `console.log('tapped:', i)` lowered to `printk("%s%s%s\n", …)` assuming every fragment was a string — a numeric list-bind index failed `-Wformat` and broke the west build. Now routes through the `__tc_print`/`__tc_println` shim overloads (const char*, double), which accept any rendered scalar without format-specifier coupling; the shim helpers are emitted unconditionally (they were gated on analysis flags absent in pure-UI programs).
  2. **Keyframe-table link collision** (`packages/ui/src/ui-engine/ui-lowering.ts`): modules sharing a stylesheet register identical animation names, so two mounted modules emitted identically-named `static const UIKeyframeStop` arrays into one TU — a hard redefinition error. Keyframe symbols are now namespaced per module (stable path hash) and deduped by animation name within a module; the set-index table references follow.
  3. The `__tc_println` chain emits proper statement separators (first attempt emitted adjacent calls without semicolons — caught by the same west build).
  
  Regression-verified: demo-shadcn, zephyr-display, and zephyr-debug all still build after the engine changes.
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies [5f587c7]
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies
- Updated dependencies [5f587c7]
- Updated dependencies [fbd0820]
- Updated dependencies [a9bcb6e]
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies [a9bcb6e]
- Updated dependencies
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies [5f587c7]
- Updated dependencies [fbd0820]
- Updated dependencies [0fc2d1f]
- Updated dependencies [b3d1c4b]
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies [e15fb1c]
- Updated dependencies [a9bcb6e]
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies [92c1bc6]
- Updated dependencies
- Updated dependencies [e15fb1c]
- Updated dependencies [a9bcb6e]
- Updated dependencies [a9bcb6e]
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies [a9bcb6e]
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies [fbd0820]
- Updated dependencies [a9bcb6e]
- Updated dependencies [fbd0820]
  - @typecad/cuttlefish@1.0.0-alpha.15

## 1.0.0-alpha.14

### Minor Changes

- ## Display integration wizard (`npx @typecad/ui --config`)
  
  Installing `@typecad/ui` used to leave a gap: integrating a display requires
  choosing hardware (panel, bus, pins, speed, touch) and writing the
  `display` section of `cuttlefish.config.ts` by hand. The package now ships a
  `typecad-ui` bin, so the flow after `npm install @typecad/ui` is:
  
  ```bash
  npx @typecad/ui --config
  ```
  
  ### What it does
  
  - **Display selection** with hardware-aware defaults: the built-in profiles
    (`ili9341-spi`, `st7796-spi`, `ssd1309-i2c`), the desktop SDL simulator, or a
    fully custom driver (name, bus, resolution, color format).
  - **Bus wiring questions** — SPI (CS/DC/RST/backlight, frequency in MHz,
    optional SCK/MOSI/MISO override) or I2C (address, optional reset pin),
    prefilled from any existing `display` section on re-runs.
  - **Orientation + rendering** — rotation, antialiasing, and an advanced color
    branch (color order / inversion). ST7796S keeps the demos' proven `bgr` +
    non-inverted defaults.
  - **Touch** — none, resistive (XPT2046 / STMPE610 / 4-wire analog), capacitive
    (FT6336U / GT911 / CST816S), or a custom adapter file, each with its pins,
    I2C address/speed, IRQ/reset, and calibration (raw-ADC defaults for
    resistive, native-panel pixel space for capacitive — matching the demos).
  - **Theme hooks** — optional `themeCss` / `themeClass`.
  
  ### How it writes the config
  
  The `display` section is spliced into `cuttlefish.config.ts` through the
  TypeScript AST: only that section changes, every other section and its
  comments survive byte-for-byte, unmanaged display keys (`scroll`,
  `scanlineSync`, …) are carried over, and the edited file is syntax-checked
  before anything is written. GPIO collisions between display and touch wiring
  warn before the write. If the config's `entry` points at a missing `.ui`
  file, the wizard offers a documented-syntax starter screen, then prints the
  exact `arduino-cli lib install` (with the real Library Manager names —
  `RAK14014-FT6336U` for FT6336U, the ST7735/ST7789 fork note for ST7796S),
  preview, compile, and flash commands.
  
  No config yet → the wizard points at `npx @typecad/cuttlefish init` first.
  Non-interactive stdin → a clear error instead of a hang. `--help` / `--version`
  included; unknown flags exit 2.
  
  ### Internals
  
  New `src/wizard/` module (prompts, display/touch catalog, AST config writer,
  starter template) exported as `@typecad/ui/wizard` for reuse and tests;
  runtime deps added: `chalk` and `typescript` (both already present via the
  cuttlefish peer). `tests/packages/ui/integration-wizard.test.ts` covers the
  catalog, rendering, splice cases (insert / replace / CRLF / comma-and-comment
  handling), pin-conflict detection, the starter template, and a round-trip
  through cuttlefish's real `parseConfigFile` proving wizard output loads the
  same way the build loads it.

### Patch Changes

- ## Standalone-install dependency fixes
  
  Declared the dependencies each package actually consumes at build/test time,
  so installs outside the monorepo resolve without relying on hoisting:
  
  - **`@typecad/expect`** now declares `@typecad/hal` (a hard dependency — the
    test harness generates `cuttlefish.config.ts` files whose
    `import type { CuttlefishConfig } from '@typecad/hal'` previously failed to
    typecheck in standalone installs) and `@typecad/framework-zephyr` as an
    optional dependency (the `west build`/`west flash` compile path requires it
    dynamically and degrades gracefully when absent).
  - **`@typecad/cuttlefish`** now declares `@typecad/expect` as an optional
    dependency — `transpile.ts` loads its preprocessor and `cli-utils.ts`
    resolves the `cuttlefish-test` CLI from it, both with existing fallbacks.
  - **`@typecad/ui`** moved `@typecad/cuttlefish` from peerDependencies to
    regular dependencies (it is imported throughout `src/`), so installing
    `@typecad/ui` pulls the transpiler automatically like every other consumer.
  - **`@typecad/safety`** dropped its duplicate peerDependencies block —
    `@typecad/cuttlefish` and `@typecad/hal` were declared in both
    `dependencies` and `peerDependencies`; the regular dependencies (the pattern
    every other package uses) are kept.
- Updated dependencies [d3f7b37]
- Updated dependencies
- Updated dependencies
  - @typecad/cuttlefish@1.0.0-alpha.14

## 1.0.0-alpha.13

### Patch Changes

- @typecad/cuttlefish@1.0.0-alpha.13

## Unreleased

- **Removed the `NAV -> screen N` lines from the preview's diagnostics
  panel.** Navigation is normal interaction noise, not a diagnostic.

- **Fixed borderless buttons wrapping their last glyph ("Primar" /
  "y").** `border: none` zeroed the border STYLE but left the UA's
  residual 1px WIDTH on the node — and the draw path subtracts
  borderWidth*2 from a button's text max width, so borderless kit
  buttons lost 2px of text space and wrapped. A none-style border now
  zeroes the width too (CSS semantics: no border, no space), restoring
  the exact text+padding fit the layout computed.

- **Ghost buttons are borderless (shadcn button reset).** The UA stylesheet
  gives every `<button>` a browser-default 1px border, and `.btn-ghost`
  never overrode it — ghost rendered as outline with a slightly different
  border color (the UA border defaults to currentColor). The kit's `.btn`
  base now resets the border (`border: none`), matching shadcn's button
  reset: ghost and primary/secondary/destructive are borderless, and only
  `.btn-outline` re-declares its own. Bare buttons without kit classes
  keep the UA default.

- **Fixed the intermittent "header retains a copy of the screen contents
  and stops working".** The band compositor's scroll-viewport clamp
  compared each candidate's CONTENT-local box.y against DISPLAY-space
  clip bounds — the ancestor scroll offset is subtracted later, inside
  the draw helpers, so any scrolled content whose content coordinate
  numerically fell inside the viewport passed the clamp and painted at
  its unclipped position: a list button scrolled up past the viewport
  top smeared over the header, and because the compose cleared the
  header's dirty flags nothing ever repaired it. The trigger was
  scrolling + any compose at non-zero scrollY with a canvas allocation
  miss (heap pressure), which routed the frame through the subtree
  compose. The clamp now operates on the node's DRAW position
  (ui_draw_x/y_for_node) and shifts the box by the delta. Reproduced and
  verified with a two-screen fuzz harness (scroll + taps + navigation,
  box-geometry invariants, simulated allocation failures): all seeds
  pass; the dialog/drawer and stale-bar scenarios re-verified unchanged.

- **Checked-state theming for form controls (shadcn
  data-[state=checked]).** `:checked` rules now bake a checked-state color
  pair (checkedBg/checkedFg) into check/radio/select nodes — a separate
  style bucket like `:pressed` — and the runtime swaps the pair onto the
  indicator when the value flips, on device and in preview. The kit wires
  the tokens: the switch's track, the checkbox face, and the radio's
  selected ring carry `--primary`/`--primary-foreground` when on (the
  same red as primary buttons in this theme), and the select's option
  list highlights the selected row with `--accent`/`--accent-foreground`
  (blue). The resolver no longer merges `:checked` into the base style
  for statically-checked markup (it repainted the node's whole box and
  couldn't change at runtime).

- **Fixed the black header rect introduced by the scroll-clip fix.** The
  band-local clip conversion subtracted region/band offsets from the
  ±32767 unclipped sentinels in int16 arithmetic — the result wrapped
  positive and the garbage clamp dropped whole candidates (the main
  screen's header card painted ~20% of its face over the dark screen
  background, reading as a black rect). The conversion is int32 now;
  host-harness verified: the header card paints fully (44125 px),
  zero stale pixels remain outside the viewport, and the dialog/drawer
  scenarios are byte-identical to their last verified state.

- **Fixed stale scroll-content bars outside the viewport (header + bottom
  of the main screen).** The screen-band compositor painted scroll-subtree
  candidates at their absolute faces, unclipped: a whole-screen compose
  left stale button rows below the fold, and composes over the header
  region smeared scrolled content into the header — bars of
  previously-scrolled pixels that nothing repaints. Band candidates now
  carry absolute clip bounds derived from their scroll ancestor's
  viewport, and each band clamps the node's face to them (geometry
  restored after the draw; fully-clipped faces drop out). Host-harness
  verified with a drag-scroll scenario on the main screen's node table:
  zero stale pixels above the viewport and below the fold at every stage,
  viewport content unchanged; dialog/drawer scenarios re-verified intact.

- **Fixed the content bar flashing over the drawer on an inside press.**
  The under-drawer node (the tap-counter echo) painted its own full rect
  first — including the part covered by the open panel — straight onto the
  display, briefly showing underlying content as a horizontal bar until
  the drawer's compose re-stamped. A node partially covered by an open
  drawer now skips its own direct repaint entirely: the drawer's subtree
  compose paints it under the panel in stacking order, and that compose's
  region is inflated to reach the node's uncovered sliver. Host-harness
  verified: the echo's standalone push is gone; its updated text
  composites into the inflated bands beneath the drawer.

- **Fixed the flash when pressing a button inside an open drawer.** The
  previous frame contract repainted the drawer panel through the per-node
  ladder (clear+fill) and then popped each re-marked child back one ladder
  at a time — an erase/re-pop sequence the eye reads as a flash. A
  container's ladder turn now composes its whole subtree REGION through
  the band renderer instead: one pass, correct stacking order, no
  intermediate state, then clears the dirty flags inside the region. The
  merge pass likewise skips nodes a dirty ancestor will repaint, so it can
  no longer compose-and-clear children just before the ancestor's erase.
  Host-harness verified: the Tap-me frame is one echo repaint plus one
  6-band subtree compose — no direct fills, no re-pops, and the echo text
  updates. Screens without dirty containers (e.g. the plain Buttons
  screen) keep the unchanged per-node path.

- **Drawer fixes: content no longer vanishes on a Tap-me press, and the
  closed drawer fully leaves the display (peek removed).**

  - Ladder-drawing a container now re-marks its descendants. A press inside
    an open drawer marked the whole subtree dirty, but the dirty pass's
    merge compositor composed the small children (texts/buttons) first and
    cleared their flags — leaving the too-big-to-merge panel for the
    per-node ladder, whose clear+fill then erased the merge-composed
    children (title/Close vanished exactly like the dialog did before its
    stacking fix). The draw pass re-marks descendants of any ladder-drawn
    container; they sort after it and restore their pixels in the same
    pass. Scroll owners never reach the ladder, so scroll repaints do not
    amplify.
  - ALL edge panels (drawers and toasts) slide fully off the display —
    travel clears the display edge, not just the panel's own height. The
    old `travel == box.h` parked a bottom panel's top rows at the fold: a
    sliver stayed visible after close. That sliver was never shown before
    the first open (the initial paint's scroll-clip dropped it) and a
    closed panel can't be tapped open, so it read as a rendering artifact
    rather than an affordance. Device and preview.

- **Fixed the modal-toggle flash: a successful drawer band compose now
  clears the dirty flags it satisfies.** The open frame composed the whole
  dialog through the band renderer — and then the dirty pass repainted the
  scrim DIRECTLY (a viewport-sized overlay is too big for the repair
  canvas, so the per-node ladder fell to a direct fill): one flat
  full-screen fill erasing the just-composed frame, then the card, title,
  and buttons re-popped band by band. That erase + re-layer sequence was
  the flash/tear on hardware. The compose is authoritative for its region:
  nodes fully inside it clear their dirty flags (bindings run after the
  drawer tick, so same-frame binding dirt still repaints). Verified on the
  host harness: a dialog toggle is now exactly one 8-band sequential
  compose — the only direct display fill in the whole run is the boot-time
  screen clear.

- **Fixed z-index flattening the dialog (content invisible, buttons dead).**
  Reproduced on a host harness (runtime header + stub display driving the
  dialog screen's node table) and fixed twice over:

  - `z-index` now raises a node's whole subtree, CSS stacking-context style
    (`ui_stacking_z`: nearest ancestor-or-self with a non-zero z). The flat
    `(zIndex, index)` sort painted a dialog's scrim (z30) and card (z31) over
    the card's own z0 children — the band compositor erased the content it
    had just drawn (dialog showed only the topmost child), and hit-testing
    saw the card as "topmost" so its buttons could never receive taps.
    Applies to the draw order, the band compositor, and both hit-tests
    (device `ui_hit_test` + preview).
  - Marking an overlapping higher layer dirty now marks its DESCENDANTS too.
    A press under the dialog marked the scrim and card dirty (overlapping
    higher layers of the pressed button) but not the card's children — the
    dirty pass repainted the container faces alone and erased the
    band-composed dialog content in the same frame.

- **Dialog/toast hardware round 3: tap routing, modal-toggle flashing, and
  the toast auto-dismiss remnant.**

  - `ui_hit_test` now targets the TOPMOST node at the tap point and bubbles
    to ancestors only, matching the DOM. It previously picked the topmost
    handler-bearing node, so a tap on a modal card (no handler, higher z)
    fell through to the click-to-close scrim underneath (handler) — any tap
    anywhere dismissed the dialog. Sibling fall-through is gone; a
    handler-bearing ancestor still receives taps on its children (DOM
    bubbling).
  - Centered dialogs (side 4) compose their open/close frames through the
    band renderer again instead of whole-screen mark-all. With the subtree
    rects now measuring the real panel extent, the band path composes the
    open frame and the erase frame tear-free — mark-all's per-node direct
    clears flashed the whole screen on no-framebuffer SPI targets. The
    rect-union inputs are neutralized when a side has no on-screen extent
    (a dialog snapping open from fully-closed has no old rect; the
    unwritten x/y previously mixed stack garbage into the band region).
  - Toast slide travel now clears the display edge instead of stopping at
    the panel's own height. A `bottom:0` toast sits at the display edge, so
    `travel == box.h` parked its top rows exactly at the fold — a strip of
    title stayed visible after auto-dismiss. Toasts (`toastDuration > 0`)
    slide fully off-screen on both device and preview; edge drawers keep
    their intentional peek.

- **More <dialog> hardware fixes (content paint + close-on-any-tap).**

  - Centered dialogs (side 4) now repaint via the whole-screen mark-all
    contract on open/close instead of the drawer band compositor — a modal
    toggle is a rare user action, and the band path was delivering only
    partial content (title visible, card/description/buttons missing) on
    hardware. Edge drawers keep the banded slide.
  - The outside-tap close hit-tests the drawer's SUBTREE rect. A <dialog>
    root with absolutely positioned children lays out at h=0, so the root
    box made every tap count as "outside" — the dialog closed on any touch,
    including taps squarely on its own buttons.

- **Fixed <dialog> not painting its content on open (hardware).** The drawer
  slide frames composite the union of the drawer's old and new paint rects —
  computed from the ROOT node's box. A `<dialog>` root whose children are
  absolutely positioned (the scrim + card recipe) lays out at h=0, so the
  union degenerated to an empty band that `ui_render_screen_bands` reported
  as handled, suppressing the mark-all fallback: nothing repainted on open or
  close. The tick now measures the SUBTREE extent (`ui_subtree_current_paint_rect`,
  matching the preview's `currentSubtreePaintRect`) and side-4 dialogs snap
  open/closed instead of animating (travel 0 makes intermediate progress
  identical frames).

- **Fixed <dialog> children painting while the dialog was closed (hardware).
  ** The side-4 closed-state gate covered only the dialog root; its children
  (scrim, card, texts, buttons) carry `drawerSide -1` and no offsets (center
  travel 0), so nothing hid them — the dialog painted on screen entry (the
  quick flash) and its close buttons appeared dead (closing an
  already-closed slot changes nothing). The gate now walks ancestors for a
  side-4 root, hiding the whole closed subtree; edge drawers keep
  offset-only hiding so the bottom peek survives.

- **Dialog and Toast elements (shadcn recipes, built on the drawer slot
  machinery).**

  - `<dialog id="…">` is a centered overlay: the runtime treats it as a
    drawer with side "center" (drawerSide 4) — travel 0, no slide; hidden
    while closed by a visibility gate (offsets can't hide a centered panel),
    visible when open. Programmatic control via `ui.dialog.open(id)` /
    `ui.dialog.close(id?)` (same build-time lowering as the drawer) and the
    `ui.dialog` facade in the preview. The scrim is markup: an absolute
    `.dialog-scrim` view whose tap closes (`.dialog-scrim`, `.dialog-card`,
    `.dialog-footer` recipes + a solid `--scrim` token — alpha blending
    needs a canvas underneath, so the kit ships an opaque near-black).
  - `<toast id="…" side="bottom|top" duration="2500">` is an edge-slid
    transient: `ui.toast(id)` opens it, the runtime auto-closes once fully
    open for `duration` ms (reopening restarts the window; manual close
    wins). Recipes `.toast` / `.toast-title` / `.toast-description`.
  - Both go through the same drawer slots (max 4 overlay panels of any
    kind per screen), navigate resets, outside-tap close (dialogs), and the
    banded slide renderer. The kit header documents markup + recipes, and
    the demo's "Dialog & Toast" screen exercises both.

- **Fixed drawer content vanishing on taps inside it (hardware).** Tapping a
  button inside an open drawer updates a bound text behind the drawer; the
  partial-overlap classification re-dirtied the drawer's whole subtree, and
  with the scroll-defer fall-through that redraw now goes through direct
  band/paint-canvas pushes over a non-composited overflow scroll viewport —
  on hardware the drawer's text and buttons vanished while remaining
  tappable. (Before the fall-through existed, the defer silently dropped the
  re-dirty, which is why the original overlap fix appeared to work.) The
  classification now skips the covered node in that configuration instead:
  the few uncovered pixels of a full-width label are not worth the unsafe
  redraw. When the scroll owner IS composited this frame (dirty), the full
  drawer re-stamp remains. Preview verified unaffected by both a synthetic
  regression test and a real-program test driving the demo's actual drawer
  screen through the snapshot builder.

- **Rasterized-glyph coverage cache for classic-font AA text (LVGL-style).**
  The AA pass rasterized each text line into a canvas and neighbor-counted a
  3x3 (5x5 for ts>=3) kernel per pixel on EVERY repaint — a 460px label at
  ts=2 cost ~70k canvas reads per frame. Classic 5x7 glyph cells are
  position-independent (the 6ts cell's trailing gap column is blank and the
  sampling radius never crosses it, except a 1px outer halo on spacing), so
  per-(char, ts) coverage is now cached in a direct-mapped static table
  (48 slots x 450B, ts 1..3; 0 on AVR) and `ui_draw_aa_text` blends cached
  cells straight into the destination — no line rasterization, no neighbor
  sampling. Coverage is shape-only (computed black-on-white); fg/bg enter
  at blend time, so entries are color-independent. Sizes above ts=3 and
  canvas-allocation failure fall back to the original whole-line path.

- **LVGL-inspired performance work (render speed / responsivity):**

  - Blend LUTs: per-opacity 256-entry tables (513 bytes of static RAM,
    rebuilt only when the opacity level changes) replace the three
    multiply-divide rounds per pixel in `ui_blend565`/`ui_blend888`. Hot
    paths: skeleton pulse, keyframe colors, AA glyph coverage, translucent
    fills, shadow passes.
  - Per-frame dirty-rect merging: when several nodes repaint in one frame,
    their paint rects are greedily grouped (8px inflate, capped at the band-
    compositable pixel budget) and each multi-node region composites through
    the band renderer as one set of pushes instead of per-node SPI
    transactions. Singletons and unmergeable rects keep the per-node ladder;
    scroll-composited subtrees, virtualized lists, and the retained-
    framebuffer path are excluded (they have their own compositors).

- **The shadcn kit is built in.** The kit stylesheet (default zinc-family
  tokens, light + `.dark`, and every class recipe — buttons, cards, badges,
  inputs, alerts, skeleton, spinner, tabs, accordion, separator, table, ...)
  now ships inside `@typecad/ui` (`shadcn-kit.ts`) and is prepended to the
  CSS chain in BOTH pipelines (the device build's module loader and the
  preview snapshot builder) ahead of the user's CSS. No scaffolding, no
  `@import` needed — kit classes on native elements just work, and anything
  the user writes overrides them by normal cascade order.

  - **Themes are plain CSS files.** Drop a ui.shadcn.com / tweakcn export
    anywhere in the project and `@import` it: its `:root`/`.dark` token
    blocks override the kit defaults (later definitions win, verified for
    light and dark). No registry, no splicing, no theme directories. Bare
    module specifiers inside exports (`@import "tailwindcss"`) are dropped
    silently during import expansion; path-like imports keep the
    resolve-or-warn behavior.
  - **Pre-packaged themes ship with the package**: `@typecad/ui/themes/`
    carries eight adapted from the official shadcn set (zinc, slate, stone,
    gray, neutral, blue, green, red — light + dark, HSL-triplet dialect).
    Import by bare package specifier: `@import "@typecad/ui/themes/blue.css"`.
    Bare specifiers resolve through `node_modules` during import expansion
    (relative `./…`, `../…`, absolute, and drive-letter paths keep their
    existing behavior); unresolvable ones (Tailwind scaffolding) drop
    silently.

- **Self-closing non-void elements no longer nest.** HTML-spec parsers treat
  `<view .../>` as an OPEN tag (XML-style self-closing is not HTML), so
  JSX-habit markup silently placed following siblings INSIDE the previous
  element — the spinner card wrapped its label inside the 22px ring (a
  1-character-wide, 10-row text strip), and the skeleton demo's three bars
  nested into one. Both parse entry points now expand self-closing non-void
  tags to explicit pairs before parsing; void elements (img/hr/input/...)
  are untouched.

- **Scrollbar tracks cover the full reserved gutter.** Every scrollbar
  cover (scroll band renderer, list band renderer, Mode B canvas scrollbar,
  Mode C direct scrollbar) filled only 3px of the 4px gutter, leaving the
  edge column uncovered — child decorations that poke past the content area
  (the newly-wired outset shadows, +4px offset with blur) survived there as
  1px amber ticks inside the scrollbar. Ticks vanished on scroll (canvas
  recomposition re-seeds full width) and returned on screen entry; screens
  whose content fits never scrolled, so they kept them permanently. Tracks
  now fill the full gutter width; thumbs stay 3px.

- **Scroll band renderer draws outset shadows.** `ui_render_scroll_bands` was
  the one subtree renderer without a `ui_draw_shadow` call (main loop, node
  bands, and screen bands all had it), so any scroll viewport composited
  through the band path (viewport canvas won't allocate) lost every shadow —
  theme `--shadow-*` tokens rendered in the preview but not on device. A
  renderer-parity emitted-header test now pins the shadow call in all three
  band renderers.

- **Renderer routing review (Zephyr/direct-SPI targets): every repaint now
  composites before it touches the panel.** Three fixes from the pass:

  - `ui_mark_dirty` no longer promotes a fully-contained dirty child inside
    an overflow scroll viewport to a full-viewport repaint. The child keeps
    its own dirty flag and the dirty loop's scroll defer lets it repaint
    through its paint canvas or the band renderer (one atomic push; the
    retained scroll canvas is invalidated after). The old promotion — added
    for :pressed buttons — recomposed the whole viewport per dirty tick, so
    keyframe animations marking children (and their overlapping higher
    layers, via the geometry-repair overlap hook) at frame rate produced
    constant full-screen pushes: the transforms screen tearing.
  - Partially/fully clipped scroll children still defer to the composited
    canvas (their edge pixels must come from it; drawing directly would
    paint outside the viewport).
  - `ui_should_buffer_paint` lost its hard 20000-pixel cap. Oversized paint
    rects now route to the band renderer via the existing preferBand
    threshold instead of falling through to direct clear-then-redraw — a
    452x48 full-width button is 21696px and sat just over the cap, which was
    the button-press flash.

- **Preview parity for the device runtime's visibility + drawer fixes:**

  - `border-radius` clamps at 0 on the way into the node model. Kit recipes
    like `calc(var(--radius) - 2px)` go negative for 0px-radius themes
    (tweakcn's sharper exports) — the value was emitted into the node table
    verbatim, tripping uint8 narrowing errors on the device toolchain.
  - The preview runtime now re-stacks ancestor flow containers when a node's
    visibility changes (the same flowAxis/flowGap/flowFlags metadata cascade
    as the device's `ui_reflow_visibility`), so a collapsed accordion pane
    stops reserving space in the preview render too — including scrollable
    `contentHeight` recomputation and one full-screen repaint.
  - The preview's dirty pass classifies dirty nodes against fully-open
    drawers exactly like the device dirty-draw loop: fully-covered nodes
    skip their repaint, partial overlaps re-dirty the drawer subtree so it
    re-stamps on top (a bound text behind an open drawer no longer erases
    the drawer's buttons).

- **Image conversion: failed decodes memoize, EXIF orientation respected
  in the size cap.** A file that fails to decode is now cached under its
  real mtime, so an unchanged file warns once instead of re-attempting on
  every warm-up; and the fit-to-display comparison uses the post-EXIF-
  rotation natural size (orientations 5-8 transpose the pipeline output),
  so portrait photos no longer skip the downscale they need.

- **Preview profile loader consumes the unified `BUILT_IN_PROFILES`
  interface.** The Zephyr profile mapping no longer lives in the preview
  builder — framework packages export `BUILT_IN_PROFILES` in the shared
  `DisplayProfile` shape (Arduino already did; Zephyr now does too) and the
  loader stays layout-agnostic.

- **Automatic image conversion.** `<img src="…">` now accepts any common
  image format — PNG, JPEG, GIF, BMP, WebP, AVIF/HEIF, TIFF, SVG, and ICO —
  decoded to the RGB565 asset form at build time (sharp for raster/SVG,
  decode-ico for `.ico` frames; the largest frame wins). Nothing to
  configure: files are identified by magic bytes, not extension.

  - Images larger than the physical panel downscale to fit (never enlarge),
    so a phone photo can't emit a multi-megabyte C array.
  - Alpha flattens onto black; JPEGs auto-orient by EXIF.
  - An `<img>` without explicit width/height attributes takes the image's
    natural size for its layout box (converted assets only; raw dumps keep
    requiring author dimensions).
  - Legacy raw RGB565 `.img` dumps keep working unchanged; anything that
    fails to decode warns and falls back to the raw reader.
  - New dependencies: `sharp`, `decode-ico`.

- **Preview: Zephyr display profiles resolve again.** The preview's profile
  registry loader only knew the Arduino layout (`BUILT_IN_PROFILES` from
  `displays/ili9341-spi`); under `@typecad/framework-zephyr` that import
  fails silently, leaving an empty registry — any `profile:` name (e.g.
  `st7796-zephyr`) threw "Unknown display profile … Available: (none)" while
  the CLI build resolved it fine via the strategy's `getProfileRegistry()`.
  The loader now also reads `ZEPHYR_DISPLAY_PROFILES` from the framework's
  `display` module and maps entries to the shared `DisplayProfile` shape,
  mirroring the strategy hook.

- **Visibility reflow (device).** Layout runs at build time (yoga); toggling a
  node's `visible` flag used to leave its baked box in place, so a collapsed
  accordion pane still reserved its space — an accordion card rendered at its
  open-state size and showed empty space when closed (the preview re-layouts
  every frame and collapses correctly). Each node now carries flow metadata
  (`flowAxis` column/row, `flowGap`, `flowFlags`: auto height/width,
  out-of-flow), and `ui_set_visible` triggers `ui_reflow_visibility`: ancestor
  flow containers re-stack their in-flow children from the first in-flow
  child's slot (hidden children take no space), content-sized containers
  re-size, scrollable containers recompute `contentHeight` (scroll offset
  clamped, canvas reseeded), and the cascade continues upward until a
  container stops changing. One full active-screen repaint follows — a
  visibility collapse is a discrete user event, not an animation. Containers
  that a linear re-stack can't reproduce (flex-wrap, reversed directions,
  justified content other than flex-start) and out-of-flow (absolute/fixed)
  children opt out via the metadata. This also fixes the empty reserved space
  of the form-validation hints and any other `ui.bind(x, 'visible', ...)`
  recipe on device.

  - The auto-size flags now account for where a dimension actually comes
    from: an explicit size, `flex-grow` space, a `flex-basis`, or cross-axis
    stretch (a child of a row parent stretches its height; of a column
    parent its width) all mark the dimension parent-derived, not
    content-sized. The first cut treated every height-less node as
    content-sized, so the reflow resized a `flex: 1` scroll body to its
    collapsed content — `contentHeight` met `box.h` and the expanded
    accordion's bottom pane had nothing left to scroll into.

- **More device render fixes from hardware testing (SPI TFT):**

  - Dirty nodes under an OPEN drawer no longer paint over the panel. The
    dirty pass now classifies each dirty node against every fully-open
    drawer: fully covered by an opaque panel → the repaint is skipped
    (nothing of it is visible); partially covered → the drawer's subtree is
    re-dirtied in the same frame so it re-stamps on top (its z sorts it
    after the covered node). Previously a bound text behind the open drawer
    (the demo's `taps inside` echo) redrew its clear+text over the panel,
    erasing the drawer's buttons while they stayed tappable.
  - The modal `<select>` overlay now stamps only when it or the frame beneath
    changed. It previously redrew every tick while open, pushing the modal
    region over SPI continuously — visible as constant refreshing/tearing
    confined to the modal. A new frame-painted flag re-stamps after any
    underlying repaint so tree redraws still never bury the overlay.
  - `<drawer>` slots store their node index in `int16_t` (was `int8_t`).
    Real apps exceed 127 nodes — the canonical demo's drawer is node 369,
    which truncated to 113: the slot never matched, `ui.drawer.open/close`
    were silent no-ops, and the drawer could neither open nor close. This
    was the root cause of the "stuck open, empty, unclosable" panel.
  - Closed drawers hide by transform offsets alone (seeded at full travel at
    init from the build-time layout boxes), matching the preview — which
    deletes its drawer state once fully closed, so a closed bottom-anchored
    panel still shows the small "peek" strip its slid position leaves
    on-screen. The extra closed-drawer visibility gate in
    `ui_is_effectively_visible` hid that peek and is gone.
  - Drawer slide frames now compose as tear-free bands instead of marking
    the whole screen dirty. `ui_render_screen_bands` (a whole-frame sibling
    of the scroll band renderer) composes the union of the drawer's old and
    new paint rects into the persistent ~10KB band canvas, one strip at a
    time, each pushed in a single transaction. The mark-all-dirty slide
    repainted the entire screen per step with direct per-node clears —
    visible flashing on no-fb SPI targets, with only ~3 steps fitting in the
    180ms slide. Falls back to the whole-screen repaint when the band canvas
    can't allocate or a retained framebuffer composes the frame (its
    dirty-union push is already tear-free), and invalidates any cached
    scroll viewport the drawer crossed so the next scroll recomposites.
  - `ui_try_repair_geometry_fill` accepts rounded fills: `borderRadius` no
    longer bails the union-bitmap repair, and the repair body draws
    `fill_round_rect` when a radius is set. Geometry keyframes on rounded
    boxes (the demo's slide/turn/pulse `.fxBox` shapes) previously fell to
    the direct clear-then-redraw fallback every frame — the tearing on the
    keyframes screen. Border/outline/shadow chrome still bails.

- **Device render fixes surfaced on hardware (SPI TFT):**

  - The dropdown chevron + its 14px label reserve now live only in the
    `<select>` draw case. A mis-aimed patch had put them in the button case,
    so every button and nav link rendered a down-chevron and wrapped labels
    that didn't need to; buttons are back to plain centered text.
  - `CuttlefishGFX::drawRoundRect`/`fillRoundRect` clamp the radius to half
    the shorter side and guard degenerate sizes, mirroring the preview's
    host-gfx (CSS border-radius collapse semantics). Kit pills lower
    `border-radius:9999px` to `r=255`, which previously overgrew the corner
    arcs on-device — badges rendered star-shaped (left/right spikes, top and
    bottom pinched inward) while the preview showed a correct pill. The pill
    delta (`h - 2r - 1`, unclamped) is unchanged and correct in both runtimes.

- **Device-lowering fixes surfaced by the canonical demo's first full
  toolchain compile (Zephyr/west, ESP32-S3):**

  - `ui.drawer.open('<id>')` / `ui.drawer.close('<id>'?)` now lower for the
    device — the drawer id resolves at build time to the `<drawer>` node
    index, emitting `ui_drawer_open(N)` / `ui_drawer_close(N)` (or
    `ui_drawer_close_all()` with no id); unknown ids/methods are build-time
    errors.
  - `bind:value` write-backs assign the plain signal variable (signals
    lower to plain device variables; the emitted `.set()` failed to link).
  - `screen.<id>.text.length` lowers to `strlen(__ui_nodes[N].textBuffer)`
    (previously fell to the STL `.size()` default — invalid on the raw char
    buffer).
  - The runtime header's modal <select>/<drawer> state + forward
    declarations moved to the earliest module (ui_navigate, visibility, and
    ui_init reference them before the defining modules).
  - The select overlay stamp no longer closes the dirty-draw loop twice
    (a duplicated `}` broke every statement after it in ui_tick).
  - Device code uses the target-agnostic `ui_display_*` wrappers in the
    select/drawer overlay bodies (bare `display_*` don't exist on Zephyr).
  - `.borderRadius` clamps to uint8 at emit (the `999px` pill syntax
    narrowed on strict toolchains).
  - Both default keyboard loaders emit whenever any input exists — the
    keyboard's 123/ABC page-swap calls both regardless of input types, so
    text-only projects failed to link (`__ui_kb_load_default_number`
    undefined).

- **Form validation states (shadcn-style).** `.input-error` (destructive
  input border), `.field-error` (destructive hint), `.field-success` (muted
  hint) join the kit. The runtime-driven flow the demo documents: a signal
  holds the invalid state, `ui.bind(input, 'borderColor', ...)` swaps the
  border between the input token and destructive literals, and
  `ui.bind(hint, 'visible', ...)` reveals the matching message — validated
  from an `on:click` (Save) and re-validated on every input commit
  (`onChange`). `borderColor` bindings already worked in both runtimes.

- **Accordion recipe (shadcn Accordion, single-open).** `.accordion` /
  `.accordion-item` / `.accordion-trigger-row` + `.accordion-trigger` /
  `.accordion-chevron` / `.accordion-content`: stacked collapsible sections
  where a signal holds the open index (-1 = all closed), content toggles via
  `ui.bind(x, 'visible', ...)`, and the chevron swaps `v`/`^` via a text
  binding. Two engine fixes surfaced by it: (1) `ui.bind(..., 'text', ...)`
  targets now draw their buffer (the preview only set `textBuffer` — the
  static text kept rendering unless auto-wire had flagged the node);
  (2) FALLBACK_CHARS gains the symbol row (`^~$'|`) so runtime-swapped
  strings have those glyphs, and the chevron recipe sizes its box wide
  enough for the `^` advance (a single char wider than its box wraps to
  nothing).

- **Tabs recipe (shadcn Tabs).** `.tabs-list` (segmented trigger row),
  `.tabs-trigger`, `.tabs-content-area` (fixed-height region) +
  `.tabs-content` (absolutely-stacked panes). Panes toggle via `ui.bind(x,
'visible', () => signal === i)` — layout keeps every pane's box, so
  switching never re-flows — and the active trigger swaps literal hex
  background/color at runtime (compile-time tokens, so pin to the theme the
  way native_demo accents do). Panes stay fully interactive while shown.

- **Vertical separator recipe.** The kit's separator was horizontal-only;
  `.vseparator` (1px wide, `height: 100%` + `align-self: stretch`) is the
  shadcn `<Separator orientation="vertical" />` equivalent — a vertical rule
  that stretches to its row's cross height. `height: 100%` is required: the
  UA gives `hr` `height: 1px`, which out-ranks bare `align-self: stretch`.

- **New `<drawer>` element (shadcn drawer).** An author-styled absolute panel
  (`<drawer side="bottom|top|left|right">`) that slides in from its edge:
  the runtime animates per-node transform offsets over ~180ms, hides the
  subtree while closed (draw + hit-test gating), closes on outside taps and
  navigation, and exposes `ui.drawer.open(id)` / `ui.drawer.close(id?)` for
  programmatic control — with content that is ordinary elements, so theme
  tokens style it like anything else. Implemented in both runtimes (preview
  `applyDrawers`; device `ui_drawer_*` with slot bookkeeping, seeded closed
  at init, tick-driven slide, and visibility gating). Drawer slide frames
  mark the whole active screen dirty — the drawer's clear fills with the
  parent background only, so everything the panel covered (buttons, text,
  cards underneath) repaints as it slides away; without this the underlying
  canvas stayed flat background after close.
- **Preview: module-var rewrite is string-literal aware.** The
  `moduleScope.NAME` identifier rewrite ran over whole expressions, so prose
  inside template literals containing a module-var name as a whole word was
  rewritten too — a label like `` `taps inside: ${x}` `` rendered as
  "moduleScope.taps inside: ...". The rewrite now skips string/template
  literal contents (template `${...}` segments still rewrite; nested
  templates recurse).

- **`<select>` opens a modal option list instead of cycling.** Tapping a
  select now opens a centered list of its options (capped to ~60% of the
  panel height); tapping a row selects it, tapping outside dismisses. The
  current option renders inverted with a check mark. Implemented in both
  runtimes with the same contract as the on-screen keyboard modal: touch
  routing intercepts taps while open, the overlay is stamped after the dirty
  pass so tree redraws never bury it, closing marks the whole tree dirty for
  the erase repaint, and navigation resets it. Device nodes carry
  `optionCount` + `optionTextFn` (a generated per-select option table), and
  the auto-wired tap handler calls `ui_select_menu_open(idx)` instead of
  advancing the value.
- **`disabled` attribute is now honored.** The HTML parser captured `disabled`
  but nothing consumed it — disabled inputs still opened the keyboard and
  disabled buttons still pressed. The attribute now flows through the model
  and both runtimes: disabled nodes are not tap targets (no press, no
  keyboard — the device's `ui_hit_test` and the preview's `hitTest` skip
  them), and buttons/inputs draw with halved colors, matching the device's
  `(c >> 1) & UI_DIM_MASK` fade for the web-like disabled look.
- **Runtime-dynamic text no longer drops glyphs.** Font subsets were planned
  from authored static text only, so nodes whose text changes at runtime
  rendered missing glyphs once the new string fell outside the subset — a
  `ui.bind(x, 'text', …)` echo authored as "mode: alpha" showed "mode:
  amma" for Gamma and " eta" for Beta. The planner now widens faces to the
  fallback charset for dynamic-text nodes: `ui.bind(..., 'text')` targets
  (preview collects them from the script source), `{expr}` interpolation
  nodes, and `bind:text` attributes. Scroll containers also reserve a 4px
  breathing gap past their scrollbar strip, so stretched content no longer
  sits flush against the scrollbar.
- **`<select>` no longer wraps mid-word on wider options.** Two fixes: the
  layout now sizes a select to its widest option by RENDERED width rather
  than character count (with a proportional font, equal-length options like
  "Alpha" and "Gamma" differ in width), and the Yoga engine treats select
  leaves as text-like (measure function with available-width awareness) like
  text/button/check/radio — the generic leaf branch sized the width without
  the UA control padding, so the wider option overflowed and wrapped
  ("Gam / ma"). Inside `align-items: stretch` containers a select now
  stretches to full width, matching browser flex behavior. Selects also draw
  a dropdown chevron at the right end (both runtimes, with the label wrapping
  against the reserved 14px), and scroll containers reserve their 4px
  scrollbar strip as right padding so stretched children never lay out or
  paint under the scrollbar.
- **Check elements honor `border-radius` (switch pills).** A `<check>` with a
  radius (the shadcn kit's `.switch`) rendered as a plain rectangle in both
  runtimes; the background fill now clears to the backdrop and paints the
  rounded box (`fillRoundRect` / `ui_display_fill_round_rect`), and the 16px
  indicator becomes a circular knob that slides with state — hollow at the
  left when off, solid at the right when on (radio-dot geometry; no checkbox
  square or checkmark). Plain checkboxes (radius 0) are unchanged. The
  kit preset also sets `min-height: 26px` on `.switch` so the UA's 42px
  touch-target rule doesn't inflate the pill, and uses `--card` for the
  track — on a bare near-black page a `--muted` track reads as a stray
  gray box.
- **Preview `fillRoundRect` pill overshoot fixed.** The JS port clamped the
  arc-delta at 0 before the circle helper's +1, so for perfect pills
  (`h == 2r`, e.g. shadcn `.badge` with `border-radius: 999px`) every corner
  arc drew one row past the box — two orphan stubs flanking a background-
  colored line under the badge's straight bottom edge. The delta now passes
  through unclamped, matching the device's `CuttlefishGFX::fillRoundRect`
  (which never had the artifact).
- **Preview now uses the bundled default font.** The CLI build injects the
  bundled DejaVu faces before planning font assets; the preview's snapshot
  builder never did, so the UA root's `font-family: "DejaVu Sans"` resolved
  to no face and every project without hand-written `@font-face` rules fell
  back to the smoothed 5×7 bitmap font — the device rendered real
  antialiased glyphs while the preview did not. The preview injects the same
  faces (gated on the profile's color format, mono targets keep the bitmap
  font), so AA text works out of the box in both.
- **Preview overscroll no longer paints holes into neighbors.** Scrolling a
  screen past its bottom (wheel/rubber-band overshoot) ran the press-offset
  clear for dirty buttons whose draw position straddled the scroll viewport
  top; the clear/repair filled with parent background WITHOUT intersecting
  the scroll viewport — every other clear path clips — so it painted
  page-colored blocks over the fixed header (and anything else above the
  scroll body), and nothing re-dirtied that region afterwards, leaving
  permanent holes. The press-offset clear now clips to the node's scroll
  viewport like the rest of the clear paths.
- **Preview `@import` expansion (parity fix).** A `@import` inside a `.ui`
  `<style>` (e.g. `@import "./styles/shadcn.css"` from the component-kit
  preset) stayed literal in the preview: the CLI build expands imports before
  parsing (`loadUIModuleFromText`), but `buildPreviewSnapshot` concatenated
  the CSS raw, so imported tokens never loaded and model lowering rejected
  the unresolved `var(--x)` color strings — a project that built fine for
  device crashed the preview. The preview now expands each CSS part against
  its own base directory (sidecar css and html style blocks can live in
  different directories).
- **Preview diagnostic: unnamed interactive nodes.** `on:*` handlers,
  `bind:*` bindings, `{expr}` interpolations, and `<img src>` assets resolve
  their node by id in the preview and the device build alike (image asset
  loading keys on the node id — an id-less `<img>` silently renders an empty
  frame). The preview now emits a warning telling the author to add an id.
- **Preview animation frame loop.** CSS keyframe animations, transitions,
  and scroll settles froze between interactions: `start()` only ticked on
  input events and `ui.interval` bindings — there was no continuous frame
  loop, so the Transforms screen's animated dots only moved when a click
  happened to trigger a tick. `start()` now drives `tick()` from a ~20ms
  poller, mirroring the device's `loop()` → `ui_tick()` cadence (idle ticks
  are cheap — nothing dirty means no frame push). Also removed a leftover
  temporary `DBG-ONLINE` diagnostics self-test.
- **Virtualized list mid-scroll rendering.** During a scroll, the preview's
  dirty pass drew a list's outset box shadow BEFORE the list's shift path —
  the shadow rect spans the element, so it painted flat shadow color over
  the live viewport pixels that `shiftListViewport` then copied upward,
  leaving rows visible only through the repaired strip at the bottom of the
  list. Full repaints (initial view and the scroll extremes, where the delta
  exceeds the viewport) covered it back up, which is why only mid-scroll
  looked broken. Lists now skip the generic pre-draw and paint their outset
  shadow inside `drawListNode` on the full-repaint path only — matching the
  device runtime, which skips the outset shadow for lists in the main loop
  and draws it only when `!canShiftList` (node-draw-body.ts).
- **Preview mouse-wheel scrolling.** The canvas had no wheel handler, so
  wheel-scrolling a list or scroll container did nothing (drag was the only
  path). The client maps wheel deltas (pixels/lines/pages) to a new
  `PreviewUIRuntime.wheel(x, y, deltaPx)` that applies the delta to the
  scroll owner under the cursor via the same hit-scan a drag uses, with the
  standard overscroll settle and clamping.
- **List rendering fixes.** (1) Virtualized `<list>` rows are runtime text,
  but nothing fed their charset into the font-asset subset — a face built
  from unrelated static text rendered item strings with blank glyphs (a
  subset carrying '0' but not '1'-'9' drew "Item 10" as "Item 0"). List
  nodes now widen their resolved face to the fallback charset, preview and
  device alike. (2) The preview's GENERIC scroll passes (scrollbar draw +
  dirty-viewport clear) treated virtualized lists as ordinary scroll
  containers — drawing a second scrollbar with 565-only dim math (blue on
  rgb888) over the list's own, and clamping scrollY against the stale
  node-level contentHeight so drags visibly didn't scroll. Both passes now
  skip virtualized nodes, matching the device runtime's dirty-draw phase.
  (3) All remaining `(c >> 1) & 0x7BEF` dim sites (scrollbar track, range
  slider track, input placeholder) now dim at the active depth via one
  helper (device UI_DIM_MASK parity).
- **Preview `ui.window` facade.** Callbacks calling `ui.window.setTitle(...)`
  (lowered to `ui_window_set_title` on SDL targets) crashed in the preview
  with "Cannot read properties of undefined (reading 'setTitle')" — the
  preview's `ui` facade only exposed `signal`/`navigate`. It now implements
  the device's `ui.window` surface: `setTitle` updates the browser tab title,
  `setIcon` no-ops (no browser equivalent, matching hardware targets).

- **Fixed preview colors for rgb888/rgb666 targets.** The preview canvas
  push assumed the host framebuffer always held packed RGB565; rgb888
  snapshots (e.g. the native/SDL demo) store packed RGB888 and rendered
  channel-shifted (dark themes showed blue backgrounds, greenish cards,
  crimson borders). `HostAdafruitGFX` now carries the storage depth
  (`rgb565` unpacks, `rgb888` passes through, `rgb666` quantizes to 6
  bits/channel at the push — device panel parity), seeded from the
  snapshot's colorFormat. Transition/keyframe color lerps were also
  565-only; they now lerp per 8-bit channel on 888/666 targets.

### Web compatibility pass (predictability for HTML/CSS authors)

- **Content is never silently dropped.** Unknown HTML tags render as generic
  containers (text-only leaves become text nodes) with a warning instead of
  discarding the subtree; `<ul>/<li>` render with `•`/`N.` markers; `<hr>`,
  `<textarea>` (as single-line input, warned), and `<input
type="checkbox|radio|range">` (aliases of `check`/`radio`/`range`) are
  accepted. Stray text next to element children becomes anonymous text
  children (CSS anonymous-box model) — `<div>Total: <b>3</b></div>` keeps
  "Total:" and flows inline-only mixes as one line.
- **Units honored like a browser.** `width: 50%` resolves against the parent
  (was: 50px), `margin: 0 auto` centers via auto margins, and 3/4-value
  margin/padding shorthands expand TRBL correctly.
- **`background: transparent` paints nothing** (was: opaque black). Border
  color defaults to `currentColor` (the node's text color) when unspecified.
- **Cascade specificity.** Author rules cascade by specificity
  (inline > id > class/attribute > element, source order within a level) and
  the UA sheet loses to any author rule; previously pure last-rule-wins.
- **Bundled default font.** Color displays get an implicit DejaVu Sans
  (regular + bold, from `assets/fonts/dejavu/`, Bitstream Vera License —
  LICENSE + checksum README ship alongside and font tables carry an
  attribution comment) so antialiased text at exact pixel sizes works out of
  the box. Monochrome displays keep the stock bitmap font.
- **Display-anchored UA defaults.** The UA stylesheet derives its type scale
  from the display profile (16px root on large panels, 14px at 320×240, 12px
  small color, 12px bucket-snapped mono), adds browser-like heading/p
  margins, makes h3 bold again (the bold-inflates-size runtime quirk is
  gone), scales touch-target min-heights, styles `hr`, and exposes
  `.ui-scroll-body`/`.ui-screen-header` aliases for `.scrollBody`/
  `.screenHeader`.
- **CSS compatibility report + `--strict-css`.** Partial-honor values now
  warn (`css-*` diagnostics): ignored alpha, `content-box`, unsupported
  `display`/`position` values, `font-size` in %/em, unitless `line-height`,
  font-size viewport share, stock-font size bucketing, UA-scale summary.
  `cuttlefish build --strict-css` upgrades them to errors. The `border`
  shorthand accepts bare/decimal widths; the `font` shorthand applies its
  `size/line-height` pair.
- **Second element wave.** `<meter>` aliases `progress`; `<output>`, `<small>`,
  `<dl>/<dt>/<dd>` (bold term, indented description), `<fieldset>/<legend>`,
  `<form>` (plain container, no warning), `<pre>/<code>/<kbd>/<samp>` (inline
  code flows inside paragraphs) with a bundled **DejaVu Sans Mono** default
  face for the code family. MCU-impossible elements (`<svg>`, `<video>`,
  `<audio>`, `<iframe>`, `<embed>`, `<object>`, `<picture>`) render as generic
  containers but warn specifically with the native alternative (`<canvas>`,
  `<img>`); `<source>`/`<track>` are skipped as metadata. Exotic
  `<input type=...>` values (date, email, ...) normalize to a single-line text
  input with a warning.
- **Tables (equal-width flex approximation).** `<table>/<tr>/<td>/<th>` with
  `<thead>/<tbody>/<tfoot>/<caption>`: rows are flex rows of equal-width
  stretched cells (`td`/`th` get `flex:1` + padding; `th` bold + centered like
  browsers). No auto column sizing — an info diagnostic says so at build time,
  and `colspan`/`rowspan` warn (each renders as a single cell). `<col>`/
  `<colgroup>` are skipped as metadata.
- **Preview stock-font fallback.** The preview runtime no longer warns
  "Default GFX font not found … text pixels will be blank" for projects
  without a vendored `lib/Adafruit_GFX_Library` — it falls back to the
  glcdfont table already bundled in `@typecad/cuttlefish`
  (`api/shared/glcdfont.ts`). A project-local Adafruit_GFX copy still wins
  (byte-identical to what the firmware compiles against).
- **Local `@import` support.** Relative stylesheet imports are inlined at
  build time (recursive, cycle-guarded). Remote/data: imports keep the
  existing unsupported-@import warning.
- **shadcn-style component kit.** `cuttlefish add shadcn` (cuttlefish
  package) copies a token + recipe preset into `src/styles/shadcn.css` —
  copy-and-own, like shadcn/ui. CSS-variable tokens (light + `.dark`),
  button/badge/card/input/label/separator/alert/skeleton/progress/avatar/
  switch recipes, and a `.row` utility, all over the native elements.
- **Stock shadcn themes paste in unmodified.** Color resolution accepts the
  classic HSL channel-triplet dialect (`--primary: 222.2 47.4% 11.2%`)
  through bare `var()` (and `hsl(var(--x))` as before), plus `oklch()`
  (Tailwind v4 era themes) via OkLab → sRGB conversion. Verified against
  shadcn's own zinc values.
- **calc() unit fix.** `calc(0.5rem - 2px)` now correctly resolves to `6px`
  (it previously produced `6rem` — 96px — from first-unit-wins logic).
  Percent + length mixes (`calc(50% - 10px)`) stay literal instead of
  producing a wrong number.

## 1.0.0-alpha.12

### Patch Changes

- Fixed two emitted-runtime compile errors that broke every Arduino UI build
  using the PSRAM canvas allocator (e.g. `demo-display`):
  - `ui_create_canvas_best`'s PSRAM debug `printf` lines emitted a literal
    newline inside the C++ string literal (the `\n` in the runtime-header
    slice's template literal was a JS escape, not the two C++ characters) —
    "missing terminating \" character". Now escaped as `\\n`.
  - `ui_draw_node_body` took a `const UINodeDrawCtx*` parameter, but the
    Arduino `.ino` preprocessor auto-inserts a forward declaration of every
    function near the top of the sketch — before the struct is defined — so
    the generated prototype failed with "'UINodeDrawCtx' does not name a
    type". The parameter is now `const void*` (cast back inside), keeping the
    auto-generated prototype primitive-only and valid.

### Minor Changes

- ## Display integration wizard (`npx @typecad/ui --config`)

  Installing `@typecad/ui` used to leave a gap: integrating a display requires
  choosing hardware (panel, bus, pins, speed, touch) and writing the
  `display` section of `cuttlefish.config.ts` by hand. The package now ships a
  `typecad-ui` bin, so the flow after `npm install @typecad/ui` is:

  ```bash
  npx @typecad/ui --config
  ```

  ### What it does

  - **Display selection** with hardware-aware defaults: the built-in profiles
    (`ili9341-spi`, `st7796-spi`, `ssd1309-i2c`), the desktop SDL simulator, or a
    fully custom driver (name, bus, resolution, color format).
  - **Bus wiring questions** — SPI (CS/DC/RST/backlight, frequency in MHz,
    optional SCK/MOSI/MISO override) or I2C (address, optional reset pin),
    prefilled from any existing `display` section on re-runs.
  - **Orientation + rendering** — rotation, antialiasing, and an advanced color
    branch (color order / inversion). ST7796S keeps the demos' proven `bgr` +
    non-inverted defaults.
  - **Touch** — none, resistive (XPT2046 / STMPE610 / 4-wire analog), capacitive
    (FT6336U / GT911 / CST816S), or a custom adapter file, each with its pins,
    I2C address/speed, IRQ/reset, and calibration (raw-ADC defaults for
    resistive, native-panel pixel space for capacitive — matching the demos).
  - **Theme hooks** — optional `themeCss` / `themeClass`.

  ### How it writes the config

  The `display` section is spliced into `cuttlefish.config.ts` through the
  TypeScript AST: only that section changes, every other section and its
  comments survive byte-for-byte, unmanaged display keys (`scroll`,
  `scanlineSync`, …) are carried over, and the edited file is syntax-checked
  before anything is written. GPIO collisions between display and touch wiring
  warn before the write. If the config's `entry` points at a missing `.ui`
  file, the wizard offers a documented-syntax starter screen, then prints the
  exact `arduino-cli lib install` (with the real Library Manager names —
  `RAK14014-FT6336U` for FT6336U, the ST7735/ST7789 fork note for ST7796S),
  preview, compile, and flash commands.

  No config yet → the wizard points at `npx @typecad/cuttlefish init` first.
  Non-interactive stdin → a clear error instead of a hang. `--help` / `--version`
  included; unknown flags exit 2.

  ### Internals

  New `src/wizard/` module (prompts, display/touch catalog, AST config writer,
  starter template) exported as `@typecad/ui/wizard` for reuse and tests;
  runtime deps added: `chalk` and `typescript` (both already present via the
  cuttlefish peer). `tests/packages/ui/integration-wizard.test.ts` covers the
  catalog, rendering, splice cases (insert / replace / CRLF / comma-and-comment
  handling), pin-conflict detection, the starter template, and a round-trip
  through cuttlefish's real `parseConfigFile` proving wizard output loads the
  same way the build loads it.

### Patch Changes

- ## Standalone-install dependency fixes

  Declared the dependencies each package actually consumes at build/test time,
  so installs outside the monorepo resolve without relying on hoisting:

  - **`@typecad/expect`** now declares `@typecad/hal` (a hard dependency — the
    test harness generates `cuttlefish.config.ts` files whose
    `import type { CuttlefishConfig } from '@typecad/hal'` previously failed to
    typecheck in standalone installs) and `@typecad/framework-zephyr` as an
    optional dependency (the `west build`/`west flash` compile path requires it
    dynamically and degrades gracefully when absent).
  - **`@typecad/cuttlefish`** now declares `@typecad/expect` as an optional
    dependency — `transpile.ts` loads its preprocessor and `cli-utils.ts`
    resolves the `cuttlefish-test` CLI from it, both with existing fallbacks.
  - **`@typecad/ui`** moved `@typecad/cuttlefish` from peerDependencies to
    regular dependencies (it is imported throughout `src/`), so installing
    `@typecad/ui` pulls the transpiler automatically like every other consumer.
  - **`@typecad/safety`** dropped its duplicate peerDependencies block —
    `@typecad/cuttlefish` and `@typecad/hal` were declared in both
    `dependencies` and `peerDependencies`; the regular dependencies (the pattern
    every other package uses) are kept.

- Updated dependencies
  - @typecad/cuttlefish@1.0.0-alpha.12

## 1.0.0-alpha.11

### Patch Changes

- Updated dependencies [46f25f2]
  - @typecad/cuttlefish@1.0.0-alpha.11

## 1.0.0-alpha.10

### Patch Changes

- Updated dependencies [c7ea1b5]
  - @typecad/cuttlefish@1.0.0-alpha.10

## 1.0.0-alpha.9

### Patch Changes

- Updated dependencies [a27476a]
  - @typecad/cuttlefish@1.0.0-alpha.9

## 1.0.0-alpha.8

### Patch Changes

- @typecad/cuttlefish@1.0.0-alpha.8

## 1.0.0-alpha.7

### Patch Changes

- 0320018: ## ESP32: BLE, WiFi/HTTP, RMT, native display + touch, ESP-IDF v6

  The ESP32 framework is now a first-class code-generation target alongside the
  AVR and Arduino cores, with native ESP-IDF lowering across every HAL category.

  ### BLE peripheral (NimBLE)

  - Full GATT peripheral lowering via NimBLE: `ble.server(name)`,
    `.characteristic(uuid, type, perm)`, `.onRead()/.onWrite()/.onConnect()/
onDisconnect()`, `.notify()`, `.set_tx_power()`.
  - Supports 16-bit SIG UUIDs, custom 128-bit UUIDs, and all read-value types
    (numeric, UTF-8, raw bytes). Auto-creates a default service when
    characteristics have no explicit parent.
  - Async `ble.until_connected()` split lowers to a non-blocking poll state.
  - `Preferences` backed by native NVS lowering (reads/writes persist across
    reboots); `Power.deepSleepPin()` pin-wakeup.

  ### WiFi + HTTP client (native, async)

  - Native WiFi HAL with async lowering: `WiFi.connect()` lowers to start + poll
    states so a heartbeat loop keeps running while the link comes up. AP mode,
    tx power, channel, max clients, and client-count queries.
  - HTTP client (`http.get/post`, async, HTTPS-insecure) end-to-end lowering with
    brownout-recovery fixes. Includes a hardware-test harness
    (`npm run test:http` + `test:hw:http`) and a compiled-output regression
    corpus (`demos/wifi-demo/out-samples`).

  ### RMT (ESP32-S3 onboard WS2812)

  - `rmt.*` HAL-op IR + ergonomic stubs + `hal/rmt.ts` wrapper. IR-scanning init
    lines + per-op lowering, wired into dispatch with forced `esp_driver_*`
    CMake deps. MSB-first `txInit` for WS2812. Drives the ESP32-S3 onboard RGB.

  ### Native display + touch adapters

  - Native ESP32 SPI display adapters (ILI9341, ST7796, SSD1309) and touch
    adapters (XPT2046, STMPE610, GT911, CST816S, FT6336U) with PSRAM + rendering
    fixes. License attribution headers added to touch adapters (NOTICE updated).

  ### ESP-IDF v6 migration

  - `framework-esp32` migrated to ESP-IDF v6 public APIs: NimBLE API + callback
    fixes, removed deprecated `esp_nimble_hci`/`esp_ble_tx_power_set`, volatile
    `++` replaced with `+ 1` for GCC 13+ `-Werror=volatile`. Compiles clean on
    v6 (`idf.py build` passes).

  ### Bug fixes

  - ownership-analysis: const-array demotion now fires for value-arg mutating
    methods lowered via `__RAW_STMT__` (e.g. `arr.push()` on a `const` binding no
    longer emits a non-compiling `const std::vector` + `push_back`).
  - framework-avr: the UART driver shim is kept alive for `console.*` programs,
    since the AVR console polyfill routes `console.log` through `_uart_*` symbols
    (previously emitted an undefined-symbol link error).

- Updated dependencies [0320018]
  - @typecad/cuttlefish@1.0.0-alpha.7

## 1.0.0-alpha.6

### Patch Changes

- @typecad/cuttlefish@1.0.0-alpha.6

## 1.0.0-alpha.5

### Patch Changes

- Updated dependencies
  - @typecad/cuttlefish@1.0.0-alpha.5

## 1.0.0-alpha.4

### Patch Changes

- Updated dependencies
  - @typecad/cuttlefish@1.0.0-alpha.4

## 1.0.0-alpha.3

### Patch Changes

- Updated dependencies
  - @typecad/cuttlefish@1.0.0-alpha.3

## 0.1.0-alpha.2

### Patch Changes

- Updated dependencies
  - @typecad/cuttlefish@0.1.0-alpha.2

## 0.1.0-alpha.1

### Minor Changes

- Initial publication of the TypeCAD package suite.
