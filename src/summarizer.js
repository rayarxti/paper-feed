/**
 * Talks to a local Ollama server instead of a cloud API — nothing leaves
 * the machine, no API key, no per-token cost. Requires Ollama running
 * (https://ollama.com) with the configured model already pulled, e.g.:
 *   ollama pull llama3.1
 *
 * Ollama's /api/generate supports `format: "json"` to force valid JSON
 * output, which is what the digest summarizer relies on.
 */

async function callOllama(llmCfg, prompt, { json = false, timeoutMs = 120000 } = {}) {
  let res;
  try {
    res = await fetch(`${llmCfg.host}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: llmCfg.model,
        prompt,
        stream: false,
        ...(json ? { format: "json" } : {}),
      }),
    });
  } catch (e) {
    if (e.name === "TimeoutError" || e.name === "AbortError") {
      throw new Error(
        `Ollama didn't respond within ${timeoutMs / 1000}s. The model may still be loading — try again in a moment.`
      );
    }
    throw new Error(
      `Couldn't reach Ollama at ${llmCfg.host}. Is it running? Start the Ollama app, or run ` +
        `"ollama serve" in a terminal, then try again. (${e.message})`
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 404) {
      throw new Error(
        `Ollama can't find model "${llmCfg.model}". Pull it first: ollama pull ${llmCfg.model}`
      );
    }
    throw new Error(`Ollama error (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.response || "";
}

function stripFences(s) {
  return s.trim().replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
}

async function digestSummaries(papers, llmCfg) {
  if (papers.length === 0) return { summaries: {}, synthesis: "" };

  const listing = papers.map((p, i) => `[${i}] ${p.title}\nAbstract: ${p.abstract}`).join("\n\n");
  const prompt =
    "For each numbered paper below, write a two-sentence plain-language summary for a " +
    "researcher skimming a morning digest: sentence one states what the paper does, " +
    "sentence two states the finding or contribution. Then, only if there is more than " +
    "one paper, add one extra sentence noting any shared theme or disagreement across " +
    "them (empty string if there's nothing worth noting).\n\n" +
    'Respond ONLY with JSON in this exact shape: {"summaries": {"0": "...", "1": "..."}, "synthesis": "..."}. ' +
    "No markdown fences, no other text, no explanation — JSON only.\n\n" +
    listing;

  const raw = stripFences(await callOllama(llmCfg, prompt, { json: true }));
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = { summaries: {}, synthesis: "" };
  }
  const summaries = {};
  papers.forEach((p, i) => {
    summaries[p.id] = parsed.summaries?.[String(i)] || "";
  });
  return { summaries, synthesis: parsed.synthesis || "" };
}

async function answerQuery(query, hits, llmCfg) {
  if (hits.length === 0) {
    return "Nothing in the doc space matches that yet — try a broader query or fetch more papers first.";
  }
  const context = hits
    .map(
      (h) =>
        `Source: ${h.title} (${h.venue || ""}, ${h.published || "n.d."})\n${(h.abstract || "").slice(0, 1200)}`
    )
    .join("\n\n");
  const prompt =
    "Answer the question below using ONLY the sources provided. Cite sources inline by title " +
    "in parentheses. If the sources don't contain a real answer, say so plainly rather than " +
    `guessing.\n\nQuestion: ${query}\n\nSources:\n${context}`;
  return (await callOllama(llmCfg, prompt)).trim();
}

/** Quick reachability + model-availability check, used to show a helpful
 * banner in the UI instead of a wall of fetch errors. */
async function checkOllama(llmCfg) {
  try {
    const res = await fetch(`${llmCfg.host}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return { ok: false, reason: `Ollama responded with ${res.status}` };
    const data = await res.json();
    const names = (data.models || []).map((m) => m.name);
    const hasModel = names.some((n) => n === llmCfg.model || n.startsWith(`${llmCfg.model}:`));
    if (!hasModel) {
      return {
        ok: false,
        reason: `Ollama is running, but "${llmCfg.model}" isn't pulled yet. Run: ollama pull ${llmCfg.model}`,
      };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `Can't reach Ollama at ${llmCfg.host} — is it running?` };
  }
}

module.exports = { digestSummaries, answerQuery, checkOllama };
