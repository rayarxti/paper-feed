const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");

const { loadConfig, openConfigFolder } = require("./src/config");
const { DocStore } = require("./src/store");
const { ingestTopic } = require("./src/pipeline");
const { digestSummaries, answerQuery, checkOllama } = require("./src/summarizer");

let cfg = null;
let store = null;
let win = null;
let schedulerHandle = null;

function statePath() {
  return path.join(app.getPath("userData"), "digest-state.json");
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), "utf8"));
  } catch {
    return {};
  }
}

function saveState(state) {
  fs.writeFileSync(statePath(), JSON.stringify(state, null, 2));
}

let digestState = {}; // { [topicName]: { entries: [{paper, summary}], synthesis, lastUpdated } }

function ensureTopicState(name) {
  if (!digestState[name]) digestState[name] = { entries: [], synthesis: "", lastUpdated: null };
}

async function refreshTopic(topic) {
  ensureTopicState(topic.name);
  const newPapers = await ingestTopic(topic, cfg, store);
  if (newPapers.length > 0) {
    const { summaries, synthesis } = await digestSummaries(newPapers, cfg.llm);
    const entries = newPapers.map((p) => ({
      paper: stripTokens(p),
      summary: summaries[p.id] || p.abstract.slice(0, 220) + "…",
    }));
    digestState[topic.name].entries = [...entries, ...digestState[topic.name].entries];
    if (synthesis) digestState[topic.name].synthesis = synthesis;
  }
  digestState[topic.name].lastUpdated = new Date().toISOString();
  saveState(digestState);
  return digestState[topic.name];
}

function stripTokens(p) {
  const { tokens, ...rest } = p;
  return rest;
}

async function refreshAll() {
  for (const topic of cfg.topics) {
    try {
      await refreshTopic(topic);
    } catch (e) {
      console.error(`Refresh failed for '${topic.name}':`, e.message);
    }
  }
  return digestState;
}

function startScheduler() {
  if (schedulerHandle) clearInterval(schedulerHandle);
  if (cfg.fetchIntervalHours <= 0) return;
  schedulerHandle = setInterval(async () => {
    const state = await refreshAll();
    if (win) win.webContents.send("digest-update", state);
  }, cfg.fetchIntervalHours * 3600 * 1000);
}

function initState() {
  digestState = loadState();
  for (const topic of cfg.topics) ensureTopicState(topic.name);
}

// ------------------------------------------------------------------- IPC
ipcMain.handle("get-config", async () => ({
  topics: cfg.topics,
  configPath: cfg.configPath,
  digestState,
  paperCount: store.count(),
  ollama: await checkOllama(cfg.llm),
}));

ipcMain.handle("reload-config", async () => {
  cfg = loadConfig();
  store = new DocStore(app.getPath("userData"));
  initState();
  startScheduler();
  return {
    topics: cfg.topics,
    configPath: cfg.configPath,
    digestState,
    paperCount: store.count(),
    ollama: await checkOllama(cfg.llm),
  };
});

ipcMain.handle("open-config-folder", () => openConfigFolder());

ipcMain.handle("open-external", (_e, url) => shell.openExternal(url));

ipcMain.handle("refresh-all", async () => {
  const state = await refreshAll();
  return { digestState: state, paperCount: store.count() };
});

ipcMain.handle("refresh-topic", async (_e, topicName) => {
  const topic = cfg.topics.find((t) => t.name === topicName);
  if (!topic) throw new Error(`Unknown topic: ${topicName}`);
  const topicState = await refreshTopic(topic);
  return { topicState, paperCount: store.count() };
});

ipcMain.handle("search", async (_e, query, topicName) => {
  const hits = store.search(query, { topicName: topicName || null, k: 8 });
  const answer = await answerQuery(query, hits, cfg.llm);
  return { answer, hits };
});

// ---------------------------------------------------------------- window
function createWindow() {
  win = new BrowserWindow({
    width: 960,
    height: 740,
    minWidth: 700,
    minHeight: 500,
    backgroundColor: "#f1eee4",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(() => {
  cfg = loadConfig();
  store = new DocStore(app.getPath("userData"));
  initState();
  createWindow();
  startScheduler();
  // Kick off an initial fetch shortly after launch, without blocking the window opening.
  setTimeout(async () => {
    const state = await refreshAll();
    if (win) win.webContents.send("digest-update", { digestState: state, paperCount: store.count() });
  }, 800);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (schedulerHandle) clearInterval(schedulerHandle);
  if (process.platform !== "darwin") app.quit();
});
