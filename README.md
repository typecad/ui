# `@typecad/ui`

**Build hardware interfaces in HTML and CSS. Ship them as C++.**

`@typecad/ui` is the display toolkit of [typeCAD/hal](https://typecad.dev):
write your microcontroller's screen the way you'd write a web page, and the
toolchain compiles it to C++ that renders directly on the display — no
browser, no DOM, no CSS engine on the device. Everything is resolved at
build time.

## Why

Graphics firmware usually means hand-positioned draw calls and pixel math,
rebuilt from scratch for every panel. But you already know a layout
language: HTML and CSS. Write markup and styles, get live data on screen
with plain bindings, and see it all in your browser before flashing — the
same markup then runs on the real display.

## Quick start

Inside a typeCAD/hal project, wire up a display with the integration
wizard:

```bash
npx @typecad/ui --config
```

It asks which panel you have, how it's wired, and whether there's touch —
then writes the display setup into your config for you.

Create `src/app.ui`:

```html
<script>
  import { ui } from '@typecad/ui';

  ui.mount(screen, { display: 'ili9341', bus: 'SPI', cs: 5, dc: 21, rst: 22 });

  export const count = ui.signal(0);

  export function incrementTaps() {
    count.set(count() + 1);
  }
</script>

<style>
  #tapBtn {
    background: #3399ff;
    border: 2px solid #1a73e8;
    border-radius: 8;
  }
</style>

<screen id="counter" style="background: #ffffff">
  <text id="label">taps: {count}</text>
  <button id="tapBtn" on:click={incrementTaps}>tap me</button>
</screen>
```

Preview it in your browser while you iterate:

```bash
typecad-hal preview
```

Then build and flash like any typeCAD/hal firmware:

```bash
npm run upload
```

## What you get

- **HTML and CSS, compiled.** A substantial subset of CSS — layout, flex,
  colors, borders, shadows, transitions — resolved at build time into
  retained-mode rendering. Nothing is interpreted on the device.
- **Reactive bindings.** `{count}` in markup stays live: signals update the
  screen when they change, and user input writes back through `bind:`.
- **Touch and input.** Buttons, sliders, checkboxes, text input — with
  resistive and capacitive touch controllers supported out of the box.
- **Browser preview.** The same UI runs in a local preview server, so most
  iteration happens with no hardware attached.
- **Themes and a component kit.** Pick a theme, or start from a
  shadcn-style component gallery and own the code.
- **Real panels.** ILI9341 and ST7796S SPI TFTs, SSD1309 OLED, custom
  drivers, and a desktop SDL target — wired with the wizard.

## Learn more

- [typeCAD](https://typecad.dev) — documentation, CSS support details, and
  element reference
- [`@typecad/hal`](https://www.npmjs.com/package/@typecad/hal) — the
  product this plugs into
- [GitHub](https://github.com/justind000/typecode) — source and demos

## License

Apache-2.0
