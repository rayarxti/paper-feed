const tabsEl = document.getElementById("tabs");
const panelsEl = document.getElementById("panels");
const statusEl = document.getElementById("status-label");
const refreshAllBtn = document.getElementById("refresh-all-btn");
const configHint = document.getElementById("config-hint");

let topics = [];
let digestState = {};
let activeTab = null;

function fmtDate(iso) {
  if (!iso) return "Not fetched yet";
  const d = new Date(iso);
  return "Updated " + d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function setActiveTab(name) {
  activeTab = name;
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.dataset.tab === name));
}

function buildTabsAndPanels() {
  tabsEl.innerHTML = "";
  panelsEl.innerHTML = "";

  topics.forEach((topic) => {
    const btn = document.createElement("button");
    btn.className = "tab-btn";
    btn.textContent = topic.name;
    btn.dataset.tab = topic.name;
    btn.onclick = () => setActiveTab(topic.name);
    tabsEl.appendChild(btn);

    const panel = document.createElement("div");
    panel.className = "panel";
    panel.dataset.tab = topic.name;
    panel.innerHTML = `
      <div class="panel-header">
        <span class="muted" id="updated-${cssId(topic.name)}">Not fetched yet</span>
        <button class="secondary" data-refresh="${escapeHtml(topic.name)}">Refresh</button>
      </div>
      <div class="synthesis" id="synth-${cssId(topic.name)}"></div>
      <div id="list-${cssId(topic.name)}"></div>
    `;
    panelsEl.appendChild(panel);
    panel.querySelector("[data-refresh]").onclick = () => refreshTopic(topic.name);
  });

  const searchBtn = document.createElement("button");
  searchBtn.className = "tab-btn";
  searchBtn.textContent = "Search doc space";
  searchBtn.dataset.tab = "__search__";
  searchBtn.onclick = () => setActiveTab("__search__");
  tabsEl.appendChild(searchBtn);

  const searchPanel = document.createElement("div");
  searchPanel.className = "panel";
  searchPanel.dataset.tab = "__search__";
  searchPanel.innerHTML = `
    <div class="search-row">
      <input type="text" id="search-input" placeholder="Ask a question across everything ever ingested…" />
      <select id="search-topic">
        <option value="">All topics</option>
        ${topics.map((t) => `<option value="${escapeHtml(t.name)}">${escapeHtml(t.name)}</option>`).join("")}
      </select>
      <button id="search-btn">Search</button>
    </div>
    <div id="search-results"></div>
  `;
  panelsEl.appendChild(searchPanel);
  searchPanel.querySelector("#search-btn").onclick = runSearch;
  searchPanel.querySelector("#search-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") runSearch();
  });

  if (!activeTab) setActiveTab(topics[0] ? topics[0].name : "__search__");
  else setActiveTab(activeTab);
}

function cssId(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function renderTopic(name) {
  const state = digestState[name] || { entries: [], synthesis: "", lastUpdated: null };
  const updatedEl = document.getElementById(`updated-${cssId(name)}`);
  const synthEl = document.getElementById(`synth-${cssId(name)}`);
  const listEl = document.getElementById(`list-${cssId(name)}`);
  if (!listEl) return;

  if (updatedEl) updatedEl.textContent = fmtDate(state.lastUpdated);
  if (synthEl) synthEl.textContent = state.synthesis || "";

  if (state.entries.length === 0) {
    listEl.innerHTML = `<div class="empty">No papers yet — click Refresh.</div>`;
    return;
  }

  listEl.innerHTML = state.entries
    .map(({ paper, summary }) => {
      const authors = (paper.authors || []).slice(0, 3).join(", ") + (paper.authors.length > 3 ? ", et al." : "");
      return `
        <div class="paper-card">
          <a class="paper-title" data-url="${escapeHtml(paper.url)}">${escapeHtml(paper.title)}</a>
          <div class="paper-meta">${escapeHtml(authors)} · ${escapeHtml(paper.venue)} · ${escapeHtml((paper.published || "").slice(0, 10))}</div>
          <p class="paper-summary">${escapeHtml(summary)}</p>
        </div>`;
    })
    .join("");

  listEl.querySelectorAll(".paper-title[data-url]").forEach((el) => {
    el.onclick = () => window.api.openExternal(el.dataset.url);
  });
}

function renderAllTopics() {
  topics.forEach((t) => renderTopic(t.name));
}

async function refreshAll() {
  refreshAllBtn.disabled = true;
  statusEl.textContent = "Refreshing all topics…";
  try {
    const res = await window.api.refreshAll();
    digestState = res.digestState;
    renderAllTopics();
    statusEl.textContent = `Up to date · doc space has ${res.paperCount} papers`;
  } catch (e) {
    statusEl.textContent = "Error refreshing — see console";
    console.error(e);
  } finally {
    refreshAllBtn.disabled = false;
  }
}

async function refreshTopic(name) {
  statusEl.textContent = `Refreshing ${name}…`;
  try {
    const res = await window.api.refreshTopic(name);
    digestState[name] = res.topicState;
    renderTopic(name);
    statusEl.textContent = `Up to date · doc space has ${res.paperCount} papers`;
  } catch (e) {
    statusEl.textContent = "Error refreshing — see console";
    console.error(e);
  }
}

async function runSearch() {
  const input = document.getElementById("search-input");
  const topicSel = document.getElementById("search-topic");
  const resultsEl = document.getElementById("search-results");
  const query = input.value.trim();
  if (!query) return;

  resultsEl.innerHTML = `<div class="empty">Searching the doc space…</div>`;
  try {
    const { answer, hits } = await window.api.search(query, topicSel.value);
    const hitsHtml = hits
      .map(
        (h) => `
        <div class="search-hit">
          <a class="paper-title" data-url="${escapeHtml(h.url)}">${escapeHtml(h.title)}</a>
          <div class="paper-meta">${escapeHtml(h.venue || "")} · ${escapeHtml((h.published || "").slice(0, 10))}</div>
        </div>`
      )
      .join("");
    resultsEl.innerHTML = `<div class="search-answer">${escapeHtml(answer)}</div>${hitsHtml}`;
    resultsEl.querySelectorAll(".paper-title[data-url]").forEach((el) => {
      el.onclick = () => window.api.openExternal(el.dataset.url);
    });
  } catch (e) {
    resultsEl.innerHTML = `<div class="empty">Search failed — see console.</div>`;
    console.error(e);
  }
}

function renderOllamaBanner(ollama) {
  const banner = document.getElementById("ollama-banner");
  if (!ollama || ollama.ok) {
    banner.style.display = "none";
    return;
  }
  banner.style.display = "block";
  banner.textContent = `⚠ ${ollama.reason}`;
}

async function reloadConfig() {
  statusEl.textContent = "Reloading config…";
  const res = await window.api.reloadConfig();
  topics = res.topics;
  digestState = res.digestState;
  buildTabsAndPanels();
  renderAllTopics();
  renderOllamaBanner(res.ollama);
  statusEl.textContent = `Config reloaded · doc space has ${res.paperCount} papers`;
}

document.getElementById("refresh-all-btn").onclick = refreshAll;
document.getElementById("reload-config-btn").onclick = reloadConfig;
document.getElementById("open-folder-btn").onclick = () => window.api.openConfigFolder();

window.api.onDigestUpdate((data) => {
  digestState = data.digestState;
  renderAllTopics();
  statusEl.textContent = `Up to date · doc space has ${data.paperCount} papers`;
});

(async function init() {
  const res = await window.api.getConfig();
  topics = res.topics;
  digestState = res.digestState;
  configHint.textContent = `topics live in ${res.configPath}`;
  buildTabsAndPanels();
  renderAllTopics();
  renderOllamaBanner(res.ollama);
  statusEl.textContent = `Ready · doc space has ${res.paperCount} papers`;
})();
