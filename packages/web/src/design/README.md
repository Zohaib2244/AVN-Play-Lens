# AVN design system

Shared components and CSS originate from [Zohaib2244/AVN-Style](https://github.com/Zohaib2244/AVN-Style), commit `073405a`. The original React/TypeScript components live in the `@avn/ui` workspace at `packages/ui/src/`; apps import the package directly. Keep upstream component fixes in AVN-Style and refresh this snapshot with its styles.

The local shared drawer focus/portal fix is recorded in `packages/ui/README.md`; preserve it during upstream refreshes.

Original CSS, fonts and SVGs live in `packages/web/public/avn-style/` and are linked from `index.html` in upstream order. `board/index.html` is the visual reference. Fonts are also bundled locally for offline use. `dora.svg` is the all-clear scene extracted from the upstream board and styled by its original `flavour.css`.

PlayLens follows AVN UX with AVN Family. Its frontend uses React 18, strict TypeScript, Vite, Motion, Radix, TanStack Router/Query/Table/Virtual, uPlot, Vitest and Playwright. App-specific page transitions, adapters and layouts live under `packages/web/src/`; shared UI source is not forked per page.
