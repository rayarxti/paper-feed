const { fetchArxiv, fetchPubmed, fetchSemanticScholar } = require("./sources");

function normalizeTitleKey(title) {
  return (title || "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 80);
}

async function fetchCandidates(topic, cfg) {
  const n = cfg.papersPerTopicPerSource;
  const jobs = [];
  if (cfg.sources.arxiv) jobs.push(["arxiv", fetchArxiv(topic, n)]);
  if (cfg.sources.pubmed) jobs.push(["pubmed", fetchPubmed(topic, n, cfg.lookbackDays)]);
  if (cfg.sources.semantic_scholar)
    jobs.push(["semantic_scholar", fetchSemanticScholar(topic, n, cfg.lookbackDays)]);

  const results = await Promise.allSettled(jobs.map(([, p]) => p));
  const candidates = [];
  results.forEach((r, i) => {
    const [name] = jobs[i];
    if (r.status === "fulfilled") candidates.push(...r.value);
    else console.error(`[${name}] fetch failed for '${topic.name}':`, r.reason?.message || r.reason);
  });

  const seen = new Set();
  const deduped = [];
  for (const p of candidates) {
    const key = normalizeTitleKey(p.title);
    if (key && !seen.has(key)) {
      seen.add(key);
      deduped.push(p);
    }
  }
  return deduped;
}

/** Fetch, semantically filter, and store. Returns papers newly added to the
 * doc space (what belongs in today's digest). */
async function ingestTopic(topic, cfg, store) {
  const candidates = await fetchCandidates(topic, cfg);
  const relevant = store.filterRelevant(topic, candidates, cfg.relevanceThreshold);
  return store.addPapers(relevant, topic.name);
}

module.exports = { ingestTopic, fetchCandidates };
