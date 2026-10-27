# AVN PlayLens

Design: follow AVN-Style (SKILL.md in the AVN-Style repo). UX: avn-ux · Style: avn-family

- Design snapshot and shared `@avn/ui` source: `packages/ui/src/` and `packages/web/public/avn-style/`. See `packages/web/src/design/README.md` for source and update instructions.
- Preserve game-scoped capture, replay labels and the distinction between runtime evidence and manual checks. Never invent test measurements.
- Frontend stack: React 18 + strict TypeScript + Vite; shared `@avn/ui` workspace package; plain AVN CSS, Motion and Radix; TanStack Router, Query, Table and Virtual; uPlot live charts. Keep one WebSocket capture provider mounted above page transitions. Query handles HTTP resources and cancellation; high-volume logs stay in bounded buffers, scoped by device/game/stream ID. Router owns URL view, filters, sorting and density. The Node backend and executable packaging remain unchanged, as prescribed by the skill.
- Use design tokens for colours, fonts and shape. Verify wide, tablet and phone layouts, dark/light, a second palette, keyboard navigation and reduced motion.
- Page opens and switches use Motion: fade outgoing content for 120 ms, then rise incoming blocks 50 ms apart. Respect reduced motion and keep live data updates steady.
- Drawers must never shift or jitter the underlying page: portal into the app overlay container, focus with `preventScroll`, and do not repeat focus on live updates.
- Saved session deletion uses one Cancel/Delete confirmation; never require typing the session name.
- Validate with `npm run typecheck`, `npm test`, `npm run build` and `npm run test:e2e`. Browser tests use isolated replay data and never mutate the user’s saved library.

## UX preferences

- Lead game overviews with the active phone, capture status and explained issues; navigation belongs in the sidebar.
- Keep Main, Inspect and Tools distinct. Game changes belong in the sidebar switcher or an explicit command, never an in-page filter.
- Prefer real phones over replay simulators; label simulated evidence clearly. Show device selection separately from connection management and expose Wi-Fi auto-reconnect as a switch.
- Saving capture sessions is optional. Never archive unsaved captures on pause, stop, restart, device/game changes or disconnect.
- Notifications open below the bell and repeated alerts occupy one history entry.
- Keep form focus and expanded config values stable during live updates. Use registered config types and plain event/parameter names; omit internal fetch labels and diagnostic noise.
- Resize icon uploads automatically and tint game cards from their icons. Explain palette, density and refresh controls in plain language.
- Command search works from every page and collects explicit game/device parameters before running scoped actions.
- Startup connectors reflect actual completed steps. SDK cards omit probe, country/adapter and ad-format footnotes.
- Events use readable spaced parameter chips and state whether Firebase recorded them on the device; never imply that a plugin send proves server delivery.
- Expand config fields with broad named controls and show structured values across the available width. Missing/static fallbacks are explicit errors with plain source labels.
- Command rows have content-driven height, consistent title/package spacing and game artwork; omit repeated action hints and current-game suffixes.
- Auto-reconnect saves keep connection buttons, card geometry and selection stable.

- Keep queued/running game installs visible beside the persistent game heading across sections; use a play icon for Start game and explicit Watch a folder / Single APK or AAB source labels.
