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
