# Phase 3 — Craft

Structure and behaviour are settled by Phases 1 and 2. Phase 3 is presentation: the typographic
system, club identity, the distribution chart's missing scale, and theming.

Depends on Phase 1 (headline strip, mobile card list) and Phase 2 (fixture navigation).

## Goals

- Text is set for reading, numbers for comparing.
- Clubs are identifiable without reading a string.
- The finishing-position bar can be read, not just compared.
- The app works in light and dark.

---

## 3.1 Typographic split

`app.css:21` sets `'SF Mono', 'Menlo', 'Consolas', monospace` at 13px on `:root` — everything
inherits it, including club names, prose in the help and Monte Carlo modals, and button labels.
Monospace is right for the numeric columns and wrong for everything else.

| Token | Applies to | Value |
|-------|-----------|-------|
| `--font-ui` | Body, headings, labels, buttons, prose | System UI stack |
| `--font-mono` | Numeric cells, Elo, scorelines, match times | Existing mono stack |

- `:root` switches to `--font-ui`. Numeric table cells, the score button, `FixturePrefix` times,
  and the Elo column opt back in with `--font-mono`.
- Every numeric cell gets `font-variant-numeric: tabular-nums` so columns stay aligned under the
  proportional face.
- Raise base size from 13px to 14px, and set club names to 14px with a tighter line-height. The
  current 13px mono is the densest text in the app and the hardest to scan.
- Audit `app.css` for hardcoded assumptions about character-cell width introduced by the mono
  default — column widths in `.league-table` and `.projections-table` are the likely sites.

This is the widest-reaching visual change in the redesign. Land it alone, and screenshot every
view at 1280px and 375px before and after.

## 3.2 Club crests

`Team.crest` exists in the model (`engine/src/engine/types.ts:7`, `string | null`) and is `null`
for every club in the current data. Populating it removes a string-read from every scanning task.

Scope, in order:

1. **Web-side rendering first, data second.** A `TeamBadge` component takes `Team` and renders the
   crest when present, falling back to the existing short-code chip. Nothing breaks while every
   crest is null.
2. Use it in `LeagueTable`, `FixtureList`, `ProjectionsTable`, `ProjectionCardList`,
   `TeamRatingsModal`, and the Phase 1 headline strip.
3. **Then** source the images. Decide and record: licensing, whether crests are committed to the
   repo or fetched, and how the public export bundles them — `web/public/data/` is the only asset
   channel the static build has. Do not fetch crests from a third-party host at runtime; the public
   build must stay self-contained.

If sourcing stalls on licensing, steps 1–2 still pay off: the short-code chip becomes a single
consistent component instead of the `<span className="league-table-short">` markup currently
repeated across four files, and the `CODE Full Name` duplication can then be resolved centrally
(code only at ≥1024px in wide tables, name only elsewhere).

## 3.3 Distribution bar gets a scale

`PositionDistributionBar.tsx` renders one flex segment per finishing position, coloured by zone,
with the count in a `title` attribute. You can compare two teams' spreads; you cannot read either.
On touch the `title` never appears, so mobile has no readout at all.

- **Shared axis.** One 1–20 ruler at the top of the `Finishing positions` column (desktop) or above
  the card list (mobile), with ticks at 1, 4, 5, 17, 20 — the zone boundaries the colours already
  encode. Each row's bar aligns to it.
- **Fixed scale.** Segments currently use `flexGrow: count`, which drops zero-count positions and
  makes each row's horizontal axis its own. Switch to a fixed 1–20 axis with per-position width so
  bars are comparable across rows, and encode frequency as segment height or opacity rather than
  width. This is the substantive change in this item; treat the rest as follow-on.
- **Readout.** Hover (pointer) and tap (touch) reveal `Nth: 1,234 (24.7%)`. Keep the existing
  `role="img"` + `aria-label` summary for screen readers.
- **P10–P90 markers.** Thin ticks at the 10th and 90th percentile of the finishing distribution,
  computed in the component from `positionCounts`. Gives the eye a confidence interval without a
  legend.

Still no charting dependency — this stays CSS and inline SVG, consistent with `Sparkline.tsx` and
the note in [../web.md](../web.md).

## 3.4 Light theme

`app.css:2` hardcodes `color-scheme: dark` and all tokens are dark-only.

- Move the palette into a `:root` light set plus a `@media (prefers-color-scheme: dark)` override,
  or the reverse — dark stays the default look, but the choice becomes explicit.
- Add a `:root[data-theme]` escape hatch and a toggle in the `More` menu, persisted to
  `localStorage`. Explicit choice wins over the media query in both directions.
- The four zone colours (`--zone-champion`, `--zone-champions-league`, `--zone-europa`,
  `--zone-relegation`) are load-bearing — they carry meaning in the table, the legend and the
  distribution bars. Each needs a light-mode value meeting 3:1 contrast against the light surface,
  and the pairs must stay distinguishable for the common colour-vision deficiencies. Verify before
  shipping; these are the only colours in the app that encode data.
- `--green` / `--red` in the projections table and goal-difference cells need the same treatment.

## 3.5 Smaller corrections

Independent, none blocking:

| Item | Fix |
|------|-----|
| Header repeats the run count — `Monte Carlo 1,000 · 1,000 runs` (`App.tsx:350-354`) | Show the name; show `· N runs` only when the name does not already contain the count |
| `TeamRatingsModal` clips its last row mid-height | Give the scroll container a row-multiple max-height and a scroll shadow so it reads as scrollable |
| Elo values are editable with no affordance | Render them as inputs, or add an edit glyph per row |
| `Number of seasons` is a bare input | Add presets (1k / 5k / 25k) and a rough time estimate derived from the last run's `elapsedMs`, which the API already returns |
| `zone-legend` repeats under every table | Once per view, next to the table title |

---

## Acceptance criteria

- [ ] Prose and labels render in the UI face; numeric columns render in mono with tabular figures
      and stay aligned.
- [ ] No layout regressions at 1280px or 375px against pre-change screenshots.
- [ ] `TeamBadge` is the only place short codes and crests are rendered.
- [ ] With all crests null, the UI is visually unchanged from Phase 2 apart from typography.
- [ ] Distribution bars share one 1–20 axis and are comparable across rows.
- [ ] A finishing-position figure can be read on touch without a mouse.
- [ ] The app is usable in light mode; all four zone colours meet 3:1 against their surface in both
      themes and remain mutually distinguishable.
- [ ] Theme preference persists across reloads and overrides the system setting.
- [ ] Public build remains self-contained — no runtime requests to third-party hosts.

## Verification

```bash
cd web && npm run typecheck
```

Screenshot matrix before and after 3.1: every view × {1280, 375} × {light, dark}. Contrast-check
the zone palette in both themes. Confirm the public build issues no external requests — load it
with devtools network filtered to third-party origins.

## Risks

- **3.1 touches every screen.** Land it in its own commit, separate from 3.2–3.5, so a revert is
  cheap.
- **3.3 changes what the bars mean.** Moving from proportional-width to fixed-axis alters every
  existing reading of the chart; if anyone has interpreted these bars before, say so in the release
  note.
- **3.2 has an unresolved dependency.** Crest licensing and hosting is a decision, not an
  implementation task. Steps 1–2 must be shippable without it, and they are.
- **3.4 can silently break the data colours.** Contrast is checkable; distinguishability under
  colour-vision deficiency is not caught by a contrast ratio. Check both.
