const elements = {
  windowMinimize: document.getElementById("window-minimize"),
  windowMaximize: document.getElementById("window-maximize"),
  windowClose: document.getElementById("window-close"),
  browseButton: document.getElementById("browse-btn"),
  refreshButton: document.getElementById("refresh-btn"),
  shuffleButton: document.getElementById("shuffle-btn"),
  previousButton: document.getElementById("prev-btn"),
  nextButton: document.getElementById("next-btn"),
  autoRotate: document.getElementById("auto-rotate"),
  frequencyRange: document.getElementById("frequency-range"),
  frequencyInput: document.getElementById("frequency-input"),
  frequencyValue: document.getElementById("frequency-value"),
  rotationMode: document.getElementById("rotation-mode"),
  sortMode: document.getElementById("sort-mode"),
  avoidRepeats: document.getElementById("avoid-repeats"),
  folderPath: document.getElementById("folder-path"),
  statsGrid: document.getElementById("stats-grid"),
  dependencyNote: document.getElementById("dependency-note"),
  currentPreview: document.getElementById("current-preview"),
  currentName: document.getElementById("current-name"),
  currentMeta: document.getElementById("current-meta"),
  searchInput: document.getElementById("search-input"),
  grid: document.getElementById("grid"),
  status: document.getElementById("status"),
};

const state = {
  appState: null,
  filterText: "",
  busy: false,
  statusTimer: null,
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const rounded = value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1);
  return `${rounded} ${units[unitIndex]}`;
}

function formatMinutes(minutes) {
  const total = Number.parseInt(minutes, 10);
  if (!Number.isFinite(total) || total < 1) {
    return "1 minute";
  }

  if (total < 60) {
    return `${total} minute${total === 1 ? "" : "s"}`;
  }

  const hours = total / 60;
  const rounded = Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
  return `${rounded} hour${hours === 1 ? "" : "s"}`;
}

function formatTimestamp(timestamp) {
  if (!Number.isFinite(timestamp)) {
    return "Never";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function showStatus(message, type = "info") {
  if (state.statusTimer) {
    clearTimeout(state.statusTimer);
  }

  elements.status.textContent = message;
  elements.status.className = `status ${type}`;
  state.statusTimer = setTimeout(() => {
    elements.status.className = "status hidden";
  }, 4200);
}

function setBusy(isBusy, label) {
  state.busy = isBusy;
  const disabled = isBusy || !state.appState;
  elements.browseButton.disabled = disabled;
  elements.refreshButton.disabled = disabled;
  elements.shuffleButton.disabled = disabled;
  elements.previousButton.disabled = disabled;
  elements.nextButton.disabled = disabled;

  elements.shuffleButton.textContent = isBusy && label ? label : "Shuffle Now";
}

function getFilteredLibrary() {
  const library = state.appState?.library || [];
  if (!state.filterText.trim()) {
    return library;
  }

  const query = state.filterText.trim().toLowerCase();
  return library.filter((item) => item.name.toLowerCase().includes(query));
}

function renderStats() {
  const appState = state.appState;
  if (!appState) {
    elements.statsGrid.innerHTML = "";
    return;
  }

  const cards = [
    {
      label: "Images",
      value: String(appState.folderSummary.count),
      note: appState.folderSummary.count === 1 ? "1 wallpaper ready" : "Library items ready",
    },
    {
      label: "Size",
      value: formatBytes(appState.folderSummary.totalSize),
      note: "Total source folder payload",
    },
    {
      label: "Interval",
      value: formatMinutes(appState.config.intervalMinutes),
      note: appState.runtime.autoRotateActive ? "Auto-rotate armed" : "Manual until enabled",
    },
    {
      label: "Last Apply",
      value: formatTimestamp(appState.runtime.lastAppliedAt),
      note: appState.currentWallpaper ? appState.currentWallpaper.name : "No wallpaper applied",
    },
  ];

  elements.statsGrid.innerHTML = cards
    .map(
      (card) => `
        <article class="stat-card">
          <span class="stat-label">${escapeHtml(card.label)}</span>
          <strong class="stat-value">${escapeHtml(card.value)}</strong>
          <small class="stat-note">${escapeHtml(card.note)}</small>
        </article>
      `
    )
    .join("");
}

function renderDependencyState() {
  const dependencies = state.appState?.dependencies;
  if (!dependencies) {
    elements.dependencyNote.textContent = "";
    elements.dependencyNote.className = "dependency-note";
    return;
  }

  elements.dependencyNote.textContent = dependencies.message;
  elements.dependencyNote.className = dependencies.ready
    ? "dependency-note ready"
    : "dependency-note warning";
}

function renderCurrentWallpaper() {
  const current = state.appState?.currentWallpaper;
  if (!current || !current.previewUrl) {
    elements.currentPreview.className = "current-preview empty";
    elements.currentPreview.style.backgroundImage = "";
    elements.currentName.textContent = "Nothing applied yet";
    elements.currentMeta.textContent = "Pick a folder and apply a wallpaper to get started.";
    return;
  }

  const appState = state.appState;
  let timerNote = "Auto-rotate is paused";

  if (appState.runtime.autoRotateActive && appState.runtime.nextRunAt) {
    const msLeft = appState.runtime.nextRunAt - Date.now();
    if (msLeft > 0) {
      const totalSeconds = Math.floor(msLeft / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;

      if (hours > 0) {
        timerNote = `Next rotation in ${hours}h ${minutes}m`;
      } else if (minutes > 0) {
        timerNote = `Next rotation in ${minutes}m ${seconds}s`;
      } else {
        timerNote = `Next rotation in ${seconds}s`;
      }
    } else {
      timerNote = "Rotating...";
    }
  }

  elements.currentPreview.className = "current-preview";
  elements.currentPreview.style.backgroundImage = `url("${current.previewUrl}")`;
  elements.currentName.textContent = current.name;
  elements.currentMeta.textContent = `${formatBytes(current.size)} • ${timerNote}`;
}

function renderControls() {
  const appState = state.appState;
  if (!appState) {
    return;
  }

  elements.autoRotate.checked = appState.config.autoRotate;
  elements.frequencyRange.value = String(appState.config.intervalMinutes);
  elements.frequencyInput.value = String(appState.config.intervalMinutes);
  elements.frequencyValue.textContent = formatMinutes(appState.config.intervalMinutes);
  elements.rotationMode.value = appState.config.rotationMode;
  elements.sortMode.value = appState.config.sortMode;
  elements.avoidRepeats.checked = appState.config.avoidImmediateRepeats;
  elements.folderPath.textContent = appState.config.wallpaperDir;
}

function renderGrid() {
  const appState = state.appState;
  if (!appState) {
    elements.grid.innerHTML = "";
    return;
  }

  const items = getFilteredLibrary();
  if (!items.length) {
    const message = appState.library.length
      ? "No wallpapers match the current filter."
      : "No image files found in this folder yet.";
    elements.grid.innerHTML = `<div class="empty-state">${message}</div>`;
    return;
  }

  const currentPath = appState.currentWallpaper?.path || null;
  elements.grid.innerHTML = "";

  for (const item of items) {
    const button = document.createElement("button");
    button.className = `wallpaper-card${item.path === currentPath ? " active" : ""}`;
    button.type = "button";
    button.dataset.path = item.path;

    const thumb = document.createElement("span");
    thumb.className = "wallpaper-thumb";
    thumb.style.backgroundImage = `url("${item.previewUrl}")`;

    const info = document.createElement("span");
    info.className = "wallpaper-info";

    const title = document.createElement("strong");
    title.textContent = item.name;

    const meta = document.createElement("small");
    meta.textContent = `${formatBytes(item.size)} • ${formatTimestamp(item.modifiedAt)}`;

    info.append(title, meta);
    button.append(thumb, info);
    elements.grid.appendChild(button);
  }
}

function render() {
  renderControls();
  renderStats();
  renderDependencyState();
  renderCurrentWallpaper();
  renderGrid();
}

async function syncState(loader, successMessage) {
  try {
    const nextState = await loader();
    if (nextState) {
      state.appState = nextState;
      render();
      if (successMessage) {
        showStatus(successMessage, "success");
      }
    }
  } catch (error) {
    const message = error?.message || "Unexpected failure";
    showStatus(message, "error");
  }
}

async function updateSettings(patch, successMessage) {
  await syncState(() => window.api.updateSettings(patch), successMessage);
}

elements.browseButton.addEventListener("click", async () => {
  await syncState(() => window.api.chooseWallpaperDir(), "Wallpaper folder updated.");
});

elements.refreshButton.addEventListener("click", async () => {
  await syncState(() => window.api.refreshState(), "Library refreshed.");
});

elements.shuffleButton.addEventListener("click", async () => {
  if (state.busy) {
    return;
  }

  setBusy(true, "Shuffling...");
  await syncState(() => window.api.shuffleWallpaper(), "Wallpaper shuffled.");
  setBusy(false);
});

elements.previousButton.addEventListener("click", async () => {
  if (state.busy) {
    return;
  }

  setBusy(true);
  await syncState(() => window.api.cycleWallpaper(-1), "Moved to previous wallpaper.");
  setBusy(false);
});

elements.nextButton.addEventListener("click", async () => {
  if (state.busy) {
    return;
  }

  setBusy(true);
  await syncState(() => window.api.cycleWallpaper(1), "Moved to next wallpaper.");
  setBusy(false);
});

elements.autoRotate.addEventListener("change", async (event) => {
  await updateSettings({ autoRotate: event.target.checked }, event.target.checked ? "Auto-rotate enabled." : "Auto-rotate paused.");
});

function syncFrequencyDisplays(value) {
  const minutes = Math.max(1, Number.parseInt(value, 10) || 1);
  elements.frequencyRange.value = String(minutes);
  elements.frequencyInput.value = String(minutes);
  elements.frequencyValue.textContent = formatMinutes(minutes);
}

elements.frequencyRange.addEventListener("input", (event) => {
  syncFrequencyDisplays(event.target.value);
});

elements.frequencyRange.addEventListener("change", async (event) => {
  const minutes = Math.max(1, Number.parseInt(event.target.value, 10) || 1);
  syncFrequencyDisplays(minutes);
  await updateSettings({ intervalMinutes: minutes }, "Rotation frequency updated.");
});

elements.frequencyInput.addEventListener("input", (event) => {
  syncFrequencyDisplays(event.target.value);
});

elements.frequencyInput.addEventListener("change", async (event) => {
  const minutes = Math.max(1, Number.parseInt(event.target.value, 10) || 1);
  syncFrequencyDisplays(minutes);
  await updateSettings({ intervalMinutes: minutes }, "Rotation frequency updated.");
});

elements.rotationMode.addEventListener("change", async (event) => {
  await updateSettings({ rotationMode: event.target.value }, "Rotation mode updated.");
});

elements.sortMode.addEventListener("change", async (event) => {
  await updateSettings({ sortMode: event.target.value }, "Library sort updated.");
});

elements.avoidRepeats.addEventListener("change", async (event) => {
  await updateSettings({ avoidImmediateRepeats: event.target.checked }, "Shuffle repeat guard updated.");
});

elements.searchInput.addEventListener("input", (event) => {
  state.filterText = event.target.value || "";
  renderGrid();
});

elements.grid.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-path]");
  if (!button || state.busy) {
    return;
  }

  const { path } = button.dataset;
  if (!path) {
    return;
  }

  setBusy(true);
  await syncState(() => window.api.applyWallpaper(path), "Wallpaper applied.");
  setBusy(false);
});

elements.windowMinimize.addEventListener("click", async () => {
  await window.api.windowAction("minimize");
});

elements.windowMaximize.addEventListener("click", async () => {
  await window.api.windowAction("toggle-maximize");
});

elements.windowClose.addEventListener("click", async () => {
  await window.api.windowAction("close");
});

window.addEventListener("DOMContentLoaded", async () => {
  setBusy(true);
  await syncState(() => window.api.getAppState());
  setBusy(false);

  if (window.api.onStateUpdated) {
    window.api.onStateUpdated((newState) => {
      state.appState = newState;
      render();
    });
  }

  setInterval(() => {
    if (state.appState && state.appState.runtime.autoRotateActive) {
      renderCurrentWallpaper();
    }
  }, 1000);
});
