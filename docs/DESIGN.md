# Thesauros app: design system

Tokens and components live in `app/app/book/book.module.css`. Brand guidelines allow white and primary blue as base surfaces; the app follows that.

## Direction

Someone checks their savings at a laptop in daylight; a partner reads it at a desk. So: light, white, ruled like a statement rather than stacked in cards. Sections are divided by a hairline and rhythm. There is one blue surface per screen, and it holds the person's own balance: the hero on Portfolio, the plate on a vault page.

## Colour

| Token | Value | Use |
|---|---|---|
| `--ink` | `#0b1b2b` | Text, the map's vault bar |
| `--ink-2`, `--ink-3`, `--ink-4` | `#41535f`, `#5f7183`, `#93a1ae` | Supporting text, labels, comparison lines |
| `--rule`, `--rule-soft` | ink at 12%, 7% | Section and row lines |
| `--well` | `#f3f6fb` | Inputs, callouts, inactive controls |
| `--blue`, `--blue-deep`, `--blue-wash` | `#196aff`, `#0f56db`, `#eaf1ff` | Brand surface and actions, links and current page, Live and move tints |
| `--good`, `--bad` | `#0a7a3c`, `#c0000a` | Money in, errors |
| `--warn`, `--warn-wash` | `#8f5200`, `#fff4e6` | Pilot, notices, valuation gaps: the brand's orange, darkened for text |

Colour follows the market, never its rank (`marketColor` in `lib/vault-book.mjs`): Aave `#196aff`, Compound `#0b8f7b`, Gauntlet `#7b5bd6`, Steakhouse High Yield `#c77a12`, Steakhouse Prime `#c44b8a`, cash `#a9b8c7`.

## Type

Onest, tabular figures. Page title 32, vault facts 22, section 20, body 15, labels 13, small 12. Weights 400 and 500.

## Layout

Top navigation, content up to 1280 wide with a 40 gutter (16 on phones). A vault page is two columns from 1200: content and a sticky 380 panel. Below that the panel is a sheet opened from a bar at the bottom, which replaces the dock. Below 900 the tables become stacked rows.

## Components

- **Marks**: network icons in a fixed square, so a vault on two networks lines up with one on one.
- **Stage**: Live, Early or Pilot, set by a rule rather than chosen per vault.
- **Money map**: the vault's money split into networks and markets, to scale. The signature of the product.
- **How the split changed**: the day-by-day stack by market.
- **Share price**: with dashed, labelled gaps where no reading exists.
- **Ledger**: one row per event, grouped by day, with a transaction link.
- **Request row**: four steps and the next action, on any screen.
- **Buttons**: pills only, as the brand requires. Primary is blue, secondary is ruled.

## Motion

Only state changes: 150 ms on hover colours, 220 ms ease-out for the sheet.
