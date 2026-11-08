# Thesauros app: design system

Tokens and components live in `app/app/book/book.module.css`. Brand guidelines allow white and primary blue as base surfaces; the app follows that.

## Direction

Someone checks their savings at a laptop in daylight; a partner reads it at a desk. So: light, white, ruled like a statement rather than stacked in cards. Sections are divided by a hairline and rhythm. There is one blue surface per screen, and it holds the person's own balance: the hero on Portfolio, the plate on a vault page. Yield leads every screen; networks are details inside it.

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
| `--side` | `#f6f8fb` | The desktop menu column |

Colour follows the market, never its rank (`marketColor` in `lib/vault-book.mjs`): Aave `#196aff`, Compound `#0b8f7b`, Gauntlet Core `#7b5bd6`, Gauntlet Prime `#5a3fb8`, Steakhouse High Yield `#c77a12`, Steakhouse Prime `#c44b8a`, Steakhouse `#a8620f`, Smokehouse `#8a5a3c`, cash `#a9b8c7`. Thesauros lines are blue, the blue-chip index is `#5f7183`. Networks have their own colours only where capital is grouped by network.

## Type

Onest, tabular figures. Page title 32, vault facts 22, section 20, body 15, labels 13, small 12. Weights 400 and 500.

## Layout

Desktop, from 1100: the account layout people know. A 64 top bar with the brand, Docs and the account; a 240 menu on the left (Portfolio, Earn, Activity, Transparency; then Tools: Blue-chip index, Developers, Account; How vaults work and support at the foot); content up to 1320 with a 44 gutter. A vault page is two columns from 1280: content and a sticky 380 panel.

Phone, below 1100: the light layout. A 56 top bar with the brand, Connect and a menu icon; a dock of four sections at the bottom; on a vault page the panel is a sheet opened from a bar, which replaces the dock. Below 900 the tables become stacked rows.

## Components

- **Product title**: the stablecoin's mark, its name and a tag for how you leave (Instant, Multichain). Network icons are small and secondary.
- **Deposit from**: the networks of one product as pills inside the vault header, each with its rate.
- **Against the index**: a difference in points, green ahead, red behind, "now" when only today's rates can be compared.
- **Growth of 100**: Thesauros and the index rebased to 100 on the same day, labelled at the line ends.
- **Disclosure**: networks, contracts and the network map open on request.
- **Stage**: Live, Early or Pilot, set by a rule rather than chosen per vault.
- **Money map**: the vault's money split into networks and markets, to scale. The signature of the product.
- **How the split changed**: the day-by-day stack by market.
- **Share price**: with dashed, labelled gaps where no reading exists.
- **Ledger**: one row per event, grouped by day, with a transaction link.
- **Request row**: four steps and the next action, on any screen.
- **Buttons**: pills only, as the brand requires. Primary is blue, secondary is ruled.

## Motion

Only state changes: 150 ms on hover colours, 220 ms ease-out for the sheet.
