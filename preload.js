const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getAppState: () => ipcRenderer.invoke("get-app-state"),
  refreshState: () => ipcRenderer.invoke("refresh-state"),
  chooseWallpaperDir: () => ipcRenderer.invoke("choose-wallpaper-dir"),
  updateSettings: (updates) => ipcRenderer.invoke("update-settings", updates),
  applyWallpaper: (imagePath) => ipcRenderer.invoke("apply-wallpaper", imagePath),
  shuffleWallpaper: () => ipcRenderer.invoke("shuffle-wallpaper"),
  cycleWallpaper: (direction) => ipcRenderer.invoke("cycle-wallpaper", direction),
  windowAction: (action) => ipcRenderer.invoke("window-action", action),
  checkForUpdates: () => ipcRenderer.send("check-for-updates"),
  restartToUpdate: () => ipcRenderer.send("restart-to-update"),
  onStateUpdated: (callback) => ipcRenderer.on("state-updated", (_event, state) => callback(state)),
  onUpdateMessage: (callback) => ipcRenderer.on("update-message", (_event, payload) => callback(payload)),
  onUpdateAvailable: (callback) => ipcRenderer.on("update-available", (_event, payload) => callback(payload)),
  onUpdateNotAvailable: (callback) => ipcRenderer.on("update-not-available", (_event, payload) => callback(payload)),
  onUpdateError: (callback) => ipcRenderer.on("update-error", (_event, payload) => callback(payload)),
  onDownloadProgress: (callback) => ipcRenderer.on("download-progress", (_event, payload) => callback(payload)),
  onUpdateDownloaded: (callback) => ipcRenderer.on("update-downloaded", (_event, payload) => callback(payload)),
});
