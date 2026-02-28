#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const allowedBumps = new Set(["patch", "minor", "major"]);

const readArgValue = (flag) => {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  return args[index + 1] || null;
};

const readBumpArg = () => {
  if (args.length === 0) return null;
  const bumpIndex = args.findIndex((arg) => arg === "--bump");
  if (bumpIndex >= 0 && args[bumpIndex + 1]) return args[bumpIndex + 1];
  const direct = args.find((arg) => allowedBumps.has(arg));
  return direct || null;
};

const run = (command, commandArgs, options = {}) => {
  const result = spawnSync(command, commandArgs, { stdio: "inherit", ...options });
  if (result.status !== 0) {
    const error = new Error(`Command failed: ${command} ${commandArgs.join(" ")}`);
    error.exitCode = result.status ?? 1;
    throw error;
  }
};

const runAndCapture = (command, commandArgs, options = {}) => {
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });

  if (result.status !== 0) {
    const error = new Error(`Command failed: ${command} ${commandArgs.join(" ")}`);
    error.exitCode = result.status ?? 1;
    throw error;
  }

  return (result.stdout || "").trim();
};

const bumpVersion = (current, type) => {
  const match = current.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    throw new Error(`Unsupported version format: ${current}`);
  }

  let major = Number(match[1]);
  let minor = Number(match[2]);
  let patch = Number(match[3]);

  if (type === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (type === "minor") {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }

  return `${major}.${minor}.${patch}`;
};

const updateLockfileVersion = (version, packageLockPath) => {
  if (!fs.existsSync(packageLockPath)) return;

  const packageLock = JSON.parse(fs.readFileSync(packageLockPath, "utf8"));
  packageLock.version = version;
  if (packageLock.packages && packageLock.packages[""]) {
    packageLock.packages[""].version = version;
  }
  fs.writeFileSync(packageLockPath, `${JSON.stringify(packageLock, null, 2)}\n`);
};

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const gitCmd = process.platform === "win32" ? "git.exe" : "git";
const bumpType = readBumpArg();
const releaseOwner = readArgValue("--release-owner");
const releaseRepo = readArgValue("--release-repo");
const packagePath = path.resolve("package.json");
const packageLockPath = path.resolve("package-lock.json");
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const currentBranch = runAndCapture(gitCmd, ["rev-parse", "--abbrev-ref", "HEAD"]);

try {
  if (bumpType) {
    if (!allowedBumps.has(bumpType)) {
      console.error(`Invalid bump type: ${bumpType}. Use patch, minor, or major.`);
      process.exit(1);
    }

    const currentVersion = String(packageJson.version || "").trim();
    if (!currentVersion) {
      console.error("package.json is missing a version.");
      process.exit(1);
    }

    const nextVersion = bumpVersion(currentVersion, bumpType);
    packageJson.version = nextVersion;
    fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
    updateLockfileVersion(nextVersion, packageLockPath);

    if (fs.existsSync(packageLockPath)) {
      run(gitCmd, ["add", "package.json", "package-lock.json"]);
    } else {
      run(gitCmd, ["add", "package.json"]);
    }
    run(gitCmd, ["commit", "-m", `chore: bump version to ${nextVersion}`]);
    run(gitCmd, ["push", "origin", currentBranch]);
  }

  run(npmCmd, ["run", "build"]);
  run(process.execPath, ["scripts/run-electron-builder.mjs"]);

  const releaseArgs = ["scripts/update-github-release.mjs"];
  if (releaseOwner) releaseArgs.push("--release-owner", releaseOwner);
  if (releaseRepo) releaseArgs.push("--release-repo", releaseRepo);
  run(process.execPath, releaseArgs);
} catch (error) {
  process.exit(error?.exitCode ?? 1);
}
