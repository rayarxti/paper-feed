/**
 * The local "doc space": every paper ever ingested, persisted as plain JSON
 * on disk, with a TF-IDF index built in pure JavaScript for relevance
 * filtering and search. No native modules, no Python, no embedding API —
 * this is what lets the whole thing ship as a single self-contained binary.
 *
 * Trade-off worth knowing: TF-IDF cosine similarity catches shared
 * vocabulary well but doesn't understand synonyms or paraphrase the way a
 * neural embedding model would. It's the right choice here because it adds
 * zero runtime dependencies; if you want closer-to-neural recall, swap
 * `vectorize()` for calls to an embeddings API (e.g. Voyage AI) and store
 * the returned vectors instead of TF-IDF ones — the rest of the pipeline
 * (cosine similarity, thresholding, storage) stays the same.
 */

const fs = require("fs");
const path = require("path");

const STOPWORDS = new Set(
  "a an the of and or in on for to with from by is are was were be been being this that these those as at it its into over under between within without using use used based via using new study paper we our results show shows show showed demonstrate propose approach method methods can may also".split(
    " "
  )
);

function tokenize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function termFreq(tokens) {
  const tf = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  const norm = tokens.length || 1;
  for (const k of tf.keys()) tf.set(k, tf.get(k) / norm);
  return tf;
}

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [k, v] of a) {
    na += v * v;
    if (b.has(k)) dot += v * b.get(k);
  }
  for (const v of b.values()) nb += v * v;
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

class DocStore {
  constructor(dataDir) {
    this.file = path.join(dataDir, "docstore.json");
    this.papers = this._load();
  }

  _load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
      return raw.papers || {};
    } catch {
      return {};
    }
  }

  _save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify({ papers: this.papers }, null, 2));
  }

  count() {
    return Object.keys(this.papers).length;
  }

  existingIds(ids) {
    return new Set(ids.filter((id) => id in this.papers));
  }

  allPapers(topicName) {
    const list = Object.values(this.papers);
    return topicName ? list.filter((p) => p.topic === topicName) : list;
  }

  /** IDF computed fresh over a given set of token-lists (corpus + candidates
   * combined so relevance filtering reflects the actual comparison set). */
  static idfOver(tokenLists) {
    const df = new Map();
    for (const tokens of tokenLists) {
      for (const term of new Set(tokens)) df.set(term, (df.get(term) || 0) + 1);
    }
    const n = tokenLists.length || 1;
    const idf = new Map();
    for (const [term, count] of df) idf.set(term, Math.log((n + 1) / (count + 1)) + 1);
    return idf;
  }

  static vectorize(tokens, idf) {
    const tf = termFreq(tokens);
    const vec = new Map();
    for (const [term, freq] of tf) vec.set(term, freq * (idf.get(term) || 1));
    return vec;
  }

  /** Filters candidate papers by TF-IDF cosine similarity to a topic's
   * description + keywords, against a corpus built from existing store
   * contents plus the candidates themselves. Returns candidates sorted by
   * relevance, highest first, above `threshold`. */
  filterRelevant(topic, candidates, threshold) {
    if (candidates.length === 0) return [];
    const candTokens = candidates.map((p) => tokenize(`${p.title} ${p.abstract}`));
    const corpusTokens = [...Object.values(this.papers).map((p) => p.tokens || []), ...candTokens];
    const idf = DocStore.idfOver(corpusTokens);

    const queryTokens = tokenize(`${topic.name} ${topic.description} ${topic.keywords.join(" ")}`);
    const queryVec = DocStore.vectorize(queryTokens, idf);

    const scored = candidates.map((p, i) => ({
      score: cosine(queryVec, DocStore.vectorize(candTokens[i], idf)),
      paper: p,
      tokens: candTokens[i],
    }));
    return scored
      .filter((s) => s.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .map((s) => ({ ...s.paper, tokens: s.tokens }));
  }

  /** Adds papers not already present, storing their tokens for future TF-IDF
   * passes. Returns only the papers that were actually new. */
  addPapers(papers, topicName) {
    const fresh = papers.filter((p) => !(p.id in this.papers));
    for (const p of fresh) {
      this.papers[p.id] = {
        ...p,
        topic: topicName,
        tokens: p.tokens || tokenize(`${p.title} ${p.abstract}`),
        addedAt: new Date().toISOString(),
      };
    }
    if (fresh.length) this._save();
    return fresh;
  }

  /** Ad hoc search across the whole doc space, or one topic's slice of it. */
  search(queryText, { topicName = null, k = 8 } = {}) {
    const pool = this.allPapers(topicName);
    if (pool.length === 0) return [];
    const idf = DocStore.idfOver(pool.map((p) => p.tokens || []));
    const queryVec = DocStore.vectorize(tokenize(queryText), idf);
    const scored = pool.map((p) => ({
      score: cosine(queryVec, DocStore.vectorize(p.tokens || [], idf)),
      paper: p,
    }));
    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map((s) => ({ ...s.paper, score: s.score }));
  }
}

module.exports = { DocStore, tokenize };
