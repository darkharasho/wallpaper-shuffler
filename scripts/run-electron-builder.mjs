#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const rootDir = process.cwd();

const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8");
  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) return;
    const key = match[1];
    let value = match[2] ?? "";
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  });
};

loadEnvFile(path.join(rootDir, ".env"));

const requestedAll = process.argv.includes("--all");
const platformTargets = [];

if (requestedAll) {
  platformTargets.push("--linux", "--win");
} else if (process.platform === "win32") {
  platformTargets.push("--win");
} else if (process.platform === "darwin") {
  platformTargets.push("--mac");
} else {
  platformTargets.push("--linux");
}

const args = ["electron-builder", ...platformTargets, "--publish", "never"];
const result = spawnSync("npx", args, { stdio: "inherit", env: process.env });

process.exit(result.status ?? 1);
