# Market Maps

Public, sourced, agent-refreshed VC market maps. The first map covers **Personal AI Agents** — US companies building agents that act on your behalf across your personal life.

The design rule the whole repo enforces: **every figure carries its source, or it is explicitly marked as having none.** A market map nobody can check is a screenshot.

```
npm install
npm run validate     # schema + editorial rules
npm test             # refresh-agent guardrails (no API key needed)
npm run build        # → dist/
npm run preview      # → http://127.0.0.1:5173  see the whole site locally
npm run admin        # → http://127.0.0.1:4321  edit data by hand
npm run refresh:dry  # agent proposes, writes nothing
```

## Seeing it before you push

`npm run preview` builds and serves the site on localhost. Nothing is published and
nothing leaves your machine — it is the same `dist/` the deploy uses.

Two link modes exist because root-relative links (`/changelog/`) need a real server:

| Command | Links | Use for |
|---|---|---|
| `npm run build` | `/changelog/` | Production deploys |
| `npm run preview` | `../changelog/index.html` | Localhost, or opening `dist/index.html` directly |

`npm run build:relative` gives you the relative build without starting a server —
useful if you want to host the site inside a subdirectory.

## How it works

### Exploring the map

The interface has three editorial focus groups: personal assistants, work and
productivity, and knowledge and memory. Ownership is a separate filter. Search
matches company names, aliases, and capability descriptions; category counts
reflect the active search and ownership selection.

Choose context breadth or distribution for the vertical axis, and valuation,
total funding, or equal size for the marks. Financial bubble **area** is
proportional to the selected figure on a fixed dataset-wide scale. Platform
products use colored squares; undisclosed company figures use hollow circles.
Manual values and sourced estimates are labeled. The methodology section
publishes the scoring rubrics and scope from the canonical dataset.

The mobile default is a sortable company list. The map remains available with
horizontal scrolling. Profiles open in a keyboard-accessible dialog and retain
founders, investors, confidence notes, and source links. The research feed groups
duplicate article URLs and follows the current filters. View settings persist in
the URL, including an explicit map/list choice across devices.

The map is maintained in `templates/map.html`, `map.css`, `map.js`, and
`map-model.mjs`; the build inlines them into one portable HTML page. `npm test`
also checks the map's financial encoding, saved settings, filters, and article
grouping.

There is no database and no backend. Data is JSON in git, and **the review queue is a pull request.**

```
data/markets/*.json   ← the only source of truth
      │
      ├── scripts/validate.mjs   schema + rules that a schema can't express   (CI, every PR)
      ├── scripts/build.mjs      → dist/ : map, one page per company, changelog
      ├── scripts/preview.mjs    local server, see it before you push
      ├── scripts/admin.mjs      local form editor, writes back to the JSON
      └── agent/refresh.mjs      weekly: proposes changes as a PR you approve
```

Merging a PR deploys the site and adds the diff to the public changelog. Git gives you the review queue, audit log, version history and rollback for free.

## The data model

Two details carry the design:

**`source` on every figure**, not one citation per company. This is what lets a page say "as of Aug 2026, per TechCrunch" and mean it.

**`locked`** is your manual override. Add a dot-path — `"locked": ["lastRound.postMoneyUsd"]` — and the weekly agent is forbidden from touching it. Without this, a number you typed in by hand silently disappears on the next Monday run. The admin editor's padlock buttons write this array; `agent/refresh.test.mjs` proves the agent honors it.

`confidence` is one of `reported | estimated | rumored | manual | undisclosed`. A figure you typed yourself with no source is automatically downgraded to `manual`, so the UI never implies a citation that doesn't exist.

`confidence` describes the **round**; `postMoneyConfidence` describes the **valuation**, falling back to `confidence` when absent. They are separate because a round can be well reported while the post-money beside it was typed in by hand — Pally's $5.2M seed is sourced to Dealroom, but its valuation is not. The company page reflects this: the round row cites Dealroom, the valuation row does not.

A `manual` figure is treated as a different kind of claim everywhere it appears: the panel and company page say *"entered by hand · no public source"* instead of citing the round's article. The map itself makes no distinction — a bubble is sized by its valuation whether that figure was reported or entered by hand — because the map's job is to show relative scale, and splitting the visual language into two categories made it harder to read for a difference the panel already states plainly.

## Validation rules

`npm run validate` enforces the JSON Schema plus the editorial rules it can't express:

| # | Rule |
|---|------|
| 1 | Any confidence other than `undisclosed` must carry a source |
| 2 | A stated post-money must carry a source, unless it is openly hand-entered (then rules 4 and 4b apply) |
| 3 | `platform` companies must not carry a valuation — a parent's market cap is not a bet on one product |
| 4 | An `estimated` or `manual` valuation must carry a note explaining the basis |
| 4b | A `manual` valuation must be locked, or the agent will overwrite it |
| 5 | Every `locked` path must resolve to a real field |
| 6 | No date may be later than `market.asOf` |

Rule 4 caught a real gap on its first run: Superhuman's $825M was marked estimated with nothing saying it was a pre-acquisition primary round rather than an exit price.

## The weekly agent

One GitHub Action, Mondays 06:00 ET. Five stages, each a narrow model call — cheaper and far easier to debug than one long loop.

| Stage | Model | Job |
|-------|-------|-----|
| 1 Discover | Haiku 4.5 | Poll RSS + SEC EDGAR Form D, triage headlines |
| 2 Extract | Sonnet 5 | Read articles → typed claims with sources |
| 3 Reconcile | Sonnet 5 | Diff against live data, apply guardrails |
| 4 Propose | — | Write JSON + a human-readable PR body |
| 5 Publish | you | Merge; CI validates, builds and deploys |

**Never Opus in this loop** — 2.5× Sonnet for a job that is mostly reading and filling a schema.

Cost control, in order of impact: prompt caching on the system block (cache reads bill at 0.1× input), the Batch API (50% off; you're asleep), and discovering URLs from free RSS and EDGAR rather than paying $10 per 1,000 web searches. Projected **$12–15/month** for a weekly run over 20 companies.

### Guardrails

Tested offline in `agent/refresh.test.mjs`:

- Locked fields are never overwritten, including via a locked parent path
- A source older than the incumbent is rejected
- Platforms never take round data
- Two sources that disagree are **flagged, never silently picked**
- More than five field changes to one company escalates instead of applying
- The agent can never delete a company

**Run the first two weeks with `--dry-run`.** Read the PRs, close them, tune the prompts, and only then let one merge.

## Setup

1. Push this repo to GitHub (public — Actions are free for public repos).
2. Add secret `ANTHROPIC_API_KEY`.
3. For deploys, add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, plus repo variable `SITE_URL`.
4. Create a Cloudflare Pages project named `market-maps`. Free tier, unlimited bandwidth.
5. Run the refresh manually first: Actions → Weekly refresh → Run workflow, with **dry run** checked.

Total recurring infrastructure cost: a domain, about $12/year.

## Adding a market

Add `data/markets/<slug>.json` matching `schema/market.schema.json`. The build picks it up automatically — no code changes. This is the real test of whether the schema generalizes, so do it early.

## Scope of map 01

US-headquartered companies only. A company is included if it acts on behalf of an *individual* (not a team), spans at least two life surfaces, and *takes actions* rather than only answering questions.

Out of scope: coding agents, enterprise and vertical copilots, companionship AI, and agent infrastructure. Notable non-US players tracked but excluded: Manus (Singapore), Today AI (China), Fyxer (UK).

### Judged and excluded

Kept here so the boundary stays falsifiable — each name fails a stated criterion, not a mood:

| Candidate | Fails | Why |
|---|---|---|
| Notion AI | two surfaces | Assists inside one workspace; does not act across your life |
| Granola | takes actions | Reactive meeting notetaker, single surface |
| Glean | on behalf of an individual | Enterprise knowledge copilot, explicitly out of scope |
| Sierra | on behalf of an individual | Acts for a business on its customers, not for you |
| Replit Agent | scope | Coding agent, explicitly out of scope |
| tldraw computers | scope | Canvas SDK and a creative-tool feature, not a personal agent |

**Comet (Perplexity)** and **Motion** were judged *in* and added — Comet acts across every authenticated site, Motion reschedules your day unprompted. **Manus** qualified on the criteria but is Singapore-based, so it falls to the US-only scope rule. **Muse** was already on the map.

## Known gaps

- **4 of 13 non-platform companies have no valuation at all** (Littlebird, Martin, Cora, Limitless); two of those are unfixable — Cora has never raised, and Limitless's acquisition price was undisclosed. The 7 platforms are excluded by rule 3, not missing. Three figures (Duckbill, Ohai.ai, Pally) are hand-entered rather than reported.
- Bubble size switches between **post-money** and **total raised**. Total raised is known for 12 of 13 non-platform companies against 9 for valuation, so it shows more of the field at true scale; valuation is the better read on how the market prices them.
- Axis scores are editorial judgments against a published rubric. Each carries a one-line rationale; argue with them via the correction link.
- The changelog needs `fetch-depth: 0` on checkout, or it builds empty.

---

Educational use only. Figures are compiled from public reporting and may be inaccurate or out of date. Not investment advice.
