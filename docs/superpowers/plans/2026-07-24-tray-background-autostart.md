# Tray, Close-to-Hide, and Autostart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep wallpaper rotation running after the window is closed (via a system tray + close-to-hide) and make the app reliably launch at login (hidden, rotating) through an XDG autostart entry the app manages.

**Architecture:** The existing Electron GUI process stays the single owner of the rotation `setTimeout`. We stop quitting on window-close (hide instead, gated by an `isQuitting` flag), add a `Tray` that is always created, add a `--hidden` launch mode that skips creating the window, and add an `autostart` config field the app reconciles to a `~/.config/autostart/wallpaper-shuffler.desktop` file. The rotation/timer scheduling math is unchanged.

**Tech Stack:** Electron 35 (`Tray`, `Menu`, `Notification`), Node.js `fs`/`path`, no new runtime dependencies. Tests use Node's built-in `node:test` + `node:assert` (no new dev dependency).

## Global Constraints

- Target desktop: KDE Plasma on Linux. Autostart entry goes to `~/.config/autostart/wallpaper-shuffler.desktop` (XDG). Use `process.env.HOME || app.getPath("home")` for the home dir, matching existing `CONFIG_DIR` derivation.
- No new runtime `dependencies` in `package.json`. Tests may only use Node built-ins.
- Do not change rotation scheduling logic (`syncRotationTimer`, catch-up in `bootstrap`).
- App icon path is the existing `APP_ICON_PATH` (`public/imgs/logo.png`).
- Config is persisted by `persistConfig()` which serializes all of `state.config`; every new config field must be handled by `normalizeConfig` so it survives a load/normalize round-trip.
- Autostart executable path: prefer `process.env.APPIMAGE`, else `app.getPath("exe")`. Autostart `Exec` must include the `--hidden` flag.
- All autostart file I/O and tray/notification creation must be wrapped so a failure records `state.lastError` but never crashes the app or blocks boot.

---

## File Structure

- `lib/autostart.js` — **new.** Pure/near-pure module: builds the `.desktop` entry text and reads/writes/removes the autostart file. No `electron` import (so it is unit-testable). Exports `AUTOSTART_PATH`, `buildAutostartDesktopEntry(...)`, `writeAutostartEntry(...)`, `removeAutostartEntry()`, `reconcileAutostart(...)`.
- `test/autostart.test.js` — **new.** `node:test` unit tests for `buildAutostartDesktopEntry`.
- `main.js` — **modify.** Add `Tray`/`Menu`/`Notification` imports; config defaults + normalization; `--hidden` handling; idempotent window show; tray + tray menu; close-to-hide lifecycle; autostart reconciliation on boot and on settings change.
- `index.html` — **modify.** Add "Start on login" toggle row in the rotation-rules panel.
- `renderer.js` — **modify.** Register the toggle element, reflect `config.autostart`, wire its `change` handler through `updateSettings`.
- `package.json` — **modify.** Add a `test` script running `node --test`.

---

### Task 1: Autostart module (pure builder + file I/O) with unit test

**Files:**
- Create: `lib/autostart.js`
- Test: `test/autostart.test.js`
- Modify: `package.json` (add `test` script)

**Interfaces:**
- Consumes: nothing (Node built-ins only).
- Produces:
  - `AUTOSTART_PATH: string` — absolute path to `~/.config/autostart/wallpaper-shuffler.desktop`.
  - `buildAutostartDesktopEntry({ execPath, iconPath, name }): string` — returns the full `.desktop` file text. `Exec` = `"<execPath>" --hidden`. Includes `Type=Application`, `Terminal=false`, `X-GNOME-Autostart-enabled=true`.
  - `writeAutostartEntry({ execPath, iconPath, name }): void` — `mkdir -p` the autostart dir, write the file.
  - `removeAutostartEntry(): void` — delete the file; ignore ENOENT.
  - `reconcileAutostart(enabled, opts): void` — if `enabled` write, else remove.

- [ ] **Step 1: Write the failing test**

Create `test/autostart.test.js`:

```javascript
const test = require("node:test");
const assert = require("node:assert");
const { buildAutostartDesktopEntry, AUTOSTART_PATH } = require("../lib/autostart");

test("entry includes the --hidden flag on Exec", () => {
  const entry = buildAutostartDesktopEntry({
    execPath: "/home/u/AppImages/wallpaper_shuffler.appimage",
    iconPath: "/icon.png",
    name: "Wallpaper Shuffler",
  });
  assert.match(entry, /^Exec=.*wallpaper_shuffler\.appimage.* --hidden$/m);
});

test("entry is a valid autostart application", () => {
  const entry = buildAutostartDesktopEntry({ execPath: "/x", iconPath: "/i", name: "N" });
  assert.match(entry, /^\[Desktop Entry\]$/m);
  assert.match(entry, /^Type=Application$/m);
  assert.match(entry, /^Terminal=false$/m);
  assert.match(entry, /^X-GNOME-Autostart-enabled=true$/m);
  assert.match(entry, /^Name=N$/m);
  assert.match(entry, /^Icon=\/i$/m);
});

test("AUTOSTART_PATH points at the XDG autostart entry", () => {
  assert.match(AUTOSTART_PATH, /\.config\/autostart\/wallpaper-shuffler\.desktop$/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/autostart.test.js`
Expected: FAIL — cannot find module `../lib/autostart`.

- [ ] **Step 3: Write the module**

Create `lib/autostart.js`:

```javascript
const fs = require("fs");
const path = require("path");

const HOME = process.env.HOME || require("os").homedir();
const AUTOSTART_DIR = path.join(HOME, ".config", "autostart");
const AUTOSTART_PATH = path.join(AUTOSTART_DIR, "wallpaper-shuffler.desktop");

function buildAutostartDesktopEntry({ execPath, iconPath, name }) {
  return [
    "[Desktop Entry]",
    "Type=Application",
    `Name=${name}`,
    `Icon=${iconPath}`,
    `Exec=${execPath} --hidden`,
    "Terminal=false",
    "Categories=Utility;",
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n");
}

function writeAutostartEntry(opts) {
  fs.mkdirSync(AUTOSTART_DIR, { recursive: true });
  fs.writeFileSync(AUTOSTART_PATH, buildAutostartDesktopEntry(opts));
}

function removeAutostartEntry() {
  try {
    fs.unlinkSync(AUTOSTART_PATH);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

function reconcileAutostart(enabled, opts) {
  if (enabled) {
    writeAutostartEntry(opts);
  } else {
    removeAutostartEntry();
  }
}

module.exports = {
  AUTOSTART_PATH,
  buildAutostartDesktopEntry,
  writeAutostartEntry,
  removeAutostartEntry,
  reconcileAutostart,
};
```

Note: `Exec=${execPath} --hidden` — the test's regex allows an unquoted path (no spaces in AppImage paths). Do not wrap in quotes; keep it simple and matching the test.

- [ ] **Step 4: Add the `test` script to `package.json`**

In the `"scripts"` block add:

```json
"test": "node --test test/",
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/autostart.test.js`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/autostart.js test/autostart.test.js package.json
git commit -m "feat: add autostart .desktop entry module with tests"
```

---

### Task 2: Config schema — `autostart` and `hasShownTrayHint`

**Files:**
- Modify: `main.js` (`DEFAULT_CONFIG` ~line 38, `normalizeConfig` ~line 197)

**Interfaces:**
- Consumes: nothing.
- Produces: `state.config.autostart` (boolean, default `true`) and `state.config.hasShownTrayHint` (boolean, default `false`), both surviving `normalizeConfig`.

- [ ] **Step 1: Add fields to `DEFAULT_CONFIG`**

In `main.js`, add to the `DEFAULT_CONFIG` object (after `avoidImmediateRepeats: true,`):

```javascript
  autostart: true,
  hasShownTrayHint: false,
```

- [ ] **Step 2: Normalize the new fields**

In `normalizeConfig`, add to the returned object (after the `avoidImmediateRepeats` property):

```javascript
    autostart:
      typeof raw.autostart === "boolean" ? raw.autostart : DEFAULT_CONFIG.autostart,
    hasShownTrayHint: Boolean(raw.hasShownTrayHint),
```

- [ ] **Step 3: Manual verification**

Run: `node -e "const c=require('./lib/autostart'); console.log('module ok', typeof c.reconcileAutostart)"`
Expected: prints `module ok function` (sanity that requires resolve; main.js can't run headless without electron, so config normalization is verified in the integration checklist, Task 7).

- [ ] **Step 4: Commit**

```bash
git add main.js
git commit -m "feat: add autostart and hasShownTrayHint config fields"
```

---

### Task 3: `--hidden` launch mode + idempotent window show + Tray creation

**Files:**
- Modify: `main.js` (imports line 1; `createWindow` ~761; `bootstrap` ~939)

**Interfaces:**
- Consumes: `state.config` (Task 2), `APP_ICON_PATH`.
- Produces:
  - `const startHidden: boolean` — module-level, `process.argv.includes("--hidden")`.
  - `state.tray: Tray | null` — module state field.
  - `getMainWindow(): BrowserWindow | null` — returns the first window or null.
  - `showMainWindow(): void` — creates the window if none exists, else shows + focuses it.
  - `createTray(): void` — creates `state.tray` with icon + tooltip + left-click → `showMainWindow`, and sets its context menu via `rebuildTrayMenu()` (defined in Task 5; for this task, set a minimal menu inline — Task 5 replaces it).

- [ ] **Step 1: Extend the electron import and add module state**

Change line 1 of `main.js` to include `Tray`, `Menu`, `Notification`:

```javascript
const { app, BrowserWindow, dialog, ipcMain, protocol, net, Tray, Menu, Notification } = require("electron");
```

Add the autostart module require near the other requires (after line 6):

```javascript
const autostart = require("./lib/autostart");
```

Add to the `state` object (after `lastError: null,`):

```javascript
  tray: null,
  isQuitting: false,
```

Add a module-level constant after `SHOULD_SIMULATE_UPDATES` (~line 9):

```javascript
const startHidden = process.argv.includes("--hidden");
```

- [ ] **Step 2: Add window accessors**

Add these functions just above `createWindow` (~line 761):

```javascript
function getMainWindow() {
  const windows = BrowserWindow.getAllWindows();
  return windows.length > 0 ? windows[0] : null;
}

function showMainWindow() {
  const existing = getMainWindow();
  if (existing) {
    if (existing.isMinimized()) {
      existing.restore();
    }
    existing.show();
    existing.focus();
    return;
  }
  createWindow();
}
```

- [ ] **Step 3: Add tray creation**

Add just below `createWindow` (after its closing brace, ~line 808):

```javascript
function createTray() {
  if (state.tray || !fs.existsSync(APP_ICON_PATH)) {
    return;
  }
  try {
    state.tray = new Tray(APP_ICON_PATH);
    state.tray.setToolTip("Wallpaper Shuffler");
    state.tray.on("click", () => showMainWindow());
    rebuildTrayMenu();
  } catch (error) {
    state.tray = null;
    state.lastError = error.message;
  }
}
```

Note: `rebuildTrayMenu` is defined in Task 5. To keep this task independently runnable, add a temporary stub above `createTray` now and delete it in Task 5:

```javascript
function rebuildTrayMenu() {
  if (state.tray) {
    state.tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Show Wallpaper Shuffler", click: () => showMainWindow() },
      { type: "separator" },
      { label: "Quit", click: () => { state.isQuitting = true; app.quit(); } },
    ]));
  }
}
```

- [ ] **Step 4: Wire `--hidden` and tray into `bootstrap`**

In `bootstrap()`, replace the single line `createWindow();` (~line 992) with:

```javascript
  createTray();
  if (!startHidden) {
    createWindow();
  }
```

- [ ] **Step 5: Manual verification**

Run: `npm start` — window opens, tray icon appears.
Run: `npm start -- --hidden` — NO window opens, tray icon appears; clicking the tray icon opens the window. Quit via tray.
Expected: both behaviors as described.

- [ ] **Step 6: Commit**

```bash
git add main.js
git commit -m "feat: add tray, --hidden launch mode, and window show helpers"
```

---

### Task 4: Close-to-hide lifecycle + one-time notification

**Files:**
- Modify: `main.js` (`createWindow` ~761; `window-all-closed` handler ~1004)

**Interfaces:**
- Consumes: `state.isQuitting` (Task 3), `state.config.hasShownTrayHint` (Task 2), `persistConfig`.
- Produces:
  - `maybeShowTrayHint(): void` — shows a one-time native notification and persists `hasShownTrayHint`.
  - Window `close` handler that hides instead of closing unless `state.isQuitting`.

- [ ] **Step 1: Add the one-time hint helper**

Add above `createWindow` (~line 761):

```javascript
function maybeShowTrayHint() {
  if (state.config.hasShownTrayHint || !Notification.isSupported()) {
    return;
  }
  state.config.hasShownTrayHint = true;
  persistConfig();
  new Notification({
    title: "Wallpaper Shuffler",
    body: "Still running in the tray. Right-click the tray icon to quit.",
    icon: fs.existsSync(APP_ICON_PATH) ? APP_ICON_PATH : undefined,
  }).show();
}
```

- [ ] **Step 2: Intercept window close inside `createWindow`**

Inside `createWindow`, immediately after the `const window = new BrowserWindow({...})` block and before the `if (process.env.VITE_DEV_SERVER_URL)` block, add:

```javascript
  window.on("close", (event) => {
    if (!state.isQuitting) {
      event.preventDefault();
      window.hide();
      maybeShowTrayHint();
    }
  });
```

- [ ] **Step 3: Stop quitting on window-all-closed**

Replace the existing handler (~line 1004):

```javascript
app.on("window-all-closed", () => {
  stopRotationTimer();
  app.quit();
});
```

with:

```javascript
app.on("window-all-closed", () => {
  // Do not quit: the tray keeps the app (and rotation timer) alive.
  // Real exit happens only via the tray "Quit" action (which sets isQuitting).
});

app.on("before-quit", () => {
  state.isQuitting = true;
  stopRotationTimer();
});
```

Rationale: `before-quit` centralizes teardown so any quit path (tray, `app.quit()`, signal) stops the timer and lets the intercepted `close` fall through.

- [ ] **Step 4: Manual verification**

Run: `npm start`. Click the custom close button (or window close). Expected: window disappears, app still running (tray present), a notification appears the FIRST time only. Reopen from tray, close again → no second notification. Tray → Quit exits fully.
Verify persistence: `grep hasShownTrayHint ~/.config/wallpaper-shuffler/config.json` → `true`.

- [ ] **Step 5: Commit**

```bash
git add main.js
git commit -m "feat: hide window to tray on close with one-time hint"
```

---

### Task 5: Full tray menu (Show / Shuffle now / Pause·Resume / Start on login / Quit)

**Files:**
- Modify: `main.js` (replace the Task 3 `rebuildTrayMenu` stub; add tray action helpers)

**Interfaces:**
- Consumes: `showMainWindow` (Task 3), `applyRandomWallpaper`, `syncRotationTimer`, `broadcastStateUpdate`, `persistConfig`, `state.config.autoRotate`, `state.config.autostart`, `setAutostart` (Task 6 provides the file side-effect; for this task call a local `applyAutostartSetting(enabled)` helper defined here that Task 6 also reuses).
- Produces:
  - `shuffleFromTray(): Promise<void>`
  - `toggleRotationFromTray(): void`
  - `rebuildTrayMenu(): void` (full version)

- [ ] **Step 1: Add tray action helpers**

Add above the `rebuildTrayMenu` stub:

```javascript
async function shuffleFromTray() {
  if (state.isApplying) {
    return;
  }
  try {
    await applyRandomWallpaper();
    syncRotationTimer(true);
  } catch (error) {
    state.lastError = error.message;
  } finally {
    broadcastStateUpdate();
    rebuildTrayMenu();
  }
}

function toggleRotationFromTray() {
  state.config.autoRotate = !state.config.autoRotate;
  persistConfig();
  syncRotationTimer(state.config.autoRotate);
  broadcastStateUpdate();
  rebuildTrayMenu();
}
```

- [ ] **Step 2: Replace the `rebuildTrayMenu` stub with the full menu**

Delete the temporary stub from Task 3 and replace with:

```javascript
function rebuildTrayMenu() {
  if (!state.tray) {
    return;
  }
  const menu = Menu.buildFromTemplate([
    { label: "Show Wallpaper Shuffler", click: () => showMainWindow() },
    { label: "Shuffle now", click: () => { void shuffleFromTray(); } },
    {
      label: state.config.autoRotate ? "Pause rotation" : "Resume rotation",
      click: () => toggleRotationFromTray(),
    },
    { type: "separator" },
    {
      label: "Start on login",
      type: "checkbox",
      checked: Boolean(state.config.autostart),
      click: (item) => {
        state.config.autostart = item.checked;
        applyAutostartSetting(item.checked);
        persistConfig();
        broadcastStateUpdate();
        rebuildTrayMenu();
      },
    },
    { type: "separator" },
    { label: "Quit", click: () => { state.isQuitting = true; app.quit(); } },
  ]);
  state.tray.setContextMenu(menu);
}
```

- [ ] **Step 3: Add the `applyAutostartSetting` helper (shared with Task 6)**

Add above `rebuildTrayMenu`:

```javascript
function currentExecutablePath() {
  return process.env.APPIMAGE || app.getPath("exe");
}

function applyAutostartSetting(enabled) {
  try {
    autostart.reconcileAutostart(enabled, {
      execPath: currentExecutablePath(),
      iconPath: APP_ICON_PATH,
      name: "Wallpaper Shuffler",
    });
  } catch (error) {
    state.lastError = error.message;
  }
}
```

- [ ] **Step 4: Keep the tray menu fresh after rotation**

In the rotation timer callback (`syncRotationTimer`, in its `finally { broadcastStateUpdate(); }`, ~line 692), add a `rebuildTrayMenu();` call right after `broadcastStateUpdate();` so the Pause/Resume label stays correct after an auto-rotation. (Only that one line added.)

- [ ] **Step 5: Manual verification**

Run: `npm start`. Right-click tray → verify all items. "Shuffle now" changes wallpaper. "Pause rotation" flips to "Resume rotation" and the in-app Auto-rotate toggle reflects it (via broadcastStateUpdate). "Start on login" checkbox toggles the file (verify `ls ~/.config/autostart/wallpaper-shuffler.desktop`).

- [ ] **Step 6: Commit**

```bash
git add main.js
git commit -m "feat: full tray menu with shuffle, pause/resume, start-on-login"
```

---

### Task 6: Autostart reconciliation on boot + settings-change wiring

**Files:**
- Modify: `main.js` (`bootstrap` ~939; `update-settings` IPC handler ~1042)

**Interfaces:**
- Consumes: `applyAutostartSetting` (Task 5), `state.config.autostart`.
- Produces: on-disk autostart entry always matches `state.config.autostart`.

- [ ] **Step 1: Reconcile on boot**

In `bootstrap()`, immediately after `loadConfig();` (~line 943), add:

```javascript
  applyAutostartSetting(state.config.autostart);
```

This writes the entry on first run (default `true`) and self-heals if it was deleted externally.

- [ ] **Step 2: Reconcile when settings change from the UI**

In the `update-settings` IPC handler (~line 1042), after `state.config = normalizeConfig({...})` and before/around `persistConfig()`, detect an autostart change and apply it. Replace the handler body's assignment+persist region with:

```javascript
  const previousAutostart = state.config.autostart;
  state.config = normalizeConfig({
    ...state.config,
    ...rawUpdates,
  });
  if (state.config.autostart !== previousAutostart) {
    applyAutostartSetting(state.config.autostart);
  }
  persistConfig();
  refreshLibrary();
  syncRotationTimer(shouldResetRotationDelay);
  rebuildTrayMenu();
  return buildAppState();
```

(Only additions: the `previousAutostart` capture, the `if` reconcile, and `rebuildTrayMenu();` so the tray's Pause/Resume + checkbox reflect UI changes.)

- [ ] **Step 3: Manual verification**

Run: `rm -f ~/.config/wallpaper-shuffler/config.json` then `npm start`. Expected: `~/.config/autostart/wallpaper-shuffler.desktop` created (default-on), containing `--hidden`.
Toggle "Start on login" off in the UI (Task 7) → file removed. On → file recreated.

- [ ] **Step 4: Commit**

```bash
git add main.js
git commit -m "feat: reconcile autostart entry on boot and settings change"
```

---

### Task 7: "Start on login" UI toggle

**Files:**
- Modify: `index.html` (~line 126, rotation-rules panel), `renderer.js` (elements ~line 10, render ~245, handlers ~442)

**Interfaces:**
- Consumes: `config.autostart` from app state, `window.api.updateSettings`.
- Produces: a checkbox `#start-on-login` reflecting and updating `config.autostart`.

- [ ] **Step 1: Add the toggle to `index.html`**

After the `avoid-repeats` toggle-row `</label>` (~line 126), before the closing `</section>`, add:

```html
          <label class="toggle-row" for="start-on-login">
            <span>
              <strong>Start on login</strong>
              <small>Launch hidden in the tray at login and keep rotating.</small>
            </span>
            <input id="start-on-login" type="checkbox">
          </label>
```

- [ ] **Step 2: Register the element in `renderer.js`**

In the `elements` object (near `autoRotate: document.getElementById("auto-rotate"),`, ~line 10), add:

```javascript
  startOnLogin: document.getElementById("start-on-login"),
```

- [ ] **Step 3: Reflect state on render**

Near `elements.autoRotate.checked = appState.config.autoRotate;` (~line 245), add:

```javascript
  elements.startOnLogin.checked = Boolean(appState.config.autostart);
```

- [ ] **Step 4: Wire the change handler**

Near the `elements.autoRotate.addEventListener("change", ...)` block (~line 442), add:

```javascript
elements.startOnLogin.addEventListener("change", async (event) => {
  await updateSettings(
    { autostart: event.target.checked },
    event.target.checked ? "Start on login enabled." : "Start on login disabled."
  );
});
```

- [ ] **Step 5: Manual verification (full integration checklist)**

Run: `npm start`.
1. Settings shows "Start on login", checked by default. Uncheck → `~/.config/autostart/wallpaper-shuffler.desktop` disappears; toast "Start on login disabled." Re-check → file returns.
2. Close window → hides to tray + one-time notification. App still running.
3. Set Frequency to 1 minute, ensure Auto-rotate on, close window, wait ~70s → wallpaper changes (rotation survives window close).
4. Tray → Pause rotation → reopen window → Auto-rotate shows off. Resume from tray → on.
5. `npm start -- --hidden` → no window, tray present, rotation active.
6. Tray → Quit → process exits.

- [ ] **Step 6: Commit**

```bash
git add index.html renderer.js
git commit -m "feat: add Start on login toggle to settings UI"
```

---

## Self-Review

**Spec coverage:**
- Close-to-hide + isQuitting → Task 4. ✓
- One-time notification (`hasShownTrayHint`) → Task 2 (field) + Task 4 (behavior). ✓
- Tray + menu (Show / Shuffle now / Pause·Resume / Start on login / Quit) → Task 3 (tray) + Task 5 (menu). ✓
- Pause/Resume via `config.autoRotate` single source of truth → Task 5 `toggleRotationFromTray`. ✓
- `autostart` config field default true → Task 2. ✓
- Autostart entry write/remove + `--hidden` in Exec → Task 1. ✓
- Reconcile on boot + on settings change → Task 6. ✓
- `--hidden` skips window, keeps tray + timer → Task 3. ✓
- UI toggle → Task 7. ✓
- Graceful error handling (try/catch, Notification.isSupported, tray guard) → Tasks 1/3/4/5. ✓
- No change to rotation math → confirmed; only additive `rebuildTrayMenu()` line in the timer callback (Task 5 Step 4). ✓

**Type/name consistency:** `rebuildTrayMenu` (stub in Task 3, full in Task 5), `showMainWindow`, `applyAutostartSetting` (defined Task 5, used Task 6), `currentExecutablePath`, `state.isQuitting`, `state.tray`, `startHidden`, `state.config.autostart`, `state.config.hasShownTrayHint`, `autostart.reconcileAutostart` — all consistent across tasks.

**Placeholder scan:** none — the Task 3 stub is explicitly temporary and removed in Task 5.
</content>
