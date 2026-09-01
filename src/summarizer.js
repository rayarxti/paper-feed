/**
 * Talks to the Anthropic API directly over fetch — no SDK dependency needed
 * for two calls. Requires ANTHROPIC_API_KEY in the environment.
 */

const API_URL = "https://api.anthropic.com/v1/messages";

async function callClaude(model, prompt, maxTokens) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set. Set it in your environment before running the app.");
  }
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic API error (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function stripFences(s) {
  return s.trim().replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
}

async function digestSummaries(papers, model) {
  if (papers.length === 0) return { summaries: {}, synthesis: "" };

  const listing = papers.map((p, i) => `[${i}] ${p.title}\nAbstract: ${p.abstract}`).join("\n\n");
  const prompt =
    "For each numbered paper below, write a two-sentence plain-language summary for a " +
    "researcher skimming a morning digest: sentence one states what the paper does, " +
    "sentence two states the finding or contribution. Then, only if there is more than " +
    "one paper, add one extra sentence noting any shared theme or disagreement across " +
    "them (empty string if there's nothing worth noting).\n\n" +
    'Respond ONLY with JSON: {"summaries": {"0": "...", "1": "..."}, "synthesis": "..."}. ' +
    "No markdown fences, no other text.\n\n" +
    listing;

  const raw = stripFences(await callClaude(model, prompt, 1400));
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

async function answerQuery(query, hits, model) {
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
  return (await callClaude(model, prompt, 800)).trim();
}

module.exports = { digestSummaries, answerQuery };
