// Distros ship qdbus under different names. Newer Fedora/Bazzite releases dropped
// the plain `qdbus` alias and only provide `qdbus-qt6` (plus the unprefixed binary
// inside Qt's own bin dir, which is not on PATH).
const QDBUS_CANDIDATES = ["qdbus", "qdbus6", "qdbus-qt6", "qdbus-qt5"];

const QDBUS_PATHS = [
  "/usr/lib64/qt6/bin/qdbus",
  "/usr/lib/qt6/bin/qdbus",
  "/usr/lib/x86_64-linux-gnu/qt6/bin/qdbus",
  "/usr/lib64/qt5/bin/qdbus",
  "/usr/lib/qt5/bin/qdbus",
  "/usr/lib/x86_64-linux-gnu/qt5/bin/qdbus",
];

function resolveQdbus({ hasCommand, fileExists }) {
  for (const name of QDBUS_CANDIDATES) {
    if (hasCommand(name)) {
      return name;
    }
  }
  for (const filePath of QDBUS_PATHS) {
    if (fileExists(filePath)) {
      return filePath;
    }
  }
  return null;
}

module.exports = { resolveQdbus, QDBUS_CANDIDATES, QDBUS_PATHS };
