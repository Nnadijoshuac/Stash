# Stash design

## The one idea

**Every stash lands as a splat.** The logo is a flat orange splat of thick liquid: a bit of every
payment, dropped in. The splat is the brand's signature move. It appears in the logo, and it
lands on screen at the end of every stash, the peak moment of the flow. Nothing else splashes.

## Colour (60 / 30 / 10)

Orange is warm, so the page is cool (colour-wheel rule).

| Token | Value | Use |
| --- | --- | --- |
| `--paper` | `oklch(97.6% 0.006 255)` | 60%. The page, a cool near-white |
| `--card` | `#ffffff` | Cards on the paper |
| `--ink` | `oklch(21% 0.035 262)` | 30%. Text, and the dark "stashed so far" card |
| `--ink-2` | `oklch(46% 0.025 262)` | Secondary text |
| `--line` | `rgb(18 26 43 / 0.10)` | Borders (alpha, never solid grey) |
| `--orange` | `#FF5A1F` | 10%. The logo, and **only** the main action (Stash, Sign & stash) |
| `--orange-soft` | `oklch(95% 0.035 45)` | Hover and tint behind the orange |
| `--up` / `--down` | `oklch(58% 0.13 152)` / `oklch(55% 0.16 25)` | 24h change only |

## Type

**Inter** (the owner's rule), with tabular figures for every number. The largest thing on screen
is the dollar amount: "stashed so far" on the home page, and the stash amount in the confirm
sheet. Headlines use `clamp()`.

## Motion

- Entrances: scale 0.97 with opacity 0, ease-out, 200ms.
- Buttons: press to 0.97 over 150ms.
- The splat on success: one 450ms land (scale 0.6 to 1.04 to 1), plus droplets. This is the only
  playful motion.
- `prefers-reduced-motion`: no scaling, fades only.

## References

- **Acorns:** one brand colour; a plain-verb promise; the honest disclaimer right under the hero.
- **Phantom:** one signature move, repeated.
- **Jupiter:** calm, dense money UI with inset panels.

All three are in `~/.claude/design-library/README.md`.

## Honesty in the UI

- The page always says it runs on a **local mainnet fork with fake money**, and that **the wallet
  key stays in this browser**.
- No invented ratings, users or returns.
