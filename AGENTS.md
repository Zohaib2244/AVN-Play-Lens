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
