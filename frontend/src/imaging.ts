/**
 * Make an oversized image fit, without making the person doing it think about
 * it.
 *
 * The canister's limits are firm — 100 KB for an avatar or an app icon, 400 KB
 * for a screenshot — and a photo off a phone is twenty times that. Rejecting it
 * and saying "too big" is technically correct and useless: the person has no
 * idea what to do next, and the tool that would tell them is the one refusing.
 *
 * So an image over the limit is scaled down and re-encoded as JPEG until it
 * fits. Under the limit, nothing happens at all — a small PNG stays a small
 * PNG, transparency and all.
 *
 * ## Where it runs
 *
 * In a worker, via `OffscreenCanvas`. Decoding and re-encoding a large photo
 * takes long enough to freeze a page visibly, and it lands at the exact moment
 * somebody is watching. Where a worker or `OffscreenCanvas` is unavailable it
 * falls back to a plain canvas on the main thread — slower and briefly janky,
 * but it still produces the right file rather than an error.
 */

import type { FitReply, FitRequest } from "./imaging.worker";

/** What the canister will serve back. JPEG is in it; SVG deliberately is not. */
const PASSES_THROUGH = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
]);

export type Fitted = {
  file: File;
  /** True when the image was re-encoded, so the UI can say what happened. */
  changed: boolean;
  was: number;
};

let worker: Worker | null = null;
let nextId = 1;

function pool(): Worker | null {
  if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") return null;
  worker ??= new Worker(new URL("./imaging.worker.ts", import.meta.url), { type: "module" });
  return worker;
}

/**
 * Scale `file` until it is at most `maxBytes`, as an optimised JPEG.
 *
 * `maxEdge` bounds the longest side before quality is touched at all — a
 * 6000px screenshot is not more useful than a 1600px one on any screen this
 * will be viewed on, and scaling first costs far less quality than compressing
 * a huge image hard.
 */
export async function fitToLimit(
  file: File,
  maxBytes: number,
  maxEdge = 1600,
): Promise<Fitted> {
  if (!file.type.startsWith("image/")) {
    throw new ImageError("That is not an image.");
  }
  if (file.type === "image/svg+xml") {
    // Refused by the canister too: SVG is XML that can carry script.
    throw new ImageError("SVG cannot be used here — PNG, JPEG, WebP, GIF or AVIF.");
  }
  // Already small enough and already a type we serve: leave it exactly as it
  // is. Re-encoding a 12 KB PNG icon into a JPEG would only make it worse.
  if (file.size <= maxBytes && PASSES_THROUGH.has(file.type)) {
    return { file, changed: false, was: file.size };
  }

  const blob = await encode(file, maxBytes, maxEdge);
  const renamed = new File([blob], jpegName(file.name), { type: "image/jpeg" });
  return { file: renamed, changed: true, was: file.size };
}

export class ImageError extends Error {}

async function encode(file: File, maxBytes: number, maxEdge: number): Promise<Blob> {
  const inWorker = pool();
  if (!inWorker) return onMainThread(file, maxBytes, maxEdge);

  const id = nextId++;
  return new Promise<Blob>((resolve, reject) => {
    const done = (event: MessageEvent<FitReply>) => {
      if (event.data.id !== id) return;
      inWorker.removeEventListener("message", done);
      if (event.data.ok) resolve(event.data.blob);
      else reject(new ImageError(describe(event.data.error, maxBytes)));
    };
    inWorker.addEventListener("message", done);
    const request: FitRequest = { id, file, maxBytes, maxEdge };
    inWorker.postMessage(request);
  });
}

/**
 * The same algorithm on a plain canvas, for anywhere the worker path is not
 * available. Kept deliberately close to the worker's so the two cannot drift
 * into producing different files.
 */
async function onMainThread(file: File, maxBytes: number, maxEdge: number): Promise<Blob> {
  const source = await createImageBitmap(file);
  let edge = Math.min(maxEdge, Math.max(source.width, source.height));

  for (;;) {
    const scale = edge / Math.max(source.width, source.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new ImageError("This browser cannot resize images.");

    // JPEG has no alpha; without a background, transparency encodes as black.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);

    for (const quality of [0.85, 0.75, 0.65, 0.55, 0.45]) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", quality),
      );
      if (blob && blob.size <= maxBytes) {
        source.close();
        return blob;
      }
    }
    if (edge <= 320) {
      source.close();
      throw new ImageError(describe(`cannot fit under ${maxBytes} bytes`, maxBytes));
    }
    edge = Math.max(320, Math.round(edge * 0.75));
  }
}

function describe(error: string, maxBytes: number): string {
  return error.startsWith("cannot fit")
    ? `That image will not fit under ${Math.round(maxBytes / 1000)} KB even at the ` +
        "smallest size we will scale to. Try cropping it first."
    : `That image could not be read: ${error}`;
}

/** `holiday snap.HEIC` becomes `holiday snap.jpg` — the extension is the type. */
function jpegName(name: string): string {
  const stem = name.replace(/\.[^./\\]+$/, "");
  return `${stem || "image"}.jpg`;
}
