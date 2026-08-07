#!/usr/bin/env node

import {
  checkDidc,
  checkIcp,
  checkMoc,
  checkMops,
  checkNode,
  checkNpm,
} from "./motoko-toolchain.mjs";

try {
  const versions = [
    ["node", checkNode()],
    ["npm", checkNpm()],
    ["mops", checkMops()],
    ["moc", checkMoc()],
    ["didc", checkDidc()],
    ["icp", checkIcp()],
  ];
  for (const [name, version] of versions) console.log(`${name.padEnd(6)} ${version}`);
} catch (error) {
  console.error(`toolchain check failed: ${error.message}`);
  process.exit(1);
}
