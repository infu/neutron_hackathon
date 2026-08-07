/// <reference lib="webworker" />

/**
 * Image resizing, off the main thread.
 *
 * Decoding a 12 MP phone photo and re-encoding it takes long enough to freeze
 * a page visibly, and it happens at the exact moment somebody is watching —
 * they just picked a file. `createImageBitmap` and `OffscreenCanvas` both work
 * in a worker, so the whole job goes here and the UI keeps painting.
 *
 * The reply is a Blob, transferred rather than copied.
 */

export type FitRequest = {
  id: number;
  file: File;
  maxBytes: number;
  maxEdge: number;
};

export type FitReply =
  | { id: number; ok: true; blob: Blob; width: number; height: number }
  | { id: number; ok: false; error: string };

/**
 * Qualities to try before giving up and shrinking.
 *
 * Descending, and stopping at 0.45: below that JPEG artefacts are worse than
 * the smaller image you would get by scaling instead, so scaling is what we do.
 */
const QUALITIES = [0.85, 0.75, 0.65, 0.55, 0.45];

/** Never scale below this on the longest edge — past it the image is useless. */
const MIN_EDGE = 320;

async function fit(request: FitRequest): Promise<FitReply> {
  const { id, file, maxBytes, maxEdge } = request;
  try {
    const source = await createImageBitmap(file);
    let edge = Math.min(maxEdge, Math.max(source.width, source.height));

    for (;;) {
      const scale = edge / Math.max(source.width, source.height);
      const width = Math.max(1, Math.round(source.width * scale));
      const height = Math.max(1, Math.round(source.height * scale));

      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d");
      if (!context) return { id, ok: false, error: "no 2d context" };

      // JPEG has no alpha. Without this, transparent pixels encode as black,
      // which turns every PNG logo into a dark smear.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(source, 0, 0, width, height);

      for (const quality of QUALITIES) {
        const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
        if (blob.size <= maxBytes) {
          source.close();
          return { id, ok: true, blob, width, height };
        }
      }

      if (edge <= MIN_EDGE) {
        // Even at the floor and the worst quality it does not fit. Hand back
        // the smallest we made so the caller can say so precisely.
        const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.45 });
        source.close();
        return blob.size <= maxBytes
          ? { id, ok: true, blob, width, height }
          : { id, ok: false, error: `cannot fit under ${maxBytes} bytes` };
      }
      edge = Math.max(MIN_EDGE, Math.round(edge * 0.75));
    }
  } catch (cause) {
    return { id, ok: false, error: cause instanceof Error ? cause.message : String(cause) };
  }
}

self.onmessage = async (event: MessageEvent<FitRequest>) => {
  const reply = await fit(event.data);
  self.postMessage(reply);
};
