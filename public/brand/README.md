# Brand assets

| File | What it is |
|---|---|
| `logo-source.png` | The original supplied logo, 337×288 RGBA with a real alpha channel. Carried over from the pre-rewrite `main` so the source asset is not lost. Treat this as the master. |
| `flowcare-mark.svg` | Vector trace of the mark, `viewBox="0 0 100 76.2"`, single path using `fill="currentColor"` so it recolours with text colour. This is what the app renders. |
| `flowcare-mark.png` | Raster fallback of the trace, transparent. |

## Rules

The mark's aspect ratio is **100 : 76.2**. Never set width and height
independently — derive height as `width × 0.762`. `FlowCareMark` in
`src/components/Brand.tsx` does this from a single `size` prop, which is why
every surface should use that component instead of an `<img>`.

Brand colour is `#3DBBB9`, sampled from the logo. It is `brand-500` in
`tailwind.config.ts`; `brand-600` and darker clear WCAG AA on white for text.

Do not recolour, rotate, outline, add effects to, or stretch the mark.
