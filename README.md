# Market Maps

Public, sourced, agent-refreshed VC market maps. Two maps so far: **Personal AI Agents (USA)**, US companies building agents that act on your behalf across your personal life, and **World Models (Global)**, companies worldwide building AI that generates worlds and predicts how they respond to actions. The site is built for up to ten.

The design rule the whole repo enforces: **every figure carries its source, or it is explicitly marked as having none.** A market map nobody can check is a screenshot.

```
npm install
npm run validate     # schema + editorial rules
npm test             # agent guardrails, rules, build, labels, admin (no API key needed)
npm run build        # → dist/
npm run preview      # → http://127.0.0.1:5173  see the whole site locally
npm run admin        # → http://127.0.0.1:4321  edit data by hand
npm run refresh:dry  # agent proposes, writes nothing
npm run logos        # fetch logos for companies that lack one
npm run previews     # link-preview images and the site icon (on a Mac)
```

## Seeing it before you push

`npm run preview` builds and serves the site on localhost. Nothing is published and
nothing leaves your machine — it is the same `dist/` the deploy uses.

Two link modes exist because root-relative links (`/world-models/`) need a real server:

| Command | Links | Use for |
|---|---|---|
| `npm run build` | `/world-models/` | Production deploys |
| `npm run preview` | `../world-models/index.html` | Localhost, or opening `dist/index.html` directly |

`npm run build:relative` gives you the relative build without starting a server —
useful if you want to host the site inside a subdirectory.

## How it works

### The site

```
/                               the hub: every map as a card, newest first
/<map>/                         one interactive map, e.g. /world-models/
/<map>/<company>/               forwards to the company's profile on its map
```

The hub shows each map's name, tagline, focus groups, company count and axes,
with a small preview drawn from the map's own data; the cards follow the short introduction directly. Every page's wordmark leads back to it; on a map, a
switcher in the masthead jumps straight to another map, listed by name in edition order
(phones have no room for it, so there the wordmark is the way between maps).
Map addresses never change when a map is added, so a link to a map or a company
keeps working.

Before the hub, map 01 was served at `/`. Links from then (`/?company=hark`,
`/?view=map`, `/#methodology`) are forwarded to `/personal-ai-agents/` by a few
lines in the hub's `<head>`; links without map parameters stay on the hub. The
market marked `featured` (or, with none flagged, the lowest edition) is the one
those old links open.

### Exploring the map

Focus groups and axes are data, not code: `market.categories` and `market.axes`
in the market file, with a `category` on every company. Every map uses the same
two colours: blue for its first focus group, green for its second. Each axis carries its label, an optional `short` label for controls, its
rubric, and `low`/`high` phrases printed at the ends of the axis. A rubric is
anchored to its market: 0 is the least a company must do to be on the map and
100 the frontier, so the scores use the whole chart (the agents map's autonomy
and breadth, and World Models' interactivity, were re-anchored this way on
October 6, 2026). Every rubric spells out five steps (0, 25, 50, 75 and 100);
the agents map's distribution and World Models' generality gained their middle
steps on October 7, 2026. Map 01 has two
groups, personal assistants and work and productivity. Ownership is a separate
filter. Search matches company names, short names, brands, aliases and capability
descriptions; category counts reflect the active search and ownership selection.

Choose either vertical axis the market defines (context breadth or distribution for
map 01), and valuation, total funding, or equal size for the marks. Bubble **size**
follows the selected figure on a **log scale**, gently bent so each tenfold step
adds a little more than the one before ($100M → $1B is a bigger jump than
$10M → $100M), while a $10B company still reads a step or two larger than a $1B
one rather than dwarfing it, and big bubbles no longer push their neighbours'
labels away (`LOG_BEND` in `templates/map-model.mjs`; 1 would mean equal steps). The
scale is fixed for the whole dataset. Figures of $10M or less are drawn at the
minimum size, never smaller than the hollow mark for an unknown figure, and the
size legend shows one reference circle per tenfold step. Platform products use
colored squares labelled with their consumer brand (`brand`: Google, not Alphabet);
undisclosed company figures use hollow circles with no figure in the label (the
legend calls them "Undisclosed figure"; their tooltips show no figure). An acquired
company keeps its circle inside a thin ring ("Acquired company" in the key). It is
sized by the acquisition price when that was disclosed, otherwise by its last private
valuation, and its tooltip says which ("$8.2B deal", "$300M before acquisition"). A
product a parent launched after an acquisition, such as Superhuman Go, is a platform
product, because it never had a price of its own. Map labels show
the plain figure. Every figure rounds to one decimal place ($53.6M, $1.4B), in
labels, tooltips, the list and profiles alike; notes follow the same rule, while
quoted headlines and subscription prices stay as published. An estimate, a rumored figure or an acquisition price says what
it is in its tooltip, list row and profile, and a figure entered manually says so
on its profile; a reported figure is shown plain everywhere but its profile. Funding
labels likewise show just the figure, and tooltips say "raised". The key under the
chart names each focus colour as well as each shape. The methodology section
publishes the scoring rubrics, one row per anchored score, and the scope from the
canonical dataset.

The chart is drawn at the width of the screen, so it never scrolls sideways.
Labels are measured with the browser's own text engine and placed by
`templates/label-layout.mjs`, a DOM-free module with its own tests. Labels prefer
to sit right beside their marks. A label shows the value under the name or, where
two lines do not fit, beside it on one line; where a name and value would only
fit at the end of a leader line, the label shows the name alone (the value stays
in the tooltip and profile). A label left with only its name may still win its
value by moving a neighbour's label, as long as the neighbour keeps its own value
and needs no new leader. On every chart a placed label never overlaps another label or a
quadrant name, never covers
another company's mark, stays within reach of its own mark, and no leader runs
through another mark or label. The one exception: when two companies score almost
the same and the smaller mark sits inside the bigger bubble, its leader may cross
that bubble on the way out. Labels may use the empty margin above and to the
right of the plot. Names come before values: a label that fits nowhere close
tries farther positions with a leader, may borrow a neighbour's spot if the
neighbour finds another, and makes the labels around it drop their value line
before it gives up. `npm test` checks that from 500px up every company is named
in every view (both axes, all three bubble modes, every 20px of width), and,
with approximate text widths, that every figure shows beside its name from a
1,280px window up. In the browser a figure can still give way in the tightest
spots, where showing it would take a leader line. On the
phones at most two names per view can give way (three on the very narrowest
charts, about 333px wide); their marks keep the
tooltip, accessible name and profile, and the note under the chart says how many
were hidden. On phones, leaders never cross, and a label without a leader always
sits nearest its own mark. On phones labels are name-only and the chart options
fold into one row.

Labels carry a halo in the page colour rather than a box. Hovering or focusing a
company brings its mark, label and leader forward and dims the rest; a mark keeps
its white border on hover, and keyboard focus adds a ring. Keyboard focus shows the
same figures a mouse hover does.

The map is the default view on every screen, phones included; the sortable company list is one tap away (`?view=table`).
The list has one column per axis plus valuation and total funding, and its headers
sort. A click anywhere on a row opens its profile. A coloured dot marks each company's focus beside a short ownership tag, and a
platform row shows one muted "Platform" across the money columns; the table fits
without sideways scrolling from a 1,024px window. Profiles open in a keyboard-accessible dialog, and the dialog is the whole
profile: founders (with LinkedIn links where a profile could be confirmed),
confidence notes, a "Why this figure?" explanation, every source (the latest four
stories show; older ones fold open) and the verification log. A company's own
address, `/<map>/<company>/`, forwards to its profile on the map, so links shared
before still land on the same company; the forwards stay out of the sitemap. Previous and next (or ← and →) walk the companies in the order
you are viewing them. Opening a profile adds one history entry, so the Back button
or a phone's back gesture closes it instead of leaving the site. The news feed
groups duplicate article URLs, follows the current filters, and draws only on
`news`; a roundup names its first two companies and counts the rest ("Instinct,
Town +7"). View settings persist in the URL, including an explicit map/list choice
across devices.

Company logos appear in the list and in profiles, in place of the letter tiles,
and never on the chart, where they would compete with bubble size. Each is the
company's own site icon (a home-screen icon where the site has one), fetched by
`npm run logos` into `data/logos/<market>/<company>.<ext>` and stored at no more
than 128px. A company whose site blocks automated reads, or offers only a tiny
favicon, gets its own App Store icon instead. `sources.json` beside the files
records where each logo came from. A logo shows on a white tile in both themes;
a company that publishes a dark-page icon (Hark, Odyssey) gets it, on a dark
tile, in dark mode. A company without a logo file keeps its initials.

### Link previews and the site icon

A link to the site, pasted into LinkedIn, X, Slack or iMessage, previews as a
1200×627 picture (`og:image`). The front page shows both maps; each map shows
itself, with its title, labels and key; a company link (`/<map>/<company>/`)
previews as its map. `npm run previews` takes these pictures: it builds the
site, lays each page out alone (`?card`) and screenshots it with macOS's own
WebKit through `scripts/snapshot.swift`, so no browser needs installing (set
`CHROME_PATH` to use Chrome elsewhere). The images live in `data/previews/`
with a manifest of what each was made from, and the build names any that a
data or template change has since made out of date. Run the command before
sharing a link after the data changes.

The site icon is `data/brand/icon.svg`, the same mark as the masthead's. To
change the logo, replace that file and run `npm run previews`, which also
makes `favicon.ico` and the opaque `apple-touch-icon.png` from it.

LinkedIn keeps a link's preview for about a week. After an update, paste the
link into LinkedIn's Post Inspector (linkedin.com/post-inspector) to refresh
it; posts already published keep the picture they had.

Every colour is a token with a light and a dark value; the site follows the
reader's system setting, or a `data-theme` on the root element.

The map is maintained in `templates/map.html`, `map.css`, `map.js`,
`map-model.mjs`, `label-layout.mjs` and `profile.mjs`; the build
(`scripts/lib/site.mjs`) inlines them into one portable HTML page. The hub and
the 404 page share `map.css` as `assets/site.css`. `npm test` checks
the map's financial encoding, legend, hero figures, saved settings, filters,
article grouping, label placement, the shared profile renderer, and that every
link in the built site resolves.

There is no database and no backend. Data is JSON in git, and **the review queue is a pull request.**

```
data/markets/*.json   ← the only source of truth
      │
      ├── scripts/validate.mjs   schema + rules that a schema can't express   (CI, every PR)
      ├── scripts/build.mjs      → dist/ : the hub, maps, company forwards
      ├── scripts/preview.mjs    local server, see it before you push
      ├── scripts/admin.mjs      local form editor, writes back to the JSON
      ├── scripts/fetch-logos.mjs  company logos → data/logos/<market>/
      ├── scripts/previews.mjs   link-preview images → data/previews/, icons → data/brand/
      └── agent/refresh.mjs      weekly: proposes changes as a PR you approve

scripts/lib/   the logic those commands share, each with its own tests
      ├── validate-market.mjs    every editorial rule, used by validate, admin and tests
      ├── site.mjs               renders the whole site as data: path → HTML
      └── edit-company.mjs       what an admin save does to a company
```

Merging a PR deploys the site. Git gives you the review queue, audit log, version history and rollback for free.

## The data model

Two details carry the design:

**`source` on every figure**, not one citation per company. This is what lets a page say "as of Aug 2026, per TechCrunch" and mean it. The round has `source`; the valuation may carry its own `postMoneySource` (falling back to the round's), and total funding has `metrics.totalRaisedSource` with `metrics.totalRaisedConfidence`. A total with no recorded provenance is shown with "source not recorded" rather than borrowing a citation. Only `http(s)` links are accepted anywhere.

**`locked`** is your manual override. Add a dot-path — `"locked": ["lastRound.postMoneyUsd"]` — and the weekly agent is forbidden from touching it. Without this, a number you typed in by hand silently disappears on the next Monday run. The admin editor's padlock buttons write this array; `agent/refresh.test.mjs` proves the agent honors it.

`confidence` is one of `reported | estimated | rumored | manual | undisclosed`. In the admin editor, a valuation or funding total you type without attaching a new source is marked `manual` and locked automatically, so the UI never implies a citation that doesn't exist. The editor runs the same rules as `npm run validate` and refuses to save a change that breaks one (a manual valuation still needs its note, for example).

`postMoneyBasis` says what the valuation prices: a funding round (the default) or
an announced acquisition. The map label shows just the figure; everywhere else
says what it is ("$8.2B deal" in the tooltip, "Acquisition price" in the list, its
own wording on the profile), so it is never mistaken for a round valuation. World Labs, which
AMD agreed to buy for $8.2B, is the only one so far.

`confidence` describes the **round**; `postMoneyConfidence` describes the **valuation**, falling back to `confidence` when absent. They are separate because a round can be well reported while the post-money beside it was typed in by hand — Pally's $5.2M seed is sourced to Dealroom, but its valuation is not. The company page reflects this: the round row cites Dealroom, the valuation row does not.

**`news` and `checks`** are separate. `news` is published coverage — articles,
announcements, data profiles — and feeds the research section. `checks` is the
verification log: pages an editor visited to confirm a fact ("Product availability
and features", dated the day it was checked). Checks appear only in each profile's
verification log, so they never crowd reporting out of the feed. Validation rule 10
fails any news title that reads like a check.

`shortName` is an optional compact map label (`Comet` for Comet (Perplexity));
`brand` is the consumer-facing parent a platform product is labelled with.

The market itself carries its presentation facts: `edition` (the map's number,
which orders the maps), `author`, `regions` (every company's `region` must be one
of them), `allDescription` (the line under the map title when every company is
shown), `featured` (the map that links from before the hub still open),
`judgedExcluded` and `excludedNonUS` (both shown under Methodology).

A `manual` figure was entered by hand from a source that is not public. The map, the list and the tooltips show it like any other figure; the company profile says *"entered manually · source not public"* and the note explains it, instead of citing the round's article. Manual figures stay locked, so the refresh agent never replaces them.

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
| 16 | An acquisition price (`postMoneyBasis: "acquisition"`) must state the figure and carry a note saying whose deal it is and whether it has closed |
| — | A platform carries no total funding (a parent's capital is not the product's); only one market may be `featured`; market ids are unique |
| — | *(warning)* Not verified in 60 days, or verified more than 7 days before the `asOf` snapshot the site displays |
| — | *(warning)* Total-funding figures with no recorded source, listed in one line |

Rule 4 caught a real gap on its first run: Superhuman's $825M was marked estimated with nothing saying it was a pre-acquisition primary round rather than an exit price.

## The weekly agent

One GitHub Action, Mondays 06:00 ET, covering every map in one pull request (set `MARKET_FILE` to refresh just one). Five stages; only the first two call a model, each with a narrow job — cheaper and far easier to debug than one long loop.

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

1. Push this repo to GitHub. Public repos get unlimited Actions minutes; a private repo works too, since these jobs are small.
2. Add secret `ANTHROPIC_API_KEY`, and put a real contact address in `agent/sources.json` (SEC EDGAR expects one).
3. For deploys, add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, plus repo variable `SITE_URL`.
4. Create a Cloudflare Pages project named `market-maps`. Free tier, unlimited bandwidth.
5. Run the refresh manually first: Actions → Weekly refresh → Run workflow, with **dry run** checked.

Until its secrets exist, the Deploy or Weekly refresh workflow is skipped with a notice rather than failing.

**Or let Cloudflare Pages build the site itself** (Workers & Pages → Create → connect this repository): framework preset *None*, build command `npm run build`, build output directory `dist`, environment variable `SITE_URL` set to the site's address. The Node version comes from `.node-version`. Leave the Cloudflare secrets out of GitHub so the Actions deploy stays skipped and the site is not deployed twice.

Total recurring infrastructure cost: a domain, about $12/year.

## Adding a market

Add `data/markets/<slug>.json` matching `schema/market.schema.json`, with the next
`edition` number. The build picks it up automatically, with no code changes: the
map appears at `/<slug>/`, gets a card at the top of the hub, and joins the
masthead switcher, the sitemap and the 404 page. Axes, categories, colours, scope,
exclusions and the `allDescription` line all come from the file (optional corner
names go in `market.quadrants`; the current maps have none); axis keys must not reuse a name the
page payload already uses (`npm run validate` checks).

Run `npm run logos` to fetch the new companies' logos (the tests check that every
company has one).

`npm test` then holds the new map to the same promises as the others: it validates
every data file, runs the label-placement checks against every map at every width,
and builds a third market to check every link in both link modes.

## Scope of map 01

US-headquartered companies only. A company is included if it acts on behalf of an *individual* (not a team), spans at least two life surfaces, and *takes actions* rather than only answering questions.

Out of scope: coding agents, enterprise and vertical copilots, companionship AI, and agent infrastructure. Notable non-US players tracked but excluded: Manus (Singapore), Today AI (China), Fyxer (UK), Orbits (Canada).

### Judged and excluded

Kept in the data (`market.judgedExcluded`) and shown on the site under Methodology, so the boundary stays falsifiable — each name fails a stated criterion, not a mood: Notion AI (two surfaces), Granola (takes actions), Glean and Sierra (on behalf of an individual), Replit Agent, tldraw computers and Microsoft Copilot Autopilot, the enterprise agent (scope), Fambot (takes actions), Miso (two surfaces), Cora, Superhuman Mail and DoorDash's iMessage agent (two surfaces), Motion (on behalf of an individual: it now sells AI employees to businesses), and Dia (takes actions).

Added in October 2026: **Superhuman Go**, a proactive assistant from Superhuman (formerly Grammarly) that drafts, sorts, schedules and updates across work apps, each action on your approval; **Microsoft Copilot**, the consumer assistant that books and buys through partner sites with your confirmation; and **Genspark**, a general agent that makes calls, handles email and produces documents. **Comet (Perplexity)** was judged *in* and added earlier: it acts across every authenticated site. Cora and Motion were on the map and moved to the judged list. **Manus** qualified on the criteria but is Singapore-based, so it falls to the US-only scope rule. **Muse** was already on the map.

## Scope of map 02

Companies worldwide, judged on the same criteria; each profile gives the
headquarters. A company is included if it builds its own *world model* (a learned
model that generates an environment or predicts how one evolves), the model
*responds to actions* (camera moves, controls or an agent's actions, not only a text
prompt), and *the model is the product*: offered to users, developers or customers
rather than used only in-house.

Axes: **interactivity** (renders on request → responds live to actions),
**generality** (one game or scene → any world from a prompt) and, as the alternative
vertical axis, **access** (lab demo → open weights). Focus groups: interactive worlds
and physical AI.

17 entries: World Labs, Odyssey, Decart, General Intuition, Runway, Moonlake AI and
Overworld (US); SpAItial (UK); Black Forest Labs (Germany); GigaAI (China); and
big-platform models from Google (Genie 3), NVIDIA (Cosmos), Microsoft (Muse), Meta
(V-JEPA 2), Tencent (HY-World), Alibaba (Happy Oyster) and Kunlun Tech's Skywork AI
(Matrix-Game).

Out of scope: video generators without camera or action control, robot and
self-driving companies whose world models stay in-house, robot policy models, and 3D
asset generators or game engines without a learned world model. Judged and excluded:
Sora and Luma AI (responds to actions), Physical Intelligence (builds a world model),
and Rhoda AI, Tesla, AMI Labs, Wayve and Veeda AI (the model is the product: AMI Labs
and Veeda AI have not released a model yet; Rhoda AI's, Tesla's and Wayve's world
models serve their own robots and driving software).

## Known gaps

- **Valuations use the latest reported figure** (checked October 5, 2026). **4 of 14 non-platform companies have no valuation** (Littlebird, Martin, Ollie, folk); none has been reported. The 10 platforms are excluded by rule 3, not missing. Four valuations (Duckbill, Ohai.ai, Wajo / Fo, Lindy) and their funding totals were entered manually from a source that is not public. Lindy's $235M follows a $35M Series B in July 2021, the round reported then for Teamflow, the company its founder ran before Lindy. Poke's is its last private-round valuation, not the acquisition price.
- Pally's $30M is company-stated, per Business Insider; Dealroom lists $19.4M for the same round, which appears to be its own estimate. The figure stays locked, so any change to it goes to a human.
- Every funding total now carries a source or is marked as entered manually.
- `agent/sources.json` still carries a placeholder user agent. SEC EDGAR expects a real contact address; set one before the first live run.
- Bubble size switches between **post-money** and **total raised**. Total raised is known for all 14 non-platform companies against 10 for valuation, so it shows more of the field; valuation is the better read on how the market prices them.
- Town is drawn at the $1B valuation Upstarts Media reported for the $90M Series B it is raising. Its map label shows just the figure; the tooltip, list and profile mark it **rumored** because the round has not been announced. Its funding total follows the same basis: $163M, also rumored, counting the $18M seed (March 2025), the $55M Series A and the $90M Series B; confirmed funding is $73M. When a tier-1 source confirms the close, the refresh agent relabels both reported with that citation.
- Comet was last verified on 2026-09-12, more than three weeks before the snapshot date, and 12 other companies were not re-checked in the October 5 refresh; `npm run validate` lists each until it is.
- Axis scores are editorial judgments against a published rubric. Every score carries its own rationale, shown right under it on the profile; `npm run validate` fails a score without one. Argue with them via the correction link.
- **Map 02:** World Labs is drawn at $8.2B, the value of AMD's all-stock agreement to buy it (announced September 28, 2026, not yet closed), labelled as an acquisition price and locked against the refresh agent. It did not disclose a valuation for its $1B February round, which Bloomberg reported was discussed at about $5B. General Intuition's September 2026 round has no reported series name. Moonlake AI, Overworld and SpAItial have no reported valuation. Decart's, World Labs' and General Intuition's funding totals add up the reported rounds; GigaAI's counts only its three 2026 rounds (CNY3.5B, $518M), so its true total is higher. Each profile's note says which.
- Map 02's platform entries (Genie 3, Cosmos, Muse, V-JEPA 2) are research models from public companies. Microsoft has published nothing new on Muse since April 2025, so it is the entry most likely to go stale.

---

Educational use only. Figures are compiled from public reporting and may be inaccurate or out of date. Not investment advice.
