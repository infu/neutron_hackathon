/**
 * Copy generated art into the frontend's public directory.
 *
 * assetgen writes under its `outDir` (`assets/generated/`), keeping each image
 * next to an `.assetgen.json` sidecar recording the prompt and provider that
 * produced it. Those sidecars are provenance, not web assets — they stay put,
 * and only the images are published.
 *
 * `frontend/public/` is copied verbatim into `dist/` by Vite and then synced to
 * the canister as certified assets, so a published file is reachable at the
 * same path the database stores.
 *
 * Logos are trimmed on the way through. Image models centre a mark inside the
 * canvas with a wide transparent margin, and that margin is baked into the
 * file — CSS cannot crop it, so a logo that should fill its box renders at
 * about a third of the intended size. Trimming to the ink is the only fix.
 *
 *   node scripts/publish-art.mjs [--dry-run]
 */

import { cp, mkdir, readdir, stat } from "node:fs/promises";
import sharp from "sharp";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FROM = join(ROOT, "assets/generated/frontend/public");
const TO = join(ROOT, "frontend/public");

const IMAGES = new Set([".png", ".webp", ".jpg", ".jpeg", ".svg", ".avif"]);

/** Directories whose images are trimmed to their opaque bounds. */
const TRIM = new Set(["logos"]);

/**
 * Drop the fully transparent margin.
 *
 * The threshold ignores the near-invisible halo these images carry — an alpha
 * of 1 in a corner would otherwise defeat the trim entirely.
 */
async function trimToInk(source, target) {
  await sharp(source)
    .ensureAlpha()
    .trim({ threshold: 12 })
    .png({ compressionLevel: 9 })
    .toFile(target);
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  try {
    await stat(FROM);
  } catch {
    console.error(
      `nothing generated yet — run \`assetgen batch assetgen.assets.yaml\` first`,
    );
    process.exit(1);
  }

  let copied = 0;
  let skipped = 0;
  for await (const source of walk(FROM)) {
    const extension = source.slice(source.lastIndexOf("."));
    if (!IMAGES.has(extension)) {
      skipped += 1;
      continue;
    }
    const target = join(TO, relative(FROM, source));
    const trim = TRIM.has(relative(FROM, source).split("/")[0]) && extension === ".png";
    console.log(
      `  ${dryRun ? "would " : ""}${trim ? "trim" : "copy"} ${relative(ROOT, target)}`,
    );
    if (!dryRun) {
      await mkdir(dirname(target), { recursive: true });
      if (trim) await trimToInk(source, target);
      else await cp(source, target);
    }
    copied += 1;
  }

  console.log(
    `\n${copied} image(s)${dryRun ? " would be" : ""} published, ` +
      `${skipped} metadata file(s) left in place.`,
  );
}

main().catch((error) => {
  console.error(`publish-art failed: ${error.message}`);
  process.exit(1);
});
