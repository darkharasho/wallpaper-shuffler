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
