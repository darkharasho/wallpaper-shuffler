const { app, BrowserWindow, dialog, ipcMain, protocol, net } = require("electron");
const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const { pathToFileURL } = require("url");

let autoUpdater = null;
try {
  ({ autoUpdater } = require("electron-updater"));
} catch {
  autoUpdater = null;
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'img', privileges: { bypassCSP: true, supportFetchAPI: true, corsEnabled: true } }
]);

const CONFIG_DIR = path.join(process.env.HOME || app.getPath("home"), ".config", "wallpaper-shuffler");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
const CACHE_DIR = path.join(process.env.HOME || app.getPath("home"), ".cache", "wallpaper-shuffler");
const ACTIVE_STATE_PATH = path.join(CACHE_DIR, "active-state.json");
const DEFAULT_WALLPAPER_DIR = path.join(
  process.env.HOME || app.getPath("home"),
  "Pictures",
  "Wallpapers",
  "Double Screen"
);
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"]);
const VALID_ROTATION_MODES = new Set(["shuffle", "sequential"]);
const VALID_SORT_MODES = new Set(["name-asc", "name-desc", "newest", "oldest"]);

const DEFAULT_CONFIG = {
  wallpaperDir: DEFAULT_WALLPAPER_DIR,
  autoRotate: false,
  intervalMinutes: 30,
  rotationMode: "shuffle",
  avoidImmediateRepeats: true,
  sortMode: "name-asc",
  lastAppliedPath: null,
  lastAppliedAt: null,
};

const state = {
  config: { ...DEFAULT_CONFIG },
  library: [],
  currentSourcePath: null,
  currentWallpaperUri: null,
  currentGeneratedFiles: [],
  lastAppliedAt: null,
  timer: null,
  nextRunAt: null,
  isApplying: false,
  recentHistory: [],
  dependencyStatus: null,
  lastError: null,
};

const updaterState = {
  isSupported: false,
  disabledReason: "dev",
  status: "",
  error: null,
  progress: null,
  updateAvailable: false,
  updateDownloaded: false,
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function sendToAllWindows(channel, payload) {
  const windows = BrowserWindow.getAllWindows();
  for (const currentWindow of windows) {
    currentWindow.webContents.send(channel, payload);
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasCommand(command) {
  const result = spawnSync("which", [command], { stdio: "ignore" });
  return result.status === 0;
}

function runBinary(binary, args) {
  return execFileSync(binary, args, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function ensureDirs() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function loadJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

function normalizeConfig(rawConfig) {
  const raw = isObject(rawConfig) ? rawConfig : {};
  const interval = Number.parseInt(raw.intervalMinutes, 10);
  const rotationMode = VALID_ROTATION_MODES.has(raw.rotationMode) ? raw.rotationMode : DEFAULT_CONFIG.rotationMode;
  const sortMode = VALID_SORT_MODES.has(raw.sortMode) ? raw.sortMode : DEFAULT_CONFIG.sortMode;

  return {
    wallpaperDir:
      typeof raw.wallpaperDir === "string" && raw.wallpaperDir.trim()
        ? path.resolve(raw.wallpaperDir)
        : DEFAULT_CONFIG.wallpaperDir,
    autoRotate: Boolean(raw.autoRotate),
    intervalMinutes: Number.isFinite(interval) ? clamp(interval, 1, 1440) : DEFAULT_CONFIG.intervalMinutes,
    rotationMode,
    avoidImmediateRepeats:
      typeof raw.avoidImmediateRepeats === "boolean"
        ? raw.avoidImmediateRepeats
        : DEFAULT_CONFIG.avoidImmediateRepeats,
    sortMode,
    lastAppliedPath:
      typeof raw.lastAppliedPath === "string" && raw.lastAppliedPath.trim() ? path.resolve(raw.lastAppliedPath) : null,
    lastAppliedAt: Number.isFinite(raw.lastAppliedAt) ? raw.lastAppliedAt : null,
  };
}

function persistConfig() {
  ensureDirs();
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(state.config, null, 2)}\n`);
}

function loadConfig() {
  state.config = normalizeConfig(loadJsonFile(CONFIG_PATH, DEFAULT_CONFIG));
}

function readActiveState() {
  const activeState = loadJsonFile(ACTIVE_STATE_PATH, null);
  if (!isObject(activeState)) {
    return;
  }

  const sourcePath =
    typeof activeState.sourcePath === "string" && fs.existsSync(activeState.sourcePath)
      ? path.resolve(activeState.sourcePath)
      : null;
  const outputFiles = Array.isArray(activeState.outputFiles)
    ? activeState.outputFiles.filter((filePath) => typeof filePath === "string" && fs.existsSync(filePath))
    : [];
  const currentUri =
    typeof activeState.currentWallpaperUri === "string" && activeState.currentWallpaperUri.trim()
      ? activeState.currentWallpaperUri
      : null;

  state.currentSourcePath = sourcePath || state.config.lastAppliedPath;
  state.currentGeneratedFiles = outputFiles;
  state.currentWallpaperUri = currentUri;
  state.lastAppliedAt = Number.isFinite(activeState.appliedAt) ? activeState.appliedAt : state.config.lastAppliedAt;
}

function writeActiveState(payload) {
  ensureDirs();
  fs.writeFileSync(ACTIVE_STATE_PATH, `${JSON.stringify(payload, null, 2)}\n`);
}

function collectDependencyStatus() {
  const qdbusAvailable = hasCommand("qdbus");
  const magickAvailable = hasCommand("magick");
  return {
    qdbusAvailable,
    magickAvailable,
    ready: qdbusAvailable && magickAvailable,
    message:
      qdbusAvailable && magickAvailable
        ? "Ready for KDE Plasma dual-screen control"
        : "Install qdbus and ImageMagick (`magick`) to apply wallpapers",
  };
}

function isImageFile(filePath) {
  return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function sortLibrary(items) {
  const sorted = [...items];

  switch (state.config.sortMode) {
    case "name-desc":
      sorted.sort((a, b) => b.name.localeCompare(a.name));
      break;
    case "newest":
      sorted.sort((a, b) => b.modifiedAt - a.modifiedAt || a.name.localeCompare(b.name));
      break;
    case "oldest":
      sorted.sort((a, b) => a.modifiedAt - b.modifiedAt || a.name.localeCompare(b.name));
      break;
    case "name-asc":
    default:
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
  }

  return sorted;
}

function refreshLibrary() {
  const dir = state.config.wallpaperDir;
  if (!dir || !fs.existsSync(dir)) {
    state.library = [];
    return state.library;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const wallpapers = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const filePath = path.join(dir, entry.name);
    if (!isImageFile(filePath)) {
      continue;
    }

    const stats = fs.statSync(filePath);
    wallpapers.push({
      name: entry.name,
      path: filePath,
      size: stats.size,
      modifiedAt: stats.mtimeMs,
      previewUrl: `img://${filePath}`,
    });
  }

  state.library = sortLibrary(wallpapers);

  if (state.currentSourcePath && !state.library.some((item) => item.path === state.currentSourcePath)) {
    state.currentSourcePath = null;
    state.currentWallpaperUri = null;
  }

  return state.library;
}

function buildDesktopScript(leftImageUrl, rightImageUrl) {
  return `
    var allDesktops = desktops();
    for (var i = 0; i < allDesktops.length; i++) {
      var desktop = allDesktops[i];
      desktop.currentConfigGroup = ['Wallpaper', 'org.kde.image', 'General'];
      if (desktop.screen === 0) {
        desktop.writeConfig('Image', '${leftImageUrl}');
      } else if (desktop.screen === 1) {
        desktop.writeConfig('Image', '${rightImageUrl}');
      }
    }
  `;
}

function splitWallpaper(sourcePath) {
  ensureDirs();

  const identify = runBinary("magick", ["identify", "-format", "%w %h", sourcePath]);
  const [widthText, heightText] = identify.split(/\s+/);
  const width = Number.parseInt(widthText, 10);
  const height = Number.parseInt(heightText, 10);

  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 1) {
    throw new Error("Unable to determine image dimensions");
  }

  const leftWidth = Math.floor(width / 2);
  const rightWidth = width - leftWidth;
  const stamp = Date.now();
  const leftPath = path.join(CACHE_DIR, `left-${stamp}.png`);
  const rightPath = path.join(CACHE_DIR, `right-${stamp}.png`);

  runBinary("magick", [sourcePath, "-crop", `${leftWidth}x${height}+0+0`, "+repage", leftPath]);
  runBinary("magick", [sourcePath, "-crop", `${rightWidth}x${height}+${leftWidth}+0`, "+repage", rightPath]);

  return { leftPath, rightPath };
}

function cleanupGeneratedFiles(keepPaths) {
  if (!fs.existsSync(CACHE_DIR)) {
    return;
  }

  const keep = new Set(keepPaths);
  const files = fs.readdirSync(CACHE_DIR);
  for (const fileName of files) {
    const filePath = path.join(CACHE_DIR, fileName);
    const isPng = fileName.endsWith(".png");
    if (!isPng || keep.has(filePath)) {
      continue;
    }

    try {
      fs.unlinkSync(filePath);
    } catch {
      // Leave stale cache files in place if the filesystem is busy.
    }
  }
}

function markRecent(pathValue) {
  state.recentHistory = state.recentHistory.filter((item) => item !== pathValue);
  state.recentHistory.push(pathValue);

  const maxSize = Math.max(state.library.length - 1, 1);
  if (state.recentHistory.length > maxSize) {
    state.recentHistory = state.recentHistory.slice(-maxSize);
  }
}

function getSequentialTarget(offset = 1) {
  if (!state.library.length) {
    throw new Error("No wallpapers available");
  }

  if (!state.currentSourcePath) {
    return state.library[0];
  }

  const currentIndex = state.library.findIndex((item) => item.path === state.currentSourcePath);
  if (currentIndex === -1) {
    return state.library[0];
  }

  const nextIndex = (currentIndex + offset) % state.library.length;
  const finalIndex = (nextIndex + state.library.length) % state.library.length;
  return state.library[finalIndex];
}

function getShuffleTarget() {
  if (!state.library.length) {
    throw new Error("No wallpapers available");
  }

  let pool = [...state.library];
  if (state.config.avoidImmediateRepeats && state.currentSourcePath && pool.length > 1) {
    pool = pool.filter((item) => item.path !== state.currentSourcePath);
  }

  const unseen = pool.filter((item) => !state.recentHistory.includes(item.path));
  const source = unseen.length > 0 ? unseen : pool;
  return source[Math.floor(Math.random() * source.length)];
}

function getRotationTarget() {
  return state.config.rotationMode === "sequential" ? getSequentialTarget(1) : getShuffleTarget();
}

async function applyWallpaperFromPath(sourcePath, reason = "manual") {
  if (state.isApplying) {
    throw new Error("Wallpaper update already in progress");
  }

  if (!state.dependencyStatus?.ready) {
    throw new Error(state.dependencyStatus?.message || "Missing required wallpaper dependencies");
  }

  if (typeof sourcePath !== "string" || !sourcePath.trim()) {
    throw new Error("Invalid wallpaper path");
  }

  const resolvedPath = path.resolve(sourcePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error("Wallpaper file no longer exists");
  }

  state.isApplying = true;
  state.lastError = null;

  try {
    const { leftPath, rightPath } = splitWallpaper(resolvedPath);
    const leftUrl = pathToFileURL(leftPath).href;
    const rightUrl = pathToFileURL(rightPath).href;

    runBinary("qdbus", [
      "org.kde.plasmashell",
      "/PlasmaShell",
      "org.kde.PlasmaShell.evaluateScript",
      buildDesktopScript(leftUrl, rightUrl),
    ]);

    state.currentSourcePath = resolvedPath;
    state.currentWallpaperUri = leftUrl;
    state.currentGeneratedFiles = [leftPath, rightPath];
    state.lastAppliedAt = Date.now();
    markRecent(resolvedPath);

    state.config.lastAppliedPath = resolvedPath;
    state.config.lastAppliedAt = state.lastAppliedAt;
    persistConfig();

    writeActiveState({
      sourcePath: resolvedPath,
      outputFiles: [leftPath, rightPath],
      currentWallpaperUri: leftUrl,
      appliedAt: state.lastAppliedAt,
      reason,
    });
    cleanupGeneratedFiles([leftPath, rightPath]);

    return buildAppState();
  } catch (error) {
    state.lastError = error.message;
    throw error;
  } finally {
    state.isApplying = false;
  }
}

async function applyRandomWallpaper() {
  const target = getShuffleTarget();
  return applyWallpaperFromPath(target.path, "shuffle");
}

async function cycleWallpaper(direction) {
  const target = getSequentialTarget(direction);
  return applyWallpaperFromPath(target.path, direction >= 0 ? "next" : "previous");
}

async function applyRotationSelection() {
  const target = getRotationTarget();
  return applyWallpaperFromPath(target.path, "auto-rotate");
}

function stopRotationTimer() {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }

  state.nextRunAt = null;
}

function syncRotationTimer(forceFullInterval = false) {
  stopRotationTimer();

  if (!state.config.autoRotate || !state.library.length || !state.dependencyStatus?.ready) {
    return;
  }

  const intervalMs = state.config.intervalMinutes * 60 * 1000;
  let delayMs = intervalMs;

  if (!forceFullInterval && state.lastAppliedAt) {
    const elapsed = Date.now() - state.lastAppliedAt;
    delayMs = intervalMs - (elapsed % intervalMs);
  }

  state.nextRunAt = Date.now() + delayMs;

  state.timer = setTimeout(async () => {
    if (!state.isApplying) {
      try {
        await applyRotationSelection();
      } catch (error) {
        state.lastError = error.message;
      } finally {
        broadcastStateUpdate();
      }
    }
    syncRotationTimer(true);
  }, delayMs);
}

function getCurrentWallpaperRecord() {
  if (!state.currentSourcePath) {
    return null;
  }

  return state.library.find((item) => item.path === state.currentSourcePath) || {
    name: path.basename(state.currentSourcePath),
    path: state.currentSourcePath,
    size: null,
    modifiedAt: null,
    previewUrl: fs.existsSync(state.currentSourcePath) ? `img://${state.currentSourcePath}` : null,
  };
}

function buildAppState() {
  const totalSize = state.library.reduce((sum, item) => sum + item.size, 0);

  return {
    config: { ...state.config },
    library: state.library,
    currentWallpaper: getCurrentWallpaperRecord(),
    runtime: {
      isApplying: state.isApplying,
      autoRotateActive: Boolean(state.timer),
      nextRunAt: state.nextRunAt,
      remainingMs: state.nextRunAt ? Math.max(0, state.nextRunAt - Date.now()) : null,
      lastAppliedAt: state.lastAppliedAt,
      lastError: state.lastError,
    },
    dependencies: state.dependencyStatus,
    folderSummary: {
      count: state.library.length,
      totalSize,
    },
    environment: {
      platform: process.platform,
      desktop: process.env.XDG_CURRENT_DESKTOP || null,
    },
    appVersion: app.getVersion(),
    updater: {
      isSupported: updaterState.isSupported,
      disabledReason: updaterState.disabledReason,
      status: updaterState.status,
      error: updaterState.error,
      progress: updaterState.progress,
      updateAvailable: updaterState.updateAvailable,
      updateDownloaded: updaterState.updateDownloaded,
    },
  };
}

function broadcastStateUpdate() {
  const allWindows = BrowserWindow.getAllWindows();
  if (allWindows.length > 0) {
    const currentState = buildAppState();
    allWindows.forEach(win => win.webContents.send("state-updated", currentState));
  }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1380,
    height: 920,
    minWidth: 1080,
    minHeight: 760,
    backgroundColor: "#07111a",
    frame: false,
    titleBarStyle: "hidden",
    autoHideMenuBar: true,
    title: "Wallpaper Shuffler",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    window.loadURL(process.env.VITE_DEV_SERVER_URL);
    // window.webContents.openDevTools();
  } else {
    const builtIndexPath = path.join(__dirname, "dist", "index.html");
    const sourceIndexPath = path.join(__dirname, "index.html");
    let targetIndexPath = sourceIndexPath;

    if (fs.existsSync(builtIndexPath)) {
      let canUseBuiltIndex = true;

      try {
        const builtIndexHtml = fs.readFileSync(builtIndexPath, "utf8");
        const legacyRendererPath = path.join(__dirname, "dist", "renderer.js");
        if (builtIndexHtml.includes('src="renderer.js"') && !fs.existsSync(legacyRendererPath)) {
          canUseBuiltIndex = false;
        }
      } catch {
        canUseBuiltIndex = false;
      }

      if (canUseBuiltIndex) {
        targetIndexPath = builtIndexPath;
      }
    }

    window.loadFile(targetIndexPath);
  }
}

function refreshUpdaterSupportState() {
  if (!autoUpdater) {
    updaterState.isSupported = false;
    updaterState.disabledReason = "missing-dependency";
    return;
  }

  const updateConfigPath = path.join(process.resourcesPath, "app-update.yml");
  const isPortable = Boolean(process.env.PORTABLE_EXECUTABLE);
  const isSupported = app.isPackaged && !isPortable && fs.existsSync(updateConfigPath);

  updaterState.isSupported = isSupported;
  if (isSupported) {
    updaterState.disabledReason = null;
    return;
  }

  if (!app.isPackaged) {
    updaterState.disabledReason = "dev";
  } else if (isPortable) {
    updaterState.disabledReason = "portable";
  } else {
    updaterState.disabledReason = "missing-config";
  }
}

function setupAutoUpdater() {
  refreshUpdaterSupportState();
  if (!updaterState.isSupported) {
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    updaterState.status = "Checking for updates...";
    updaterState.error = null;
    updaterState.progress = null;
    updaterState.updateAvailable = false;
    updaterState.updateDownloaded = false;
    sendToAllWindows("update-message", updaterState.status);
  });

  autoUpdater.on("update-available", (info) => {
    updaterState.status = "Update available.";
    updaterState.error = null;
    updaterState.progress = null;
    updaterState.updateAvailable = true;
    updaterState.updateDownloaded = false;
    sendToAllWindows("update-available", info);
  });

  autoUpdater.on("update-not-available", (info) => {
    updaterState.status = "App is up to date.";
    updaterState.error = null;
    updaterState.progress = null;
    updaterState.updateAvailable = false;
    updaterState.updateDownloaded = false;
    sendToAllWindows("update-not-available", info);
  });

  autoUpdater.on("error", (error) => {
    const payload = { message: error?.message || "Update check failed" };
    updaterState.status = `Error: ${payload.message}`;
    updaterState.error = payload.message;
    updaterState.progress = null;
    updaterState.updateAvailable = false;
    updaterState.updateDownloaded = false;
    sendToAllWindows("update-error", payload);
  });

  autoUpdater.on("download-progress", (progress) => {
    updaterState.status = "Downloading update...";
    updaterState.progress = progress;
    updaterState.error = null;
    updaterState.updateAvailable = true;
    sendToAllWindows("download-progress", progress);
  });

  autoUpdater.on("update-downloaded", (info) => {
    updaterState.status = "Update ready to install.";
    updaterState.progress = null;
    updaterState.error = null;
    updaterState.updateAvailable = true;
    updaterState.updateDownloaded = true;
    sendToAllWindows("update-downloaded", info);
  });
}

async function checkForUpdates() {
  refreshUpdaterSupportState();
  if (!updaterState.isSupported) {
    return;
  }

  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    const payload = { message: error?.message || "Update check failed" };
    updaterState.status = `Error: ${payload.message}`;
    updaterState.error = payload.message;
    updaterState.progress = null;
    updaterState.updateAvailable = false;
    updaterState.updateDownloaded = false;
    sendToAllWindows("update-error", payload);
  }
}

function registerProtocols() {
  protocol.handle('img', (request) => {
    let filePath = request.url.slice('img://'.length);
    // decode URI component to handle spaces and special chars
    filePath = decodeURIComponent(filePath);
    return net.fetch(pathToFileURL(filePath).href);
  });
}

async function bootstrap() {
  registerProtocols();
  ensureDirs();
  setupAutoUpdater();
  loadConfig();
  state.dependencyStatus = collectDependencyStatus();
  readActiveState();
  refreshLibrary();

  if (!state.currentSourcePath && state.config.lastAppliedPath && fs.existsSync(state.config.lastAppliedPath)) {
    state.currentSourcePath = state.config.lastAppliedPath;
    state.lastAppliedAt = state.config.lastAppliedAt;
  }

  if (state.config.autoRotate && state.dependencyStatus?.ready && state.library.length > 0 && state.lastAppliedAt) {
    const intervalMs = state.config.intervalMinutes * 60 * 1000;
    const elapsed = Date.now() - state.lastAppliedAt;
    const missedRotations = Math.floor(elapsed / intervalMs);

    if (missedRotations > 0) {
      const originalTime = state.lastAppliedAt;
      const correctedTime = originalTime + (missedRotations * intervalMs);

      try {
        const target = state.config.rotationMode === "sequential"
          ? getSequentialTarget(missedRotations)
          : getShuffleTarget();

        await applyWallpaperFromPath(target.path, "auto-rotate (catch-up)");

        state.lastAppliedAt = correctedTime;
        state.config.lastAppliedAt = correctedTime;
        persistConfig();

        const activeState = loadJsonFile(ACTIVE_STATE_PATH, {});
        activeState.appliedAt = correctedTime;
        writeActiveState(activeState);
      } catch (e) {
        state.lastError = e.message;
      }
    }
  }

  createWindow();
  syncRotationTimer();

  if (updaterState.isSupported) {
    setTimeout(() => {
      void checkForUpdates();
    }, 3000);
  }
}

app.whenReady().then(bootstrap);

app.on("window-all-closed", () => {
  stopRotationTimer();
  app.quit();
});

ipcMain.handle("get-app-state", async () => {
  state.dependencyStatus = collectDependencyStatus();
  refreshLibrary();
  syncRotationTimer();
  return buildAppState();
});

ipcMain.handle("refresh-state", async () => {
  state.dependencyStatus = collectDependencyStatus();
  refreshLibrary();
  syncRotationTimer();
  return buildAppState();
});

ipcMain.handle("choose-wallpaper-dir", async () => {
  const window = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(window, {
    title: "Choose Wallpaper Folder",
    defaultPath: state.config.wallpaperDir,
    properties: ["openDirectory"],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  state.config.wallpaperDir = path.resolve(result.filePaths[0]);
  persistConfig();
  refreshLibrary();
  syncRotationTimer();
  return buildAppState();
});

ipcMain.handle("update-settings", async (_event, updates) => {
  state.config = normalizeConfig({
    ...state.config,
    ...(isObject(updates) ? updates : {}),
  });
  persistConfig();
  refreshLibrary();
  syncRotationTimer();
  return buildAppState();
});

ipcMain.handle("apply-wallpaper", async (_event, sourcePath) => {
  const result = await applyWallpaperFromPath(sourcePath);
  syncRotationTimer(true);
  return result;
});

ipcMain.handle("shuffle-wallpaper", async () => {
  const result = await applyRandomWallpaper();
  syncRotationTimer(true);
  return result;
});

ipcMain.handle("cycle-wallpaper", async (_event, direction) => {
  const parsedDirection = Number(direction) < 0 ? -1 : 1;
  const result = await cycleWallpaper(parsedDirection);
  syncRotationTimer(true);
  return result;
});

ipcMain.handle("window-action", async (event, action) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) {
    return { ok: false };
  }

  switch (action) {
    case "minimize":
      window.minimize();
      break;
    case "toggle-maximize":
      if (window.isMaximized()) {
        window.unmaximize();
      } else {
        window.maximize();
      }
      break;
    case "close":
      window.close();
      break;
    default:
      return { ok: false };
  }

  return { ok: true, isMaximized: window.isMaximized() };
});

ipcMain.on("check-for-updates", () => {
  void checkForUpdates();
});

ipcMain.on("restart-to-update", () => {
  if (!updaterState.isSupported || !updaterState.updateDownloaded) {
    return;
  }

  autoUpdater.quitAndInstall();
});
