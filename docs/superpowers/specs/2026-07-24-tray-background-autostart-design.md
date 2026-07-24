# Tray, Close-to-Hide, and Autostart — Design

**Date:** 2026-07-24
**Status:** Approved (pending spec review)

## Problem

Two intermittent user-reported failures, both rooted in the same architectural gap: the app has no background/persistent mode and no autostart entry.

1. **"Never shuffles."** Rotation is a `setTimeout` owned by the Electron main process (`syncRotationTimer`, `main.js:681`). Closing the window triggers `window-all-closed` → `stopRotationTimer()` + `app.quit()` (`main.js:1004`), which destroys the timer and exits the process. There is no tray icon. So the app rotates wallpapers only while its window is open; closing it stops all shuffling. It still *sets* a wallpaper once at launch via the bootstrap "catch-up" path (`main.js:954`), which is why the wallpaper appears but never changes.

2. **"Doesn't start on startup."** No autostart entry exists (`~/.config/autostart/` has none), and the app has no code to create one. The only `.desktop` file is an app-menu launcher. "Sometimes it starts" is KDE Plasma session restore relaunching apps that were open at logout — inherently unreliable.

## Goals

- The rotation timer survives closing the window; the app keeps running in the tray.
- The app can reliably launch at login, hidden to the tray, and keep rotating.
- User controls both behaviors from the UI and the tray.

## Non-Goals

- No separate headless daemon. The existing GUI process stays the single owner of rotation.
- No cross-desktop autostart abstraction beyond Linux/KDE (the app is KDE-Plasma-specific already).
- No change to the rotation/timer scheduling logic itself.

## Design

### 1. Lifecycle: close-to-hide + tray

- **Add a `Tray`** (Electron `Tray`), created in `bootstrap()` after the window, using `APP_ICON_PATH`.
- **Introduce an explicit-quit flag**, `state.isQuitting` (default `false`). Only a real quit (tray "Quit", or `app.quit()` we call ourselves) sets it `true`.
- **Window close → hide, not destroy.** In `createWindow()`, intercept the window's `close` event: if `!state.isQuitting`, `event.preventDefault()` and `window.hide()`. The custom title-bar close button (`renderer.js:515` → `window-action "close"`) already calls `window.close()`, so routing all close through the window `close` event covers both the OS chrome and the custom button. No renderer change needed.
- **`window-all-closed` no longer quits.** Because the window is hidden (not closed) on close, `window-all-closed` normally won't fire. Keep a guarded handler: if `state.isQuitting` is false, do nothing (keep running); this also avoids quitting if the window is ever genuinely closed. The rotation timer is left running.
- **First-hide notification (one-time).** The first time the window hides to tray, show a native `Notification` ("Wallpaper Shuffler is still running in the tray. Right-click the tray icon to quit."). Persist a `hasShownTrayHint: true` flag in `config.json` so it shows only once, ever.
- **Show/restore.** Clicking the tray icon (left click / `click` event) shows and focuses the window (creating it if it was never created in `--hidden` mode). The `activate`/second-instance path also shows the window.

### 2. Tray menu

Built via `Menu.buildFromTemplate`, rebuilt when state that it reflects changes (rotation paused/resumed, autostart toggled):

- **Show Wallpaper Shuffler** — show + focus the window.
- **Shuffle now** — `applyRandomWallpaper()` then `syncRotationTimer(true)` + `broadcastStateUpdate()`. Reuses the exact logic behind the `shuffle-wallpaper` IPC handler.
- **Pause rotation / Resume rotation** — toggles rotation on/off; label reflects current state (see "Pause/Resume semantics" below).
- *(separator)*
- **Start on login** — checkbox; mirrors `config.autostart`. Toggling writes/removes the autostart entry and persists config.
- **Quit** — sets `state.isQuitting = true`, then `app.quit()`.

**Pause/Resume semantics.** "Rotation active" is exactly `config.autoRotate`. Pause sets `autoRotate = false`; Resume sets `autoRotate = true`. Both persist config and call `syncRotationTimer()`, and rebuild the tray menu + `broadcastStateUpdate()` so the open window's UI stays in sync. This deliberately reuses the existing single source of truth (`config.autoRotate`) rather than adding a second paused-flag that could drift.

### 3. Autostart toggle

- **New config field:** `autostart` (boolean, default `true`).
- **Autostart entry location:** `~/.config/autostart/wallpaper-shuffler.desktop` (XDG autostart; KDE honors it).
- **Entry contents:** `Exec` launches the same executable as the running app, hidden:
  - When packaged (AppImage), use `process.env.APPIMAGE` if set, else `app.getPath("exe")`.
  - Append the `--hidden` flag.
  - Include `X-GNOME-Autostart-enabled=true`, `Terminal=false`, `Type=Application`, `Name`, `Icon` (reuse `APP_ICON_PATH`).
- **Enable:** write the file (via a `buildAutostartDesktopEntry()` helper), `ensureDirs`-style `mkdir -p ~/.config/autostart`.
- **Disable:** delete the file if present (ignore ENOENT).
- **Reconciliation on boot:** in `bootstrap()`, after `loadConfig()`, reconcile the on-disk autostart entry to match `config.autostart` (write if enabled & missing, remove if disabled & present). This self-heals if the file was removed externally and makes the default-on behavior take effect on first run.
- **First-run default-on:** because `DEFAULT_CONFIG.autostart = true`, a fresh install writes the autostart entry on first boot. Existing configs without the field also default to `true` via `normalizeConfig`.

### 4. `--hidden` startup flag

- Parse `process.argv.includes("--hidden")` once at startup into `const startHidden`.
- In `bootstrap()`: run all existing bootstrap logic (config, deps, library, catch-up, restore, `syncRotationTimer`) **unchanged**, but only call `createWindow()` when `!startHidden`. The tray is always created so the app is reachable.
- When hidden, the rotation timer and catch-up still run (they don't depend on a window; `broadcastStateUpdate` already no-ops when there are no windows).
- Showing the window later (tray click) calls `createWindow()` if none exists, else shows the existing one.

### 5. Config / normalization changes

`DEFAULT_CONFIG` gains:
- `autostart: true`
- `hasShownTrayHint: false`

`normalizeConfig` coerces both with `Boolean(...)` / default fallbacks, mirroring existing `autoRotate` handling. `persistConfig` already serializes the whole `state.config`, so no serialization change needed.

## Data Flow

```
Login (autostart .desktop, --hidden)
  → app.whenReady → bootstrap()
      loadConfig → reconcile autostart entry
      deps/library/catch-up/restore  (sets wallpaper if rotations were missed)
      createTray()                    (always)
      if !startHidden: createWindow()
      syncRotationTimer()             (timer runs regardless of window)
  → 30-min timer fires → applyRotationSelection → reschedule   (now survives, no window needed)

User closes window
  → window 'close' event → isQuitting? no → preventDefault + hide + (one-time) notify
  → app keeps running, timer intact

Tray → Quit
  → isQuitting = true → app.quit → window-all-closed allowed → stopRotationTimer
```

## Error Handling

- Autostart file write/delete wrapped in try/catch; failures set `state.lastError` and are surfaced in app state but never crash the app or block boot.
- `Notification` guarded by `Notification.isSupported()`.
- Tray creation guarded; if it throws (missing icon / no tray support), log to `state.lastError` and continue with window-based behavior (degrade gracefully rather than crash).

## Testing

Electron main-process lifecycle and KDE integration are hard to unit-test end-to-end, so testing targets the pure/extractable logic plus manual verification of the wiring:

- **Unit (pure functions):**
  - `buildAutostartDesktopEntry(execPath)` produces a valid entry containing `--hidden`, correct `Exec`, `Type=Application`.
  - `normalizeConfig` defaults `autostart` to `true` and `hasShownTrayHint` to `false`, and coerces bad values.
- **Manual verification checklist (documented in the PR):**
  1. Enable autostart in UI → `~/.config/autostart/wallpaper-shuffler.desktop` exists with `--hidden`.
  2. Close window → app stays running (visible in tray), notification shown once.
  3. Wait one interval (use a short interval, e.g. 1 min) with window closed → wallpaper changes.
  4. Tray → Quit → process exits, timer stops.
  5. Launch with `--hidden` → no window, tray present, rotation active.
  6. Disable autostart → entry file removed.

## Files Touched

- `main.js` — tray, lifecycle, autostart helpers, `--hidden`, config defaults, reconciliation, tray-driven actions.
- `preload.js` / `renderer.js` / `index.html` / `style.css` — add the "Start on login" toggle to Settings and wire an `update-settings`-style path for `autostart` (the existing `update-settings` IPC already merges arbitrary config keys, so this is mostly a UI control + reflecting `config.autostart` in state).
- No changes to rotation/timer scheduling math.
</content>
</invoke>
