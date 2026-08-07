#!/usr/bin/env node
/**
 * Generate the favicon set from the brand mark.
 *
 * The mark is the blue square from the top bar (`.brand::before`), minus the
 * translucent ring — at 16px in a tab a ring is just a muddy edge, so the
 * icon is the solid square alone, filling the canvas.
 *
 * Writes into frontend/public, which Vite copies verbatim and the uploader
 * pushes to the canister — no external icon host, same as the fonts.
 *
 *   node scripts/make-favicon.mjs
 *
 * PNGs are written by hand (zlib + CRC32) to avoid pulling an image library
 * in for two small squares.
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "frontend/public");

const BLUE = [0x2b, 0x4e, 0xff];
const CREAM = [0xf4, 0xf5, 0xf8];

/**
 * How much of the canvas the square covers.
 *
 * Full bleed in a tab — there is nothing to gain from padding at 16px. The
 * touch icon insets slightly because iOS masks it to a squircle, and a
 * full-bleed square would lose its corners to the mask.
 */
const TAB = 1.0;
const TOUCH = 0.82;

// ── PNG ─────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size, pixel) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  // 10..12 stay zero: deflate, no filter, no interlace.

  // Each scanline is prefixed with its filter type; 0 means "none".
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = pixel(x, y, size);
      const at = row + 1 + x * 4;
      raw[at] = r;
      raw[at + 1] = g;
      raw[at + 2] = b;
      raw[at + 3] = a;
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * A centred solid square. `background` is null for a transparent tab icon,
 * or a colour for the touch icon — iOS composites those onto an opaque tile
 * regardless, so transparency there would come out black.
 */
function mark(background, coverage) {
  return (x, y, size) => {
    const side = Math.round(size * coverage);
    const lo = (size - side) / 2;
    const inside = x >= lo && x < lo + side && y >= lo && y < lo + side;
    if (inside) return [...BLUE, 255];
    return background ? [...background, 255] : [0, 0, 0, 0];
  };
}

// ── SVG ─────────────────────────────────────────────────────────────────────

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <!-- Brand mark: the solid blue square, edge to edge. -->
  <rect width="32" height="32" fill="#2b4eff"/>
</svg>
`;

mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, "favicon.svg"), svg);
writeFileSync(resolve(OUT, "favicon-32.png"), png(32, mark(null, TAB)));
writeFileSync(resolve(OUT, "apple-touch-icon.png"), png(180, mark(CREAM, TOUCH)));

console.log("wrote frontend/public/{favicon.svg,favicon-32.png,apple-touch-icon.png}");
