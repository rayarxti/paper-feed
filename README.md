# Paper Feed

A desktop app for a daily academic digest, backed by a local RAG document
space spanning arXiv, PubMed, and Semantic Scholar (which covers most
conference and journal venues — ACL, NeurIPS, IEEE, etc). No Python. No
browser tab. Built with Electron, so the packaged app is a single binary
that bundles its own Chromium + Node runtime — nothing to install on the
machine it runs on, on Windows, macOS, or Linux.

## What's included, already verified

- `dist/Paper Feed-1.0.0.AppImage` — a **real, working Linux binary**, built
  and tested in this environment. Download it, `chmod +x`, double-click (or
  run from a terminal). No install step.
- Full source + build configuration to produce the equivalent Windows
  `.exe` and macOS `.dmg` — see **Getting Windows/Mac builds** below for why
  those need to be built on (or via CI for) their own OS rather than
  cross-compiled here.

## Customization

There's no "add topic" button in the app on purpose. Topics are fixed
configuration you edit directly. On first run the app copies its bundled
default `config.yaml` into your user data folder — click **"Open config
folder"** in the app to find your actual editable copy (this is what
persists; the copy inside the installed app itself is just the initial
template). Edit it, then click **Reload config** in the app.

```yaml
topics:
  - name: "LLMs and Alzheimer's"
    description: >
      Applications of large language models and NLP to Alzheimer's disease
      and related dementia research...
    keywords:
      - "large language models Alzheimer's disease"
      - "LLM dementia diagnosis"
```

Add as many topic blocks as you like — each gets its own tab and its own
slice of the doc space. Other knobs in the same file: which sources are on,
how many papers to pull per source, how far back "recent" reaches, how
strict the relevance filter is, and the auto-refresh schedule.

## Running it

**From the prebuilt AppImage (Linux, no setup):**
```bash
chmod +x "Paper Feed-1.0.0.AppImage"
ANTHROPIC_API_KEY=sk-ant-... ./"Paper Feed-1.0.0.AppImage"
```

**From source (any OS, for development or to build your own installer):**
```bash
npm install
ANTHROPIC_API_KEY=sk-ant-... npm start        # macOS/Linux
set ANTHROPIC_API_KEY=sk-ant-... && npm start  # Windows cmd
```
Get a key at https://console.anthropic.com/settings/keys. Without it the
app still fetches and stores papers, but summaries and search answers will
fail until it's set — better to set it as a permanent environment variable
rather than typing it each launch.

## Getting Windows/Mac builds

Electron apps have to be packaged on (or for) the OS they'll run on —
there's no reliable way to cross-compile a signed, working `.exe` or `.dmg`
from Linux (the tooling exists via Wine, but produces flaky, unsigned
output not worth handing you as a real deliverable). Two solid options,
both already set up in this project:

**Option A — GitHub Actions (recommended, no local machine needed):**
Push this project to a GitHub repo and either push to `main` or run the
included `.github/workflows/build.yml` workflow manually from the Actions
tab. It builds on real Windows, macOS, and Linux runners and uploads all
three installers as downloadable artifacts. Free for public repos (and for
most personal use on private ones too).

**Option B — build locally on each OS:**
```bash
npm install
npm run dist:win     # run this on Windows -> dist/*.exe
npm run dist:mac      # run this on macOS -> dist/*.dmg
npm run dist:linux    # run this on Linux -> dist/*.AppImage
```

Neither produces a *code-signed* build unless you add your own certificate
(`CSC_LINK`/`CSC_KEY_PASSWORD` for Windows, an Apple Developer ID for
macOS) — unsigned is fine for personal use, it just means Windows
SmartScreen or macOS Gatekeeper will show a one-time "unknown publisher"
warning that the user clicks through.

## How the RAG side works

- Each topic has a `description` and a few `keywords`. Keywords go to the
  source APIs as actual search terms; the description is used to
  **semantically re-rank and filter** what comes back, since keyword search
  alone pulls in a lot of near-misses (especially from PubMed and
  Semantic Scholar).
- Relevance scoring and search both use **TF-IDF cosine similarity, in pure
  JavaScript** — no native modules, no Python, no external embedding
  service, which is what keeps the whole thing packageable as a single
  self-contained binary. Trade-off worth knowing: TF-IDF catches shared
  vocabulary well but doesn't understand synonyms or paraphrase the way a
  neural embedding model would. If you want closer-to-neural recall later,
  `src/store.js` has a comment showing where to swap in an embeddings API
  (e.g. Voyage AI) without touching the rest of the pipeline.
- Everything that clears the relevance threshold is stored in a local JSON
  doc store (`docstore.json` in your user data folder) that **accumulates
  across runs** — it's a permanent, growing corpus, not a cache that gets
  wiped.
- The digest only shows papers *new* since the last fetch, so it doesn't
  repeat itself day to day.
- The "Search doc space" tab embeds your query, retrieves the closest
  matches from the whole store (or one topic's slice), and asks Claude to
  synthesize an answer grounded only in those retrieved passages —
  standard RAG, just with a lightweight retriever.

## Project layout

```
paper-feed-electron/
  config.yaml              <- bundled default; your real copy lives in userData
  main.js                    <- Electron main process: IPC, scheduling, state
  preload.js                   <- safe API bridge to the renderer
  src/
    config.js                   <- loads/copies config.yaml
    store.js                      <- TF-IDF doc store (the accumulating doc space)
    sources.js                     <- arXiv / PubMed / Semantic Scholar connectors
    pipeline.js                     <- fetch -> relevance filter -> store
    summarizer.js                    <- Claude REST calls for digest & RAG answers
  renderer/
    index.html, style.css, renderer.js  <- the window UI
  .github/workflows/build.yml       <- CI: real Windows/Mac/Linux builds
  build.yml config lives in package.json's "build" field (electron-builder)
```

## Limitations worth knowing

- Semantic Scholar and PubMed rate-limit unauthenticated requests. If you
  add many topics or refresh very often, set `SEMANTIC_SCHOLAR_API_KEY`
  and/or `NCBI_API_KEY` in your environment (both free to obtain).
- TF-IDF relevance filtering is good at cutting obvious noise, not a
  substitute for reading the papers — tune `relevance_threshold` in
  `config.yaml` if you're getting too much or too little.
- Full-text ingestion isn't included in this version (unlike a fuller
  neural-RAG setup, it's abstract-level only) — ask if you want that added
  back in for arXiv PDFs specifically.
