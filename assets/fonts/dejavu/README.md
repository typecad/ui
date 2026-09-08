# Bundled DejaVu fonts

These are the unmodified TrueType files from the [DejaVu fonts] project,
release **2.37** (the final upstream release). They are bundled here so every
typeCAD UI project gets an antialiased, continuously-sized font out of the
box (see `@font-face` injection in `packages/ui/src/ui-engine/default-font.ts`).

Do **not** rename or modify these files: the license terms (Bitstream Vera
License, see [LICENSE](./LICENSE)) permit free redistribution of unmodified
copies under the original name, but modified variants must be renamed to
something without the word "DejaVu". Build-time subsetting/rasterization into
glyph bitmaps is fine — only the installable font files must stay pristine.

## Files

| File                    | Face        | Used for                                  |
| ----------------------- | ----------- | ----------------------------------------- |
| `DejaVuSans.ttf`        | Regular     | Default injected face (weight 400)        |
| `DejaVuSans-Bold.ttf`   | Bold        | Default injected face (weight 700)        |
| `DejaVuSansMono.ttf`    | Mono Regular | Default injected mono face (`pre`/`code`/`kbd`) |
| `DejaVuSansMono-Bold.ttf` | Mono Bold | Default injected mono face (weight 700) |
| `DejaVuSans-Oblique.ttf`| Oblique     | Opt-in via `@font-face` (italic)          |
| `DejaVuSans-ExtraLight.ttf` | ExtraLight | Opt-in via `@font-face` (weight 300)  |

Only `DejaVuSans(.ttf/-Bold.ttf)` and `DejaVuSansMono(.ttf/-Bold.ttf)` are
injected by default (the "DejaVu Sans" and "DejaVu Sans Mono" families); the
oblique and extra-light faces ship for projects that declare them explicitly.
Devices never receive these files — the build rasterizes the exact (family,
px, weight, style, characters) subsets a UI uses into glyph tables.

## Checksums (SHA-256, release 2.37)

```
e6476c1b80502924294eed40894c5b18e06c181444ca953e5334262df9c27724  DejaVuSans-Bold.ttf
6cb0746a1f68d176bebe83752cee35ebdf726cb1a1e88a01fc038ddf76de9ea8  DejaVuSans-ExtraLight.ttf
4af75fa16ee6d3ad43e1ecec41862c24954af26a55c6bb1ebb27bd486a50f5f4  DejaVuSans-Oblique.ttf
7da195a74c55bef988d0d48f9508bd5d849425c1770dba5d7bfc6ce9ed848954  DejaVuSans.ttf
b4a6c3e4faab8773f4ff761d56451646409f29abedd68f05d38c2df667d3c582  DejaVuSansMono.ttf
bce60f1b4421acd9ea51ba6623d7024ecbe6817a953e3654df62a5e6bdf8f769  DejaVuSansMono-Bold.ttf
```

## License

Bitstream Vera License (DejaVu variant) — permissive, GPL-compatible, free to
redistribute and embed in commercial firmware. The full text is in
[LICENSE](./LICENSE) and must accompany any redistribution of these files.
Generated font tables carry an attribution comment pointing back here.

[DejaVu fonts]: https://dejavu-fonts.github.io/
