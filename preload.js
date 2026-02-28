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
  onStateUpdated: (callback) => ipcRenderer.on("state-updated", (_event, state) => callback(state)),
});
