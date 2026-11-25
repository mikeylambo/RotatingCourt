# Deceiver visual test: build spec

Design doc: https://claude.ai/artifact/7gKURSKma4LFHMDuCi4tbk (the Deceiver edit plan; this file only covers the visual test).

## Goal

Test how far the game's look can go toward the Deceiver concept sheet before anything else is restyled. Show the style on **four screens**, then stop and review screenshots in context:

1. Title
2. Petition (play screen, a petitioner and the court around them)
3. Wheel (the play screen while the wheel is spinning)
4. One rot stage ("Hollowed"), shown through a dev-only preview flag

**Gameplay does not change in this pass.** No vows, tells, advice, deals, Exposure, Usurpation, saves or tuning of the wheel. The wheel's feel is protected (rule 5) and presentation stays separate from the engine (rule 6).

## References

All in `art/reference/deceiver/`. They live outside `public/art/` on purpose: `vite.config.ts` treats every PNG in `public/art/` as an in-game sprite.

| File | Use |
| --- | --- |
| `deceiver-original.png` | Primary. Painterly, mature. Source of truth for mood, materials and lighting. |
| `deceiver-alt-1.png`, `deceiver-alt-2.png` | Flat-colour alternates. Use for clean shapes, the harlequin diamond and the mask swirl. Do not copy their cartoon finish. |

The design is still being decided. Treat the original as the target and the alternates as shape references, not as approved final art.

## Extracted language (skill: slu-reference-language)

Transferable rules, to propagate across the whole game:

- **Materials:** torn cloth, stitched seams, leather straps, brass buckles and bells, aged parchment. The repo already has parchment panels, ink edges and a grain tile in `src/game/art/backdrop.ts`; extend them, do not replace them.
- **Palette family:** dusty warm grey ground, crimson, wine, black-plum, bone white, aged gold and brass.
- **Lighting:** low-key and theatrical. One warm key on the speaker, dust haze, a vignette, a crimson rim on the Deceiver.
- **Motifs:** harlequin diamond (dividers, wheel segment borders), red swirl (icons, loading, the Deceiver's mark), zigzag gold trim, torn jagged hems with bells at the points.
- **Layout:** the sheet's design-board feel (small panels, swatch strips) is allowed for records and results only.
- **Negative space:** keep it. Empty space is valid (rule 8).

Object-specific details that stay on the Deceiver only: the half-cracked mask, the corrupted blade, the hood, the hand gesture.

Preserved exceptions: the wheel face, pointer, segment icons, hazard patterns and the ask icon stay clean and high-contrast. Texture goes on frames and backgrounds only.

## Constraints from AGENTS.md that shape this spec

- **Rule 8 / ui-copy-budget:** add no player-facing strings. No tagline on the title, no name label on the Deceiver, no captions. If a screen works without a string, leave it out.
- **Rule 9:** the Deceiver is recognizable by silhouette (two-point bell hat, jagged hem, open hand), not by crimson alone. Crimson must never be the only difference between two game categories.
- **Rule 7:** add semantic visual keys, not file names (below).
- **Rule 14:** judge performance on the wheel screen at its worst case, not on the title.
- **Rule 21:** no new abstraction layers. Reuse `visuals.ts`, `backdrop.ts`, `portrait.ts`, `kit.ts`, `wheel.ts`.
- **Rule 23:** report what changed, what was tested, what was not, the real branch and commit, and the actual deploy status.

## Build

### Semantic keys (`src/game/art/visuals.ts`)

Register through the existing visual registry. A sprite at `public/art/<key>.png` already overrides the procedural factory with no code change, so painted art can be dropped in later.

| Key | Tier | Answer |
| --- | --- | --- |
| `advisor.deceiver` | hero | Procedural portrait from shapes (below). Draws into a box centred at x, y. |
| `advisor.deceiver.hand` | standard | Open palm used on the title; optional. |
| `court.backdrop` | background | Existing key. Restyle only: low-key light, haze, vignette. |
| `wheel.face` | standard | Existing key. Restyle the rim only: brass and leather, diamond studs. |

### Deceiver shapes (new file `src/game/art/deceiver.ts`, same grammar as `portrait.ts`)

Heavy ink edge using the existing `INK`, deterministic drawing, no random per frame.

- **Hat and hood:** hood shape with a gold zigzag edge; two floppy points, left in plum and right in crimson; a brass bell ball at each tip.
- **Mask:** bone ellipse, two angled dark eye slits, red swirl strokes on both cheeks and the brow, one thin crack line.
- **Coat:** wine and crimson; a zigzag gold-trimmed shoulder cape; a centre panel of two columns of harlequin diamonds in crimson and bone; a belt.
- **Hem:** jagged polygon with a small brass bell at selected points.
- **Hand:** one open palm extended (the offer gesture).
- **Sway:** bells and hat points move by a small offset from `time`. Presentation only. Disabled when `reducedMotion` is on.
- **Blade:** not drawn in this pass.

### Palette and knobs

- Palette hexes are typed constants next to `PAL` in `src/game/ui/kit.ts`. Tuning values are numbers only (`Tuning = Record<string, number>`), so hex strings cannot live in `tuning/*.json`.
- Starting hexes, to be eyedropped from `deceiver-original.png` on the first pass: ground `#6b5d5a`, crimson `#8e1f2a`, wine `#5a1420`, black-plum `#2b1a24`, bone `#e6d3bd`, gold trim `#c9983a`, brass `#b98a3a`, leather `#4a3226`.
- Numeric look knobs (vignette strength, haze alpha, key-light radius, sway amplitude, grain alpha, rot stage thresholds) go in a new `tuning/look.json` using the same schema as `tuning/court.json` (`schema`, `group`, `name`, `values`). Find how `court.json` is imported and load it the same way. Do not hard-code these.
- Keep `PAL.yes`, `PAL.no`, `PAL.haz` unchanged. The Deceiver's crimson must not appear inside the wheel face. Check that it stays distinguishable from `PAL.no` (`#c8604f`) with colour removed.

### The four screens

1. **Title.** The Deceiver half-figure in a spotlight behind the existing title, bells swaying, hand extended. No new text.
2. **Petition.** The court lit low-key with a spotlight on the petitioner. The Deceiver stands at the edge as a dark silhouette with a crimson rim. No advice logic yet.
3. **Wheel.** Rim and studs restyled. A small bell on the pointer. Segment geometry, speed, hit timing and the telegraph all untouched. High-contrast mode strips texture and the rim finish.
4. **Rot stage.** A pure function `rotStage(state)` returns 0 to 3. In this pass it returns 0 except when a dev-only flag (for example `?look=hollowed`, guarded by `import.meta.env.DEV`) forces a stage. The flag must not exist in a production build. Stage 2 ("Hollowed"): cracks and empty racks on the backdrop, black and bone palette, crimson creeping from the Deceiver's side.

### Accessibility and settings

- `highContrast`: no grain, no haze, no rim texture; thick outlines as now.
- `reducedMotion`: no sway, no dust motion.
- `textScale` and all existing inputs unchanged. Keyboard, touch and gamepad parity must still pass.

## Out of scope for this pass

Vows, tells, the Deceiver's advice, deals, Exposure, Usurpation, endings, the tutorial, Daily mode changes, audio events, and any save change. When the vow system arrives it needs a profile schema bump with a migration (rule 20; `ProfileStore` has a note for this).

## Validation

Run `npm run verify`. Then prove gameplay did not move:

- `npm run balance` must give the same win rates as before the change, because only presentation changed.
- `tuning/court.json` is unchanged in the diff.

Screenshots in headless Chromium, before and after, for the four screens at 390x844 and 1280x720. Review them in context, not as isolated assets.

Performance: measure frame time on the wheel screen with a hazard wheel, before and after. Do not claim performance from the title screen. If it was not measured, say so.

Also run `slu-certify web` and `slu-certify mobile` and report the results separately.

## Report format (rule 23)

State what changed, what was tested, what was not tested, the real branch and commit, and the actual deploy status. List separately: blockers, important follow-ups, polish.
