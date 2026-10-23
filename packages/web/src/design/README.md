# AVN design system

Shared components and CSS copied unchanged from [Zohaib2244/AVN-Style](https://github.com/Zohaib2244/AVN-Style), commit `073405a`. CSS, fonts and SVGs live in `../../public/avn-style/` and are linked directly from `index.html` in upstream order. `board/index.html` is the visual reference.

Vite aliases `@avn/ui` to `ui/index.ts`. Keep upstream component fixes in AVN-Style and refresh this snapshot together with its styles.

PlayLens uses AVN UX with AVN Family. Existing React 19 / JavaScript pages and the Node/WebSocket data layer are retained to keep this UX migration focused. New shared components use upstream TypeScript, Motion and Radix. Fonts are bundled locally for offline use. `dora.svg` is the all-clear scene extracted from the same upstream board, styled by its original `flavour.css`.
