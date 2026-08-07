import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export const ROOT = resolve(import.meta.dirname, "..");

// Regions retain their independent high-water marks. The participant reserve
// policy is ~65.50 GiB; compile every production/test artifact with 80 GiB so
// the policy refuses growth before the compiler does.
export const MAX_STABLE_PAGES = "1310720";

export const PINS = Object.freeze({
  node: "24.11.1",
  npm: "11.6.2",
  mops: "1.12.0",
  moc: "0.16.3",
  didc: "0.5.3",
  icp: "1.0.2",
});

let cachedMopsVersion;
let cachedMocPath;
let cachedMocVersion;
let cachedDidcVersion;
let cachedIcpVersion;

/** Prefer a repository-local CLI while still allowing an explicitly prepared PATH. */
export function tool(name) {
  const executable = process.platform === "win32" ? `${name}.cmd` : name;
  const local = join(ROOT, "node_modules", ".bin", executable);
  return existsSync(local) ? local : name;
}

function capture(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    }).trim();
  } catch (cause) {
    const detail = cause?.stderr?.toString().trim();
    throw new Error(
      `could not run ${command} ${args.join(" ")}.` +
        `${detail ? `\n${detail}` : ""}\nInstall the pinned public toolchain from README, ` +
        "then run `npm ci && npm run deps`.",
    );
  }
}

function requireVersion(label, actual, expected) {
  if (actual !== expected) {
    throw new Error(`${label} ${expected} is required; found ${actual || "an unknown version"}`);
  }
}

export function checkNode() {
  const actual = process.versions.node;
  requireVersion("Node", actual, PINS.node);
  return actual;
}

export function checkNpm() {
  const actual = capture(tool("npm"), ["--version"]);
  requireVersion("npm", actual, PINS.npm);
  return actual;
}

export function checkMops() {
  if (cachedMopsVersion) return cachedMopsVersion;
  const output = capture(tool("mops"), ["--version"]);
  const actual = output.match(/CLI\s+(\d+\.\d+\.\d+)/)?.[1];
  requireVersion("Mops", actual, PINS.mops);
  cachedMopsVersion = actual;
  return cachedMopsVersion;
}

/** Resolve the moc downloaded from `[toolchain]`, without modifying shell rc files. */
export function managedMoc() {
  if (cachedMocPath) return cachedMocPath;
  checkMops();
  cachedMocPath = capture(tool("mops"), ["toolchain", "bin", "moc"], {
    env: { ...process.env, CI: "true" },
  });
  return cachedMocPath;
}

export function checkMoc() {
  if (cachedMocVersion) return cachedMocVersion;
  const output = capture(managedMoc(), ["--version"]);
  const actual = output.match(/Motoko compiler\s+(\d+\.\d+\.\d+)/)?.[1];
  requireVersion("moc", actual, PINS.moc);
  cachedMocVersion = actual;
  return cachedMocVersion;
}

export function checkDidc() {
  if (cachedDidcVersion) return cachedDidcVersion;
  const output = capture(tool("didc"), ["--version"]);
  const actual = output.match(/didc\s+(\d+\.\d+\.\d+)/)?.[1];
  requireVersion("didc", actual, PINS.didc);
  cachedDidcVersion = actual;
  return cachedDidcVersion;
}

export function checkIcp() {
  if (cachedIcpVersion) return cachedIcpVersion;
  const output = capture(tool("icp"), ["--version"]);
  const actual = output.match(/^icp\s+(\d+\.\d+\.\d+)/)?.[1];
  requireVersion("ICP CLI", actual, PINS.icp);
  cachedIcpVersion = actual;
  return cachedIcpVersion;
}

/** Turn `mops sources` output into argv without shell interpolation. */
export function mopsPackageArgs() {
  checkMops();
  const output = capture(tool("mops"), ["sources", "--no-install"]);
  const args = [];
  for (const line of output.split("\n")) {
    const match = /^--package\s+(\S+)\s+(.+?)\s*$/.exec(line);
    if (match) args.push("--package", match[1], match[2]);
  }
  // Ashroot is vendored source, not a registry dependency. Keeping it outside
  // mops.toml prevents Mops from writing this checkout's absolute path into
  // mops.lock while still giving moc the same package alias.
  args.push("--package", "ashroot", "vendor/ashroot/src");
  if (args.length === 0) {
    throw new Error("mops returned no package paths. Run `npm run deps` first.");
  }
  return args;
}

/** Hide known database-module warnings while preserving every other diagnostic. */
export function filterKnownDatabaseWarnings(output) {
  let suppress = false;
  const kept = [];
  for (const line of output.split("\n")) {
    const diagnostic = /^(.*?):\d+\.\d+-\d+\.\d+: (warning|.*error)\b/.exec(line);
    if (diagnostic) {
      suppress =
        diagnostic[2] === "warning" && diagnostic[1].startsWith("backend/.ashroot/");
    } else if (suppress && /^(Fatal error|Internal error|Error:)/.test(line)) {
      // Preserve unlocated compiler/linker failures without leaking the
      // unindented continuation lines used by these known switch warnings.
      suppress = false;
    }
    if (!suppress) kept.push(line);
  }
  return kept.join("\n");
}

export function runMoc(args, options = {}) {
  checkMoc();
  const result = spawnSync(managedMoc(), args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  const stdout = filterKnownDatabaseWarnings(result.stdout ?? "");
  const stderr = filterKnownDatabaseWarnings(result.stderr ?? "");
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`moc exited with status ${result.status}`);
}

export function runDidc(args, options = {}) {
  checkDidc();
  return execFileSync(tool("didc"), args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    ...options,
  });
}
