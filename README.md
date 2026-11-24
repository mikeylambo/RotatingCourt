# Rotating Court

A 25-day reign on the SLU Web Shell. Five petitioners a day: read the ask, decide, then stop the wheel on the segment you want. Hazards ride the wheel, stats interlock, and rulings land days later.

## Run

```bash
npm install          # needs GitHub access to the private shell (see docs in the shell repo: PRIVATE-REPO-INSTALLS.md)
npm run dev          # add ?tune to open the tuning panel (dev builds only)
npm run verify       # type-check, node tests (incl. balance table), production build
npm run balance -- --runs 10000   # headless balance bots; --set '{"effectScale":0.9}' to try overrides
```

The shell is pinned by commit SHA in `package.json`.

## Controls (one semantic `stop` action)

| | Stop | Menus | Pause | Yes/No intent (Settings → Auto-stop) |
|---|---|---|---|---|
| Keyboard | Space / Enter | arrows / WASD, Enter, Esc | Esc / P | Y / N or ←/→ |
| Mouse / touch | click / tap anywhere on the court | tap | pause button | on-screen ✓ / ✕ |
| Gamepad | A / X / Y | D-pad or stick, A, B | Start | RB / LB |

## Where things live

- `tuning/court.json` – every game number (also the schema for the tuning panel and the balance bots).
- `src/game/data/*.json` – 24 petitioners × 2 requests, 6 recurring arcs, 8 omens, 12 hazard kinds, achievements, trials.
- `src/game/engine.ts` – pure, seeded stat engine and wheel. `src/game/run.ts` – presentation only.
- `src/game/audio/synth.ts` – semantic events → synthesized sounds.

## Art swap contract

Everything draws through semantic keys: `petitioner.<id>`, `ruler.king`, `court.backdrop`, `wheel.face`.
Drop `<key>.png` into `public/art/` (petitioners: transparent 512×512, one neutral pose) and it replaces the procedural art with no code change. Missing files fall back to procedural.
