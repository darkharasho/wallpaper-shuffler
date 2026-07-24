const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
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

test("writeAutostartEntry / removeAutostartEntry / reconcileAutostart touch a real file in a temp HOME", () => {
  const originalHome = process.env.HOME;
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "wshuf-"));
  process.env.HOME = tempHome;
  delete require.cache[require.resolve("../lib/autostart")];
  const scopedAutostart = require("../lib/autostart");

  try {
    assert.match(scopedAutostart.AUTOSTART_PATH, new RegExp(`^${tempHome}`));
    assert.ok(!fs.existsSync(scopedAutostart.AUTOSTART_PATH));

    scopedAutostart.writeAutostartEntry({
      execPath: "/opt/wallpaper-shuffler/wallpaper-shuffler",
      iconPath: "/opt/wallpaper-shuffler/icon.png",
      name: "Wallpaper Shuffler",
    });

    assert.ok(fs.existsSync(scopedAutostart.AUTOSTART_PATH));
    const written = fs.readFileSync(scopedAutostart.AUTOSTART_PATH, "utf-8");
    assert.match(written, /^\[Desktop Entry\]$/m);
    assert.match(written, /^Exec=\/opt\/wallpaper-shuffler\/wallpaper-shuffler --hidden$/m);

    scopedAutostart.removeAutostartEntry();
    assert.ok(!fs.existsSync(scopedAutostart.AUTOSTART_PATH));

    // Removing again should be a no-op (ENOENT swallowed), not throw.
    assert.doesNotThrow(() => scopedAutostart.removeAutostartEntry());

    scopedAutostart.reconcileAutostart(true, {
      execPath: "/opt/wallpaper-shuffler/wallpaper-shuffler",
      iconPath: "/opt/wallpaper-shuffler/icon.png",
      name: "Wallpaper Shuffler",
    });
    assert.ok(fs.existsSync(scopedAutostart.AUTOSTART_PATH));

    scopedAutostart.reconcileAutostart(false, {
      execPath: "/opt/wallpaper-shuffler/wallpaper-shuffler",
      iconPath: "/opt/wallpaper-shuffler/icon.png",
      name: "Wallpaper Shuffler",
    });
    assert.ok(!fs.existsSync(scopedAutostart.AUTOSTART_PATH));
  } finally {
    process.env.HOME = originalHome;
    delete require.cache[require.resolve("../lib/autostart")];
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});
