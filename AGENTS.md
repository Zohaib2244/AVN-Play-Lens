# AVN PlayLens

Design: follow AVN-Style (SKILL.md in the AVN-Style repo). UX: avn-ux · Style: avn-family

- Design snapshot and shared `@avn/ui` source: `packages/web/src/design/`. See its README for source and update instructions.
- Preserve game-scoped capture, replay labels and the distinction between runtime evidence and manual checks. Never invent test measurements.
- Existing React 19 JavaScript pages and the WebSocket data layer remain in use during the design migration; shared AVN components use TypeScript. State-based routing is retained with URL synchronization so back/forward and copy links work without replacing the game-capture lifecycle.
- Use design tokens for colours, fonts and shape. Verify wide, tablet and phone layouts, dark/light, a second palette, keyboard navigation and reduced motion.
- Page opens and switches use Motion: fade outgoing content for 120 ms, then rise incoming blocks 50 ms apart. Respect reduced motion and keep live data updates steady.
- Validate with `npm run build` and `npm test`.
