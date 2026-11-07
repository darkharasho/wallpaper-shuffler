const test = require("node:test");
const assert = require("node:assert");
const { resolveQdbus, QDBUS_CANDIDATES } = require("../lib/qdbus");

test("prefers plain qdbus when it is on PATH", () => {
  const found = resolveQdbus({ hasCommand: (c) => c === "qdbus", fileExists: () => false });
  assert.strictEqual(found, "qdbus");
});

test("falls back to qdbus-qt6 when plain qdbus is missing", () => {
  const found = resolveQdbus({ hasCommand: (c) => c === "qdbus-qt6", fileExists: () => false });
  assert.strictEqual(found, "qdbus-qt6");
});

test("falls back to the Qt6 libexec binary when nothing is on PATH", () => {
  const found = resolveQdbus({
    hasCommand: () => false,
    fileExists: (p) => p === "/usr/lib64/qt6/bin/qdbus",
  });
  assert.strictEqual(found, "/usr/lib64/qt6/bin/qdbus");
});

test("returns null when no qdbus variant exists", () => {
  assert.strictEqual(resolveQdbus({ hasCommand: () => false, fileExists: () => false }), null);
});

test("candidate list covers common distro names", () => {
  for (const name of ["qdbus", "qdbus6", "qdbus-qt6", "qdbus-qt5"]) {
    assert.ok(QDBUS_CANDIDATES.includes(name), `missing ${name}`);
  }
});
