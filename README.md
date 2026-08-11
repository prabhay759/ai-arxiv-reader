# arXiv AI Reader

A browser-based reader for AI papers from arXiv. Search across the literature,
read papers in a proper reading view, and pick up exactly where you left off —
on any device, with no installation.

**There is no backend.** The whole thing is a static site on GitHub Pages: no
server, no database, no hosting bill. Two pieces of engineering make that
possible, and they're worth understanding before you change anything.

---

## How it works

### Search runs on a prebuilt static index

arXiv's search API (`export.arxiv.org/api/query`) sends **no CORS header**, so a
browser physically cannot call it. Instead, a scheduled GitHub Action harvests
paper metadata through arXiv's OAI-PMH bulk interface and compiles it into a
sharded inverted index of plain gzipped JSON. The browser downloads only the
shards containing your query's terms — a few KB — then ranks locally.

The consequence: search is fast, works offline, and costs nothing to run. The
trade-off: results are as fresh as the last CI run (every 6 hours), not
real-time. Opening a paper by ID or URL is always live.

BM25's term-frequency component is computed at **build** time and baked into
each posting as one quantized byte, so the browser never downloads a
per-document length table before it can rank anything.

### Reading loads straight from arXiv

Unlike the search API, arXiv's `/html/` and `/pdf/` endpoints **do** send
`Access-Control-Allow-Origin: *`, so paper bodies are fetched directly by the
browser with no proxy.

Reading is HTML-first. arXiv's LaTeXML HTML reflows for mobile, renders maths
via native MathML (no JS library), and gives every section and paragraph a
stable id — which is what anchors reading positions and highlights. Papers
without an HTML version (generally pre-2024) fall back to a `pdf.js` viewer
with a real text layer, so selection, find and screen readers all work.

### Sync writes to your own Google Drive

Signing in with Google stores one JSON document in your Drive's hidden
`appDataFolder`. It's invisible in the Drive UI, unshareable, and readable only
by this app for your account. No server holds your data, and revoking access in
your Google account removes it.

Local state (IndexedDB) is always the source of truth; sync reconciles the two
copies last-write-wins per record, with tombstones so a deletion on one device
isn't resurrected by another.

### Guest mode is the default

With zero configuration, everything works: search, reading, resume, library,
collections, tags, highlights, notes and offline. Signing in adds cross-device
sync and merges your existing local data into the account on first use.

---

## Features

**Search**
- Full-text search over titles, authors, categories and abstracts across the
  core AI categories (`cs.AI`, `cs.LG`, `cs.CL`, `cs.CV`, `cs.NE`, `stat.ML`)
- Query language: `ti:diffusion`, `au:"Yann LeCun"`, `abs:contrastive`,
  `cat:cs.LG`, `"exact phrase"`, `-exclude`
- Filters by category and date range; sort by relevance, newest or oldest
- Search history and saved searches
- Paste any arXiv ID or URL to jump straight to that paper

**Reading**
- Reflowable reader with adjustable text size, line height, line width and typeface
- PDF viewer with zoom, page navigation, outline and text selection
- Auto-generated table of contents
- Reading progress with percentage and estimated time remaining
- Resume position that survives font changes, rotation and window resizing

**Library**
- Bookmarks, read status, starring, collections and tags
- Multi-colour highlights with per-highlight notes
- Free-form notes per paper, searchable across your whole library
- "Continue reading" shelf
- JSON and BibTeX export, JSON import

**App**
- Works offline; installable to a phone home screen
- Light, dark and system themes
- Keyboard shortcuts (`?` lists them)
- Every search and paper is a shareable deep link
- Settings shows when the index was last refreshed, what it covers, and warns
  if the scheduled rebuild has stalled

---

## Deploy it

### 1. Turn on Pages (once)

**Settings → Pages → Source: GitHub Actions.**

The workflow tries to do this for you, but GitHub usually refuses to let a
workflow token create a Pages site (`Resource not accessible by integration`),
so the first time it has to be a human click. If the deploy fails with
*"GitHub Pages is not enabled"*, this is what it wants.

### 2. Deploy

Push to `main`, or run **Build index and deploy to Pages** from the Actions tab.

Your site appears at `https://<user>.github.io/<repo>/` — for this repository,
**https://prabhay759.github.io/ai-arxiv-reader/**.

The first run harvests the whole window and takes roughly 90 minutes; later runs
are incremental and finish in a couple of minutes. Pages is configured as the
very first step of the job, so a misconfiguration fails in seconds rather than
after the harvest.

### 3. Enable Google sign-in

The app is fully usable without this — everything works, it just won't follow
you to another device. Setting it up takes about five minutes and costs nothing.

**Step 1 — Create a project**
Go to the [Google Cloud Console](https://console.cloud.google.com/) and create a
project (any name).

**Step 2 — Enable the Drive API**
**APIs & Services → Library** → search *Google Drive API* → **Enable**.
This is what lets the app write its sync file to your Drive.

**Step 3 — Configure the consent screen**
**APIs & Services → OAuth consent screen** → choose **External** → fill in the
app name and your email.

- Under **Scopes**, add `https://www.googleapis.com/auth/drive.appdata`.
- Under **Test users**, add your own Google address. While the app is in
  *Testing* mode only listed users can sign in — up to 100 of them.

**Step 4 — Create the OAuth client**
**Credentials → Create credentials → OAuth client ID → Web application**.

Under **Authorised JavaScript origins**, add every origin you'll load the app
from — exactly, with no trailing slash:

| Origin | For |
| --- | --- |
| `https://<user>.github.io` | GitHub Pages (note: the origin, *not* the `/repo/` path) |
| `http://localhost:5173` | local development |

Leave **Authorised redirect URIs** empty. This app uses the token flow, so it
never redirects.

**Step 5 — Publish the client ID**
Copy the client ID (it looks like `1234-abc.apps.googleusercontent.com`) into
**repo Settings → Secrets and variables → Actions → Variables** as
`VITE_GOOGLE_CLIENT_ID`, then re-run the deploy workflow.

For local development, copy `.env.example` to `.env.local` and put it there
instead.

> The client ID is a **public identifier, not a secret** — it ships in the
> JavaScript bundle by design. That's why it's a repository *variable* rather
> than a secret.

#### Two things that will surprise you

**"Google hasn't verified this app."** `drive.appdata` is a sensitive scope, so
until you submit for Google verification you'll see an interstitial — click
*Advanced → Go to \<app\> (unsafe)* to continue. It's a review process, not a
defect, and it doesn't affect guest mode. Verification is only worth doing if
you intend to share the app publicly.

**"Google rejected this site's origin."** This means the origin you're loading
from isn't in the list from step 4. The app's error message tells you the exact
string to paste, and the Settings page shows your current origin. The usual
culprits are a trailing slash, `http` vs `https`, or a missing port.

### 4. Refreshing the data

The search index is a static build artefact, so "refreshing" means rebuilding
and redeploying it. You never have to do this by hand — but here's every lever:

| How | What it does |
| --- | --- |
| **Automatic, every 6 hours** | The `deploy.yml` cron harvests what changed, rebuilds and redeploys |
| **Push to `main`** | Same |
| **Actions → *Build index and deploy to Pages* → Run workflow** | Refresh right now |
| Same, ticking **full_harvest** | Ignores the saved watermark and re-harvests the whole window |
| `npm run refresh` (local) | Rebuilds `public/data/` for `npm run dev` |

**How to tell it worked:** open **Settings → Search index** in the app. It shows
when the index was last built, how many papers it holds, the date range covered
and the categories included. If the last build is more than 12 hours old, it
says so — that usually means the scheduled workflow is disabled or failing.

Incremental runs are quick because `scripts/harvest.mjs` records a per-category
datestamp watermark in `.corpus/state.json` and passes it to arXiv as `from=`,
so each run only fetches what changed since.

> **Editing `config/corpus.json` forces one long rebuild.** The CI cache is keyed
> on that file's contents, so changing categories or the history window discards
> the cached corpus and re-harvests from scratch — around 90 minutes for the
> default scope. Subsequent runs go back to being incremental.

**If the first run doesn't finish**, just run the workflow again. arXiv throttles
heavy harvesters and can slow to tens of seconds per request, which is enough to
push a full seeding harvest past the job timeout. The harvester checkpoints its
corpus and watermark after every completed category, so a re-run resumes at the
first unfinished one rather than starting over. Repeat until it completes; after
that, refreshes are incremental and quick.

### 5. Tune the corpus (optional)

`config/corpus.json` controls what gets indexed:

| Key | Meaning |
| --- | --- |
| `categories` | arXiv categories to harvest |
| `historyStart` | How far back to harvest. Earlier = bigger site, longer first build |
| `abstractWindowMonths` | How far back abstracts are indexed for full-text search. Abstracts dominate the size budget |
| `docsPerChunk` | Papers per display chunk. Smaller = less fetched per result page |

The default scope is **core AI** — `cs.AI`, `cs.LG`, `cs.CL`, `cs.CV`, `cs.NE`,
`stat.ML` — over the last five years. Roughly **424,000 papers, ~414 MB**.

#### Why not just `cs.AI`?

Because arXiv authors tag inconsistently, and indexing `cs.AI` alone would quietly
lose most of the canon. Checked against the live API:

| Paper | Categories | `cs.AI`? |
| --- | --- | --- |
| Attention Is All You Need | cs.CL, cs.LG | ✗ |
| BERT | cs.CL | ✗ |
| GPT-3 | cs.CL | ✗ |
| ResNet | cs.CV | ✗ |
| GANs | stat.ML, cs.LG | ✗ |
| LLaMA | cs.CL | ✗ |
| DQN / Atari | cs.LG | ✗ |
| Vision Transformer | cs.CV, cs.AI, cs.LG | ✓ |

Only ~41% of AI papers carry a `cs.AI` tag at all. The six-category scope keeps
the field intact while dropping the adjacent areas — robotics (`cs.RO`),
information retrieval (`cs.IR`), multiagent systems (`cs.MA`) — that were the
main source of off-topic results.

Note that `historyStart` is passed to OAI-PMH as `from`, which filters on
**modification** date rather than submission date. Papers first published before
the window but revised inside it come along too — free extra coverage of work
that's still active.

**Sizing** (measured from a real 63,570-paper build: 86 B light + 598 B abstract
+ 293 B index per paper, gzipped). GitHub Pages' documented soft limits are 1 GB
per site and 100 GB/month of bandwidth. Shrink `abstractWindowMonths` first if
you outgrow it — abstracts are ~60% of the bytes.

---

## Develop

```bash
npm install

# Build a small local corpus first — the app needs an index to search.
# A full harvest takes ~75 minutes; this narrow slice takes about a minute.
node scripts/harvest.mjs --from 2026-08-01 --sets cs:cs:AI
npm run build:index

npm run dev
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Typecheck and build to `dist/` |
| `npm test` | Unit tests |
| `npm run refresh` | Harvest + rebuild the index in one step |
| `npm run harvest` | Incremental OAI-PMH harvest into `.corpus/` |
| `npm run build:index` | Compile `.corpus/` into `public/data/` |
| `node e2e/reader.mjs` | Browser tests against a running preview |

Useful `harvest.mjs` flags: `--from <date>` and `--sets <oai:set,...>` to narrow
a run, `--max-pages N` to bound it, and `--full` to ignore the saved watermark.

`.corpus/` and `public/data/` are generated and gitignored — CI rebuilds them
and ships them as a Pages artifact, so refreshing the index never bloats git
history.

### Layout

```
scripts/harvest.mjs      OAI-PMH harvester (CI only)
scripts/build-index.mjs  Compiles the corpus into static shards
shared/tokenize.mjs      Tokenizer shared by the indexer AND the browser
src/search/              Query parser, shard fetching, BM25 ranking
src/reader/              HTML + PDF readers, resume anchors, highlighting
src/store/               IndexedDB (Dexie) — the source of truth
src/sync/                Google auth, Drive appDataFolder, merge logic
```

> `shared/tokenize.mjs` is imported by both the Node indexer and the browser on
> purpose. If the two ever tokenize differently, queries produce terms the index
> doesn't contain and search silently returns nothing — so it lives in exactly
> one file.

### Testing

Unit tests cover the parts where bugs hide quietly: the query parser, BM25 and
postings round-trips, the LaTeX cleaner, and sync merges including conflicting
timestamps and tombstones.

`e2e/reader.mjs` drives a real browser through search, opening a paper, scrolling,
reloading and asserting the position came back, bookmarking, highlighting,
offline use and mobile layout, saving screenshots to `e2e/screenshots/`.

In sandboxes where the browser has no direct outbound network (CI here), the E2E
script relays `arxiv.org` requests through Node so the real code path still runs
against genuine arXiv markup.

---

## Credits and terms

Paper metadata and full text come from [arXiv.org](https://arxiv.org) via its
OAI-PMH interface, used under arXiv's
[terms of use](https://info.arxiv.org/help/api/tou.html). This project is not
affiliated with or endorsed by arXiv. Individual papers remain under whatever
licence their authors chose.

There is no tracking, no analytics and no third-party requests beyond arXiv
and — only if you enable sign-in — Google.
