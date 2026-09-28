# Market Maps

Public, sourced, agent-refreshed VC market maps. The first map covers **Personal AI Agents** — US companies building agents that act on your behalf across your personal life.

The design rule the whole repo enforces: **every figure carries its source, or it is explicitly marked as having none.** A market map nobody can check is a screenshot.

```
npm install
npm run validate     # schema + editorial rules
npm test             # agent guardrails, rules, build, labels, admin (no API key needed)
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

Focus groups, quadrant names and axes are data, not code: `market.categories`,
`market.quadrants` and `market.axes` in the market file, with a `category` on every
company. Each axis carries its label, an optional `short` label for controls, its
rubric, and `low`/`high` phrases printed at the ends of the axis. Map 01 has two
groups, personal assistants and work and productivity. Ownership is a separate
filter. Search matches company names, short names, brands, aliases and capability
descriptions; category counts reflect the active search and ownership selection.

Choose either vertical axis the market defines (context breadth or distribution for
map 01), and valuation, total funding, or equal size for the marks. Financial bubble **area** is
proportional to the selected figure on a fixed dataset-wide scale. Figures too
small to see at true area are drawn at a minimum size, never smaller than the
hollow mark for an undisclosed figure, and the size legend states that threshold
alongside reference circles picked from the data's own range. Platform products
use colored squares labelled with their consumer brand (`brand`: Google, not
Alphabet); undisclosed company figures use hollow circles. Manual values and
sourced estimates are labeled. The methodology section publishes the scoring
rubrics and scope from the canonical dataset.

The chart is drawn at the width of the screen, so it never scrolls sideways.
Labels are measured with the browser's own text engine and placed by
`templates/label-layout.mjs`, a DOM-free module with its own tests. On every chart
a placed label never overlaps another label or a quadrant name, never covers
another company's mark, stays within reach of its own mark, and no leader runs
through another mark or label. Labels may use the empty margin above and to the
right of the plot. Names come before values: a label that fits nowhere close
tries farther positions with a leader, may borrow a neighbour's spot if the
neighbour finds another, and makes the labels around it drop their value line
before it gives up. `npm test` checks that from 500px up every company is named
in every view (both axes, all three bubble modes, every 20px of width). On the
narrowest phones at most two names per view can give way; their marks keep the
tooltip, accessible name and profile, and the note under the chart says how many
were hidden. On phones, leaders never cross, and a label without a leader always
sits nearest its own mark. On phones labels are name-only and the chart options
fold into one row.

Labels carry a halo in the page colour rather than a box. Hovering or focusing a
company brings its mark, label and leader forward and dims the rest; keyboard focus
shows the same figures a mouse hover does.

The mobile default is still the sortable company list; `?view=map` opens the map.
The list has one column per axis plus valuation and total funding, and its headers
sort. Profiles open in a keyboard-accessible dialog and retain founders, investors,
confidence notes, a "Why this figure?" explanation, source links and the
verification log. Previous and next (or ← and →) walk the companies in the order
you are viewing them. Opening a profile adds one history entry, so the Back button
or a phone's back gesture closes it instead of leaving the site. The research feed
groups duplicate article URLs, follows the current filters, and draws only on
`news`. View settings persist in the URL, including an explicit map/list choice
across devices.

Every colour is a token with a light and a dark value; the site follows the
reader's system setting, or a `data-theme` on the root element.

The map is maintained in `templates/map.html`, `map.css`, `map.js`,
`map-model.mjs`, `label-layout.mjs` and `profile.mjs`; the build
(`scripts/lib/site.mjs`) inlines them into one portable HTML page. `profile.mjs`
also renders every static company page, so the drawer and the page can never
disagree, and those pages share `map.css` as `assets/site.css`. `npm test` checks
the map's financial encoding, legend, hero figures, saved settings, filters,
article grouping, label placement, the shared profile renderer, and that every
link in the built site resolves.

There is no database and no backend. Data is JSON in git, and **the review queue is a pull request.**

```
data/markets/*.json   ← the only source of truth
      │
      ├── scripts/validate.mjs   schema + rules that a schema can't express   (CI, every PR)
      ├── scripts/build.mjs      → dist/ : maps, one page per company, changelog
      ├── scripts/preview.mjs    local server, see it before you push
      ├── scripts/admin.mjs      local form editor, writes back to the JSON
      └── agent/refresh.mjs      weekly: proposes changes as a PR you approve

scripts/lib/   the logic those commands share, each with its own tests
      ├── validate-market.mjs    every editorial rule, used by validate, admin and tests
      ├── site.mjs               renders the whole site as data: path → HTML
      └── edit-company.mjs       what an admin save does to a company
```

Merging a PR deploys the site and adds the diff to the public changelog. Git gives you the review queue, audit log, version history and rollback for free.

## The data model

Two details carry the design:

**`source` on every figure**, not one citation per company. This is what lets a page say "as of Aug 2026, per TechCrunch" and mean it. The round has `source`; the valuation may carry its own `postMoneySource` (falling back to the round's), and total funding has `metrics.totalRaisedSource` with `metrics.totalRaisedConfidence`. A total with no recorded provenance is shown with "source not recorded" rather than borrowing a citation. Only `http(s)` links are accepted anywhere.

**`locked`** is your manual override. Add a dot-path — `"locked": ["lastRound.postMoneyUsd"]` — and the weekly agent is forbidden from touching it. Without this, a number you typed in by hand silently disappears on the next Monday run. The admin editor's padlock buttons write this array; `agent/refresh.test.mjs` proves the agent honors it.

`confidence` is one of `reported | estimated | rumored | manual | undisclosed`. In the admin editor, a valuation or funding total you type without attaching a new source is marked `manual` and locked automatically, so the UI never implies a citation that doesn't exist. The editor runs the same rules as `npm run validate` and refuses to save a change that breaks one (a manual valuation still needs its note, for example).

`confidence` describes the **round**; `postMoneyConfidence` describes the **valuation**, falling back to `confidence` when absent. They are separate because a round can be well reported while the post-money beside it was typed in by hand — Pally's $5.2M seed is sourced to Dealroom, but its valuation is not. The company page reflects this: the round row cites Dealroom, the valuation row does not.

**`news` and `checks`** are separate. `news` is published coverage — articles,
announcements, data profiles — and feeds the research section. `checks` is the
verification log: pages an editor visited to confirm a fact ("Product availability
and features", dated the day it was checked). Checks appear only in each profile's
verification log, so they never crowd reporting out of the feed. Validation rule 10
fails any news title that reads like a check.

`shortName` is an optional compact map label (`Comet` for Comet (Perplexity));
`brand` is the consumer-facing parent a platform product is labelled with.

The market itself carries its presentation facts: `edition` (the 01 in the
masthead), `author`, `scopeLabel`, `regions` (every company's `region` must be one
of them), `featured` (the map served at the site root), `judgedExcluded` and
`excludedNonUS` (both shown under Methodology).

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
| 6 | No date may be later than `market.asOf`, including verification checks |
| 7 | A platform must carry a `parent` description |
| 8 | *(warning)* The autonomy score should carry a rationale |
| 9 | Every `category` must be one of `market.categories` |
| 10 | A news title that reads like a verification check (“… checked September 26, 2026”) belongs in `checks` |
| 11 | *(warning)* A platform should carry a `brand` for its map label |
| 12 | Every company scores exactly the market's axes; no axis may reuse a name the page payload already uses |
| 13 | Every company's `region` must be one of `market.regions` |
| 14 | An independent's total funding cannot be smaller than its last round |
| 15 | A reported, estimated or rumored total needs `totalRaisedSource`; a manual total must be locked |
| — | A platform carries no total funding (a parent's capital is not the product's); only one market may be `featured`; market ids are unique |
| — | *(warning)* Not verified in 60 days, or verified more than 7 days before the `asOf` snapshot the site displays |
| — | *(warning)* Total-funding figures with no recorded source, listed in one line |

Rule 4 caught a real gap on its first run: Superhuman's $825M was marked estimated with nothing saying it was a pre-acquisition primary round rather than an exit price.

## The weekly agent

One GitHub Action, Mondays 06:00 ET. Five stages; only the first two call a model, each with a narrow job — cheaper and far easier to debug than one long loop.

| Stage | Model | Job |
|-------|-------|-----|
| 1 Discover | Haiku 4.5 | Poll RSS, company blogs and SEC EDGAR; triage headlines |
| 2 Extract | Sonnet 5 | Read articles → typed claims with sources |
| 3 Reconcile | — | Diff against live data, apply the guardrails below |
| 4 Propose | — | Write JSON + a human-readable PR body |
| 5 Publish | you | Merge; CI validates, builds and deploys |

**Never Opus in this loop** — a job that is mostly reading and filling a schema does not need it.

Cost control: URLs come from free RSS, company blogs and EDGAR rather than paid web search. Two further levers are not active yet. The system blocks are marked for prompt caching, but caching only engages once a block passes the model's minimum cacheable length (1,024 tokens on Sonnet 5, 4,096 on Haiku 4.5), and today's prompts are shorter. The Batch API (50% off, and a weekly job can wait) is not wired in. The earlier **$12–15/month** projection assumed both discounts and has not been measured.

### Guardrails

Tested offline in `agent/refresh.test.mjs`:

- Locked fields are never overwritten, including via a locked parent path
- A source older than the one behind the figure is rejected
- Platforms never take round data or funding
- Two sources that disagree are **flagged and neither value is applied**; agreeing sources become one change citing the newest
- Trade press (tier 2) may fill a blank but never replaces a figure; aggregators (tier 3) are discovery only
- A new series or date is a new round: the previous round's figures are cleared, never re-cited, and the PR lists what was cleared; if any are locked, the company escalates
- Updating the round never re-cites the valuation: it keeps its own citation and confidence
- A funding total takes its own citation; a traction update only adds coverage
- A tier-1 report that matches a rumored, estimated or unsourced figure upgrades its label and citation, and a new round keeps any figure it restates rather than clearing it
- More than five field changes to one company escalates instead of applying
- Applying changes moves `market.asOf` to the run date, so new stories never fail validation for post-dating the snapshot
- Coverage only grows (older stories are never dropped), and each entry keeps the article's headline
- Paywalled outlets are read from the feed summary only; SEC Form D hits go to the PR for a human to confirm, not to the extractor
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

Add `data/markets/<slug>.json` matching `schema/market.schema.json`. The build picks it up automatically — no code changes. The featured market (or, with none flagged, the lowest `edition`) is served at `/`; every other market gets its own map at `/<slug>/`, and a switcher appears in the masthead once there is more than one. Axes, categories, quadrants, scope and exclusions all come from the file. `npm test` builds a second market and checks every link, so this path stays working.

## Scope of map 01

US-headquartered companies only. A company is included if it acts on behalf of an *individual* (not a team), spans at least two life surfaces, and *takes actions* rather than only answering questions.

Out of scope: coding agents, enterprise and vertical copilots, companionship AI, and agent infrastructure. Notable non-US players tracked but excluded: Manus (Singapore), Today AI (China), Fyxer (UK).

### Judged and excluded

Kept in the data (`market.judgedExcluded`) and shown on the site under Methodology, so the boundary stays falsifiable — each name fails a stated criterion, not a mood: Notion AI (two surfaces), Granola (takes actions), Glean and Sierra (on behalf of an individual), Replit Agent and tldraw computers (scope).

**Comet (Perplexity)** and **Motion** were judged *in* and added — Comet acts across every authenticated site, Motion reschedules your day unprompted. **Manus** qualified on the criteria but is Singapore-based, so it falls to the US-only scope rule. **Muse** was already on the map.

## Known gaps

- **Valuations use the latest reported figure** (checked September 28, 2026). **4 of 15 non-platform companies have no valuation** (Littlebird, Martin, Cora, Ollie); none has been reported. The 8 platforms are excluded by rule 3, not missing. Three figures (Duckbill, Ohai.ai, Wajo / Fo) are hand-entered because no valuation has been reported for them. Lindy's is a secondary-market estimate. Poke's and Superhuman's are their last private-round valuations, not acquisition prices.
- Pally's $30M is company-stated, per Business Insider; Dealroom lists $19.4M for the same round, which appears to be its own estimate. The figure stays locked, so any change to it goes to a human.
- **11 total-funding figures have no recorded source.** They are shown with "source not recorded" on each profile, and `npm run validate` lists them; add `metrics.totalRaisedSource` as each is checked. Wajo / Fo's total is hand-entered and labelled manual.
- `agent/sources.json` still carries a placeholder user agent. SEC EDGAR expects a real contact address; set one before the first live run.
- Bubble size switches between **post-money** and **total raised**. Total raised is known for 14 of 15 non-platform companies against 11 for valuation, so it shows more of the field at true scale; valuation is the better read on how the market prices them.
- Town is drawn at the $1B valuation Upstarts Media reported for the $90M Series B it is raising, labelled **rumored** because the round has not been announced. Its funding total follows the same basis: $163M, also rumored, counting the $18M seed (March 2025), the $55M Series A and the $90M Series B; confirmed funding is $73M. When a tier-1 source confirms the close, the refresh agent relabels both reported with that citation.
- Comet was last verified on 2026-09-12, two weeks before the snapshot date; `npm run validate` warns until it is re-checked.
- Axis scores are editorial judgments against a published rubric. Each company carries a one-line scoring note (stored on the primary axis); an axis may carry its own rationale, shown under its score. Argue with them via the correction link.
- The changelog needs `fetch-depth: 0` on checkout, or it builds empty.

---

Educational use only. Figures are compiled from public reporting and may be inaccurate or out of date. Not investment advice.
