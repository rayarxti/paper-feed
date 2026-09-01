const { XMLParser } = require("fast-xml-parser");

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

function asArray(x) {
  if (x === undefined || x === null) return [];
  return Array.isArray(x) ? x : [x];
}

// ------------------------------------------------------------------ arXiv
async function fetchArxiv(topic, maxResults) {
  const clause = "(" + topic.keywords.map((k) => `abs:"${k}"`).join(" OR ") + ")";
  const url =
    `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(clause)}` +
    `&sortBy=submittedDate&sortOrder=descending&max_results=${maxResults}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`arXiv request failed (${res.status})`);
  const text = await res.text();
  const parsed = xmlParser.parse(text);
  const entries = asArray(parsed?.feed?.entry);

  return entries.map((e) => {
    const id = String(e.id || "").split("/").pop();
    const links = asArray(e.link);
    const pdfLink = links.find((l) => l["@_type"] === "application/pdf");
    const htmlLink = links.find((l) => l["@_type"] === "text/html") || links[0];
    return {
      id: `arxiv:${id}`,
      title: String(e.title || "").replace(/\s+/g, " ").trim(),
      abstract: String(e.summary || "").replace(/\s+/g, " ").trim(),
      authors: asArray(e.author).map((a) => a.name).filter(Boolean),
      published: e.published || "",
      url: htmlLink ? htmlLink["@_href"] : e.id,
      pdfUrl: pdfLink ? pdfLink["@_href"] : "",
      venue: "arXiv preprint",
      source: "arxiv",
    };
  });
}

// ----------------------------------------------------------------- PubMed
async function fetchPubmed(topic, maxResults, lookbackDays) {
  const term = topic.keywords.map((k) => `"${k}"[tiab]`).join(" OR ");
  const searchUrl =
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&sort=date` +
    `&datetype=pdat&reldate=${lookbackDays}&retmax=${maxResults}&term=${encodeURIComponent(term)}` +
    (process.env.NCBI_API_KEY ? `&api_key=${process.env.NCBI_API_KEY}` : "");

  const sres = await fetch(searchUrl);
  if (!sres.ok) throw new Error(`PubMed search failed (${sres.status})`);
  const ids = (await sres.json())?.esearchresult?.idlist || [];
  if (ids.length === 0) return [];

  const fetchUrl =
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&retmode=xml&id=${ids.join(",")}` +
    (process.env.NCBI_API_KEY ? `&api_key=${process.env.NCBI_API_KEY}` : "");
  const fres = await fetch(fetchUrl);
  if (!fres.ok) throw new Error(`PubMed fetch failed (${fres.status})`);
  const parsed = xmlParser.parse(await fres.text());
  const articles = asArray(parsed?.PubmedArticleSet?.PubmedArticle);

  const papers = [];
  for (const art of articles) {
    const medline = art?.MedlineCitation || {};
    const pmid = typeof medline.PMID === "object" ? medline.PMID["#text"] : medline.PMID;
    const articleNode = medline.Article || {};
    const title = String(articleNode.ArticleTitle || "").replace(/\s+/g, " ").trim();
    const abstractNode = articleNode.Abstract?.AbstractText;
    const abstract = asArray(abstractNode)
      .map((a) => (typeof a === "object" ? a["#text"] || "" : a))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!title || !abstract) continue;

    const authorList = asArray(articleNode.AuthorList?.Author).map((a) => {
      const fore = a.ForeName || "";
      const last = a.LastName || "";
      return `${fore} ${last}`.trim();
    }).filter(Boolean);

    const journal = articleNode.Journal?.Title || "Journal article";
    const pubDate = articleNode.Journal?.JournalIssue?.PubDate || {};
    const year = pubDate.Year || "";
    const month = pubDate.Month || "01";
    const day = pubDate.Day || "01";

    papers.push({
      id: `pubmed:${pmid}`,
      title,
      abstract,
      authors: authorList,
      published: year ? `${year}-${month}-${day}` : "",
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      pdfUrl: "",
      venue: journal,
      source: "pubmed",
    });
  }
  return papers;
}

// --------------------------------------------------------- Semantic Scholar
async function fetchSemanticScholar(topic, maxResults, lookbackDays) {
  const since = new Date(Date.now() - lookbackDays * 86400000).toISOString().slice(0, 10);
  const headers = process.env.SEMANTIC_SCHOLAR_API_KEY
    ? { "x-api-key": process.env.SEMANTIC_SCHOLAR_API_KEY }
    : {};
  const fields = "title,abstract,authors,venue,publicationDate,url,openAccessPdf";

  const seen = new Set();
  const papers = [];
  for (const kw of topic.keywords) {
    const url =
      `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(kw)}` +
      `&fields=${fields}&limit=${maxResults}&sort=publicationDate:desc&publicationDateOrYear=${since}:`;
    const res = await fetch(url, { headers });
    if (!res.ok) continue;
    const data = await res.json();
    for (const item of data?.data || []) {
      if (!item.paperId || seen.has(item.paperId) || !item.abstract) continue;
      seen.add(item.paperId);
      papers.push({
        id: `s2:${item.paperId}`,
        title: item.title || "",
        abstract: item.abstract || "",
        authors: (item.authors || []).map((a) => a.name),
        published: item.publicationDate || "",
        url: item.url || "",
        pdfUrl: item.openAccessPdf?.url || "",
        venue: item.venue || "Conference / journal paper",
        source: "semantic_scholar",
      });
    }
    if (papers.length >= maxResults) break;
  }
  return papers.slice(0, maxResults);
}

module.exports = { fetchArxiv, fetchPubmed, fetchSemanticScholar };
