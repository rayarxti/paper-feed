const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getConfig: () => ipcRenderer.invoke("get-config"),
  reloadConfig: () => ipcRenderer.invoke("reload-config"),
  openConfigFolder: () => ipcRenderer.invoke("open-config-folder"),
  refreshAll: () => ipcRenderer.invoke("refresh-all"),
  refreshTopic: (topicName) => ipcRenderer.invoke("refresh-topic", topicName),
  search: (query, topicName) => ipcRenderer.invoke("search", query, topicName),
  onDigestUpdate: (callback) => ipcRenderer.on("digest-update", (_e, data) => callback(data)),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
});
