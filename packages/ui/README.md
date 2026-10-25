# @avn/ui

Shared AVN React components, imported directly by the web workspace through this package’s source export. Original source: Zohaib2244/AVN-Style `073405a`, `packages/ui/src/`.

Run `npm run typecheck -w @avn/ui`. Vite bundles the components into the PlayLens static output. Shared CSS, tokens, fonts and icons remain the original AVN assets under `packages/web/public/avn-style/`.

Local shared-component fix: `Drawer` portals into the app container, owns its backdrop animation, and focuses/restores focus without scrolling. Its keyboard/focus effect runs once per open rather than on every parent update. Preserve this fix when refreshing upstream until AVN-Style incorporates it.

Local notification fix: notification IDs and timestamps are allocated before the React updater, and repeated alerts update one history entry. Preserve this StrictMode fix during upstream refreshes.

Local pipeline fix: connectors are generated between adjacent steps and derive their completion from those steps. PlayLens styles `.pl-pipeline` for a horizontal desktop rail and a vertical phone list; do not restore the style snapshot's fixed 64% progress fill.
