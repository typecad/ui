// ---------------------------------------------------------------------------
// The built-in shadcn-style kit stylesheet (tokens + class recipes). Always
// prepended to the CSS chain by BOTH pipelines (ui-registry for device
// builds, buildPreviewSnapshot for the preview) ahead of the user's CSS, so
// user rules and theme token blocks override it by cascade order. Themes are
// plain CSS files the user @imports — no registry, no splicing.
//
// Source of truth: this string. Edit here; the demos rely on it verbatim.
// ---------------------------------------------------------------------------

export const SHADCN_KIT_CSS = `/* ---------------------------------------------------------------------------
 * shadcn-style component kit — BUILT IN and always included.
 *
 * These tokens + class recipes are prepended to every build and preview
 * automatically, BEFORE your stylesheets, so anything you write overrides
 * them by normal cascade order. No scaffolding, no imports needed: put the
 * classes on native elements and they work.
 *
 * THEMES: a theme is any CSS file. Pre-packaged ones ship with @typecad/ui —
 * import by bare specifier from a <style> block (or the sidecar .ui.css):
 *
 *   @import "@typecad/ui/themes/blue.css";   (zinc slate stone gray neutral
 *                                             blue green red)
 *
 * Your own: save a ui.shadcn.com / tweakcn export into the project and
 * @import it by path — its :root/.dark token blocks override the kit
 * defaults (later definitions win). Both dialects parse — classic HSL channel triplets and
 * Tailwind-v4 oklch(); alpha in colors is ignored (no blending on bare
 * metal). Dark mode activates with themeClass: 'dark' in the config's
 * display block.
 *
 * Overriding recipes: redefine any class in your own stylesheet; your
 * definition wins.
 *
 * Components (classes over native elements):
 *   Button      <button class="btn btn-primary">Save</button>
 *               variants: -secondary -outline -ghost -destructive
 *               sizes: .btn-sm .btn-lg   full width: .btn-block
 *   Badge       <text class="badge badge-secondary">new</text>
 *               variants: -default(omit) -destructive -outline
 *   Card        <view class="card">
 *                 <view class="card-header">
 *                   <text class="card-title">Title</text>
 *                   <text class="card-description">Subtitle</text>
 *                 </view>
 *                 <view class="card-content">...</view>
 *                 <view class="card-footer">...buttons...</view>
 *               </view>
 *   Input       <input class="input" placeholder="..."/>
 *   Label       <label class="form-label">Name</label>
 *   Row (kit)   <view class="row"> ... </view>   (flex row + gap, for composing)
 *   Validation  .input-error (destructive border) + .field-error hint;
 *               runtime-driven: bind borderColor/visible to a signal
 *   Separator   <hr class="separator"/> (horizontal) or
 *               <hr class="vseparator"/> (vertical; stretches to the row height)
 *   Alert       <view class="alert alert-destructive">
 *                 <text class="alert-title">...</text>
 *                 <text class="alert-description">...</text>
 *               </view>
 *   Skeleton    <view class="skeleton"/>            (pulse while loading)
 *   Spinner     <view class="spinner"><view class="spinner-dot"/></view>
 *               (indeterminate loading: a dot orbiting a ring via pure
 *                transform keyframes — translate lerps smoothly, unlike
 *                rotate which only renders exact quarter turns)
 *   Dialog      <dialog id="d"><view class="dialog-scrim" on:click={...}/>
 *               <view class="dialog-card"> ... <view class="dialog-footer">
 *               </view></dialog>
 *               (centered modal: programmatic ui.dialog.open(id), scrim tap
 *                closes; same slot machinery as the drawer)
 *   Toast       <toast id="t" side="bottom" duration="2500" class="toast">
 *               ...</toast>  (ui.toast(id) shows it; auto-closes after the
 *               duration; stacks as authored siblings)
 *   Progress    <progress class="progress" value="40"/>
 *   Avatar      <img class="avatar" src="face.bmp"/>
 *   Switch      <check class="switch"/>             (pill container; the
 *               16px indicator is runtime-drawn at the top-left — best-effort)
 *   Tabs        <view class="tabs-list"><button class="tabs-trigger">..</button>..
 *               <view class="tabs-content-area"><view class="tabs-content">..
 *               (panes toggle via ui.bind(x, 'visible', ...) on a signal)
 *   Accordion   <view class="accordion"><view class="accordion-item">..
 *               (content toggles via ui.bind visible; chevron via text bind)
 *   Table       <table> ... </table>                (UA styles apply; see the
 *               html-table-approximation build note)
 * ------------------------------------------------------------------------- */

:root {
  --background: #ffffff;
  --foreground: #09090b;
  --card: #ffffff;
  --card-foreground: #09090b;
  --primary: #18181b;
  --primary-foreground: #fafafa;
  --secondary: #f4f4f5;
  --secondary-foreground: #18181b;
  --muted: #f4f4f5;
  --muted-foreground: #71717a;
  --accent: #f4f4f5;
  --accent-foreground: #18181b;
  --destructive: #dc2626;
  --destructive-foreground: #fafafa;
  --destructive-background: #fee2e2;
  --border: #e4e4e7;
  --input: #e4e4e7;
  --radius: 8px;
  --shadow-sm: 0 1px 3px rgb(0 0 0 / 0.1);
  /* Solid scrim for dialogs — alpha blending needs a canvas underneath, so
     the kit uses an opaque near-black that reads as a dimmed backdrop. */
  --scrim: #101014;
}

.dark {
  --background: #09090b;
  --foreground: #fafafa;
  --card: #18181b;
  --card-foreground: #fafafa;
  --primary: #fafafa;
  --primary-foreground: #18181b;
  --secondary: #27272a;
  --secondary-foreground: #fafafa;
  --muted: #27272a;
  --muted-foreground: #a1a1aa;
  --accent: #27272a;
  --accent-foreground: #fafafa;
  --destructive: #ef4444;
  --destructive-foreground: #09090b;
  --destructive-background: #451a1a;
  --border: #27272a;
  --input: #3f3f46;
  --radius: 8px;
}

/* ---- Button ---------------------------------------------------------------- */

.btn {
  border-radius: var(--radius);
  padding: 10px 16px;
  font-weight: bold;
  transition: background 80ms;
  /* Reset the UA's browser-default button border (shadcn's button reset):
     ghost must be truly borderless — variants that want one (outline)
     re-declare it themselves. */
  border: none;
}
.btn:pressed { transform: translateY(1px); }
.btn-primary { background: var(--primary); color: var(--primary-foreground); }
.btn-secondary { background: var(--secondary); color: var(--secondary-foreground); }
.btn-outline { background: var(--background); color: var(--foreground); border: 1px solid var(--border); }
.btn-ghost { color: var(--foreground); }
.btn-destructive { background: var(--destructive); color: var(--destructive-foreground); }
.btn-sm { padding: 6px 10px; min-height: 32px; font-size: 12px; }
.btn-lg { padding: 14px 22px; min-height: 52px; font-size: 18px; }
.btn-block { align-self: stretch; }

/* ---- Badge ------------------------------------------------------------------ */

.badge {
  background: var(--primary);
  color: var(--primary-foreground);
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  text-align: center;
}
.badge-secondary { background: var(--secondary); color: var(--secondary-foreground); }
.badge-destructive { background: var(--destructive); color: var(--destructive-foreground); }
.badge-outline { background: var(--background); color: var(--foreground); border: 1px solid var(--border); }

/* ---- Layout utility -------------------------------------------------------------
   Not a shadcn component — a kit convenience for composing recipes. */

.row { flex-direction: row; align-items: center; gap: 8px; }

/* ---- Card ------------------------------------------------------------------- */

.card {
  background: var(--card);
  color: var(--card-foreground);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  padding: 16px;
  gap: 8px;
  align-self: stretch;
}
.card-header { gap: 4px; }
.card-title { font-size: 18px; font-weight: bold; }
.card-description { font-size: 14px; color: var(--muted-foreground); }
.card-content { gap: 8px; }
.card-footer { flex-direction: row; gap: 8px; }

/* ---- Tabs ---------------------------------------------------------------- */

/* Segmented trigger row (shadcn TabsList). Active-trigger styling is driven
   at runtime by ui.bind background/color bindings in author code — runtime
   color swaps are literal hex (compile-time tokens), so pin them to the
   active theme the way native_demo accents do. */
.tabs-list {
  flex-direction: row;
  gap: 4px;
  align-self: stretch;
  background: var(--muted);
  border-radius: var(--radius);
  padding: 4px;
}
.tabs-trigger {
  flex-grow: 1;
  border-radius: calc(var(--radius) - 2px);
  padding: 6px 10px;
  min-height: 32px;
  font-size: 13px;
  text-align: center;
}
/* Fixed-height content region: panes are absolutely stacked inside it and
   toggled via ui.bind(x, 'visible', ...) — layout keeps every pane's box,
   so switching never re-flows. */
.tabs-content-area {
  position: relative;
  align-self: stretch;
  height: 150px;
}
.tabs-content {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  gap: 8px;
}

/* ---- Accordion (single-open) --------------------------------------------- */

/* Stacked collapsible sections. The trigger is a button + chevron row; the
   content pane toggles via ui.bind(x, 'visible', () => signal === i) — the
   same signal pattern as Tabs. The chevron swaps v/^ via a text binding. */
.accordion {
  gap: 8px;
  align-self: stretch;
}
.accordion-item {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.accordion-trigger-row {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
}
.accordion-trigger {
  flex-grow: 1;
  text-align: left;
  font-weight: bold;
  padding: 0;
  min-height: 20px;
  /* The UA sheet gives every button a 1px border (border: 1px solid, colored
     by the foreground token). A trigger is a plain text row on the card —
     cancel it or each one renders with a bright outline. */
  border: none;
}
.accordion-chevron {
  color: var(--muted-foreground);
  font-size: 14px;
  /* Wide enough for the '^' glyph (advance 12px at 14px size) — a single
     char wider than the box wraps to nothing. */
  width: 16px;
  text-align: center;
}
.accordion-content {
  padding: 0 12px 10px 12px;
  gap: 8px;
}

/* ---- Form controls ----------------------------------------------------------- */

.input {
  background: var(--background);
  color: var(--foreground);
  border: 1px solid var(--input);
  border-radius: var(--radius);
}
.form-label { color: var(--foreground); font-size: 14px; }

/* Switch: pill container. The runtime draws a 16px circular knob that
   slides with state — hollow at the left when off, solid at the right when
   on (a static jump, no travel animation). min-height overrides the UA
   touch target so the pill stays 26px tall. */
.switch {
  width: 44px;
  height: 26px;
  /* Override the UA's touch-target min-height (42px on small panels) — the
     pill must stay 26px tall to read as a switch, not a checkbox. */
  min-height: 26px;
  border-radius: 999px;
  border: 1px solid var(--border);
  /* --card, not --muted: on a bare (near-black) page background a --muted
     track reads as a stray gray box; --card keeps the pill affordance while
     staying quiet. Swap back to var(--muted) inside lighter containers. */
  background: var(--card);
}

/* ---- Checked-state pairs (shadcn data-[state=checked]) ------------------------
   The ON control carries the primary pair: the switch's TRACK turns primary
   with a primary-foreground knob, the checkbox face and the radio's selected
   ring do the same. The select's pair themes the OPTION LIST's selected row
   with the accent pair (shadcn's SelectItem selected state). These bake at
   build time from :checked rules (a separate style bucket, like :pressed);
   the device runtime swaps the pair onto the indicator when the value flips,
   and the preview draws through the same fields. */
.switch:checked {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--primary-foreground);
}
check:checked {
  background: var(--primary);
  color: var(--primary-foreground);
}
radio:checked {
  background: var(--primary);
  color: var(--primary-foreground);
}
.select:checked {
  background: var(--accent);
  color: var(--accent-foreground);
}

/* ---- Form validation states -------------------------------------------------- */

/* Static hook: always-invalid styling for hardcoded markup. Runtime-driven
   validation (recommended) binds the input's borderColor + a .field-error
   hint's visible/text to a signal — see the demo's Forms screen. */
.input-error {
  border-color: var(--destructive);
}
.field-error {
  color: var(--destructive);
  font-size: 12px;
}
.field-success {
  color: var(--muted-foreground);
  font-size: 12px;
}

/* ---- Separator ---------------------------------------------------------------- */

.separator {
  height: 1px;
  background: var(--border);
  margin: 8px 0;
}
/* Vertical: 1px wide, stretches to the row's cross height (shadcn's
   <Separator orientation="vertical" /> — flex column + align-self: stretch). */
.vseparator {
  width: 1px;
  height: 100%;
  align-self: stretch;
  background: var(--border);
  margin: 0 8px;
}

/* ---- Alert -------------------------------------------------------------------- */

.alert {
  background: var(--background);
  color: var(--foreground);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px;
  gap: 4px;
  align-self: stretch;
}
.alert-destructive {
  background: var(--destructive-background);
  border: 1px solid var(--destructive);
  color: var(--destructive);
}
.alert-title { font-weight: bold; }
.alert-description { font-size: 14px; color: var(--muted-foreground); }

/* ---- Skeleton (loading placeholder) --------------------------------------------- */

/* Opacity pulse. If the target display's keyframe support skips opacity,
   the block still renders as a static muted placeholder. */
.skeleton {
  background: var(--muted);
  border-radius: var(--radius);
  height: 16px;
  align-self: stretch;
  animation: ui-skeleton-pulse 1.2s ease-in-out infinite;
}
@keyframes ui-skeleton-pulse {
  0% { opacity: 1; }
  50% { opacity: 0.55; }
  100% { opacity: 1; }
}

/* ---- Spinner ---------------------------------------------------------------- */

/* Indeterminate loading indicator: a dot orbiting inside a ring, pure
   transform keyframes. translate() lerps CONTINUOUSLY between stops (unlike
   rotate(), which only renders exact quarter turns), so the orbit is smooth.
   The dot is absolute + out of flow; the ring is a fixed square so border
   clipping stays symmetric. Sizes: change .spinner's width/height and keep
   the dot inset consistent (orbit travel = inner - dot). */
.spinner {
  position: relative;
  width: 22px;
  height: 22px;
  border: 2px solid var(--muted);
  border-radius: 999px;
}
.spinner-dot {
  position: absolute;
  /* The dot's BASE position is the orbit's TOP-LEFT corner, not the ring
     center: the keyframes translate 0..8px from here, and the path only
     centers when base + travel/2 == ring center (with the 2px border,
     top/left 2px + border lands the 6px dot at 4,4; its center travels
     7..15 around the 22px ring's center at 11,11). */
  top: 2px;
  left: 2px;
  width: 6px;
  height: 6px;
  background: var(--primary);
  border-radius: 999px;
  animation: ui-spinner-orbit 1000ms linear infinite;
}
@keyframes ui-spinner-orbit {
  0%   { transform: translate(0px, 0px); }
  25%  { transform: translate(8px, 0px); }
  50%  { transform: translate(8px, 8px); }
  75%  { transform: translate(0px, 8px); }
  100% { transform: translate(0px, 0px); }
}
/* ---- Dialog ---------------------------------------------------------------- */

/* Centered modal: <dialog> is a centered drawer (side-free) — programmatic
   open/close via ui.dialog.open(id)/close(id?), hidden while closed by the
   runtime (visibility gate for centered panels; offsets can't hide them).
   The scrim is part of the markup: an absolute full-area view whose tap
   closes the dialog; the card sits above it. z-index keeps both over page
   content. */
.dialog-scrim {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background: var(--scrim);
  z-index: 30;
}
.dialog-card {
  position: absolute;
  left: 24px;
  right: 24px;
  top: 64px;
  background: var(--card);
  color: var(--card-foreground);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  padding: 16px;
  gap: 8px;
  z-index: 31;
}
.dialog-footer {
  flex-direction: row;
  justify-content: flex-end;
  gap: 8px;
}

/* ---- Toast ----------------------------------------------------------------- */

/* Transient notification: <toast side="bottom" duration="2500"> slides from
   the bottom edge (author-positioned, flush to the edge so the slide fully
   hides it) and auto-closes after duration ms. Show with ui.toast(id).
   Sibling toasts stack by author layout; each closes on its own timer. */
.toast {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 0;
  background: var(--foreground);
  color: var(--background);
  border-radius: var(--radius);
  padding: 12px;
  gap: 4px;
  z-index: 40;
}
.toast-title { font-weight: bold; font-size: 14px; }
.toast-description { font-size: 12px; color: var(--muted-foreground); }



/* ---- Progress / Avatar ----------------------------------------------------------- */

.progress {
  height: 12px;
  border-radius: 999px;
  background: var(--secondary);
  border: 1px solid var(--border);
  color: var(--primary);
}
/* Avatar: plain image element. The runtime draws images rectangular — no
   rounded clipping — so no border/radius here (a border would just draw
   over the image). Wrap in a sized view if you want a frame. */
`;
