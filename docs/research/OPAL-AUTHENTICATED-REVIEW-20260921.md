# Opal authenticated workspace review

21 September 2026. Read-only inspection using a session explicitly supplied by the user. No account settings, messages, allocations or financial operations were submitted. The Thesauros interface remains unchanged during this discussion.

## Observed scope

Reviewed Home, Strategies, Activity, Network/Transparency, Help and the first Deposit dialog at desktop and 390px mobile sizes. The network chart's one-month period was selected. Activity was empty in this account. Strategies were marked locked/coming soon, so strategy detail, funded performance and execution could not be assessed. Withdrawal execution was not attempted; a later read pass timed out before its panel could be inspected. Displayed rates and backing figures were observed UI content, not independently verified financial claims.

Sources: https://app.opal.co/ ; https://app.opal.co/vaults ; https://app.opal.co/activity ; https://app.opal.co/transparency ; https://app.opal.co/faq . Authenticated pages may require a separate session when revisited.

Evidence: `work/evidence/opal-review-20260921/`. Screenshots are of the observed account state; most pages scroll inside their own containers, so a desktop screenshot captures the visible viewport rather than every card below it.

## Transferable choices

| Observed pattern | Value for Thesauros |
| --- | --- |
| A dominant center panel with a separate compact account/action column | Give institutional visitors an immediate hierarchy: platform performance centrally, allocation and useful actions alongside it. Personal deposit balance should not monopolize an unfunded partner's first visit. |
| Product cards combine identity, rate, short explanation and availability | Explain each real Thesauros vault or yield source through comparable fields. Details can hold contracts and individual adapters. Sparklines should use actual observations, with empty states when history is missing. |
| Transparency combines current metrics, a period selector and asset composition | Put historical performance, current allocation and recent rebalances into an intelligible operating view. Keep timestamps and source/transaction links accessible. The observed Opal chart is token price, not proof of historical strategy returns. |
| Deposit begins with a task-oriented choice in a focused dialog | Keep explanations close to decisions. Thesauros's first-use guide should explain the partner proposition and point into metrics, trying Earn and Developers. It can then be dismissed; no compulsory cinematic sequence. |
| Pale neutral canvas, soft white surfaces, restrained gradients and generous spacing | Use depth and selective brand color to make a data-rich workspace feel designed. Preserve Thesauros typography and navy identity; a large dark empty balance need not be the dominant institutional surface. |

## Choices to avoid

- Mobile strategy cards retain two narrow columns at 390px. Text breaks into many short lines, labels become cramped and locked buttons clip inside cards. Use full-width cards and readable actions on narrow Thesauros screens.
- Pale inactive navigation and small secondary text reduce readability. Keep restrained styling with sufficient contrast and useful text labels.
- Empty personal balance, unavailable products and future features take much of the observed Home/Strategies space. Our prospective partner should see working infrastructure evidence without first depositing.
- Similar miniature curves appear on different strategy cards. Their data provenance was not established. They are not a template for invented Thesauros performance history.
- Points and rewards are outside the agreed Thesauros scope. No change to that decision.

## Proposed first institutional screen — for discussion

After the brief Quick guide: a concise platform summary, then a large real performance chart with an explicit vault/network and period. Beside it, allocation and two task entries: try Earn, open Developers. Below, recent rebalance operations with source, destination, time, status and evidence where the source supplies those fields. Each block links into the deeper page rather than trying to hold the entire system on the home screen.

The proposed Overview / Performance / Vaults & Operations / Your Capital / Developers organization remains open for user discussion. This review supports presentation and hierarchy choices; it does not validate unavailable data pipelines, partner authorization or production API readiness.
