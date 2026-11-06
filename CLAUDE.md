# Market maps

This folder is the live project behind https://shamkhal.vc: six sourced VC market
maps built by a static Node generator. Data lives in `data/markets/*.json`;
`README.md` is the handbook (`npm run docs` renders it into `docs.html`).

## Publishing

- A push to `main` on github.com/schamkhal/market-maps deploys the site through
  Cloudflare Pages. Ask before every push; an earlier approval does not carry over.
- Before asking, run `npm run validate`, `npm test`, and
  `SITE_URL=https://shamkhal.vc npm run build`, and look at the change locally
  (`npm run preview`).
- Never handle API keys or other secrets; the owner sets them.

## Working with the owner

- A question gets an answer and a recommendation. Change nothing until the owner
  approves.
- There is no scheduled refresh agent. The owner asks for a refresh, about weekly,
  and then for the push.

## Data rules

- **Refresh.** Read first-party sources first: company sites, blogs and newsrooms,
  and the parent's product blog for platform products. Look for news from the last
  90 days. Confirm any aggregator claim against the company or tier-1 reporting
  before changing a figure. Describe a company by its main business as its own
  site shows it.
- **Checks.** Record every page visited to verify a fact in `checks`, dated the day
  it was read. `lastVerified` is the newest check's date (rule 17). Pages that block
  automated access are not worked around; use another source or leave the older
  date.
- **Figures the owner supplies** are their own estimates. Mark them `manual`, lock
  the path and explain them in a note. The map shows them as plain numbers; only the
  profile says "entered manually · source not public". Do not attribute them to
  any provider.
- **Locked fields** are not changed without the owner's say.
- **Inclusion.** An independent company needs disclosed outside funding or material
  traction. Small products that have not raised money are left off. Platform
  products qualify on the map's criteria. Excluded candidates go in
  `market.judgedExcluded` with the criterion they fail.
- **Dates.** A round is dated the day it was announced; the deal date, if different,
  goes in the note.
- **Scores.** Whole numbers in steps of 5, set against the rubric anchors, each with
  a rationale. Never change a score to fix the layout; fix the label placer
  instead. Log every change in `market.scoreLog` with its reason (rule 18).

## History

The sibling `../market-maps-archived-2026-09/` is the original copy this folder was
split from. It is archived; do not edit it.
