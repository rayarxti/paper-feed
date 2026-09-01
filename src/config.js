const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { app, shell } = require("electron");

function bundledDefaultPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "config.yaml")
    : path.join(__dirname, "..", "config.yaml");
}

function userConfigPath() {
  return path.join(app.getPath("userData"), "config.yaml");
}

function ensureUserConfig() {
  const dest = userConfigPath();
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(bundledDefaultPath(), dest);
  }
  return dest;
}

function loadConfig() {
  const configPath = ensureUserConfig();
  const raw = yaml.load(fs.readFileSync(configPath, "utf8")) || {};

  const topics = (raw.topics || []).map((t) => ({
    name: t.name,
    description: (t.description || "").trim(),
    keywords: t.keywords && t.keywords.length ? t.keywords : [t.name],
  }));

  return {
    configPath,
    topics,
    sources: raw.sources || { arxiv: true, pubmed: true, semantic_scholar: true },
    papersPerTopicPerSource: Number(raw.papers_per_topic_per_source ?? 6),
    lookbackDays: Number(raw.lookback_days ?? 3),
    relevanceThreshold: Number(raw.relevance_threshold ?? 0.06),
    fetchIntervalHours: Number(raw.fetch_interval_hours ?? 24),
    anthropicModel: raw.anthropic_model || "claude-sonnet-4-6",
  };
}

function openConfigFolder() {
  shell.showItemInFolder(userConfigPath());
}

module.exports = { loadConfig, userConfigPath, openConfigFolder };
