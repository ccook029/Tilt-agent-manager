// ---------------------------------------------------------------------------
// images.ts — client-side upload preparation.
//
// Uploads travel inline (base64) to the chat API and Vercel caps request
// bodies at ~4.5MB, so big camera shots get downscaled to a sane working size
// before they enter the conversation.
// ---------------------------------------------------------------------------

const MAX_DIMENSION = 2048;
const MAX_INLINE_BYTES = 1_500_000; // ~1.5MB raw ≈ 2MB base64

export type PreparedImage = { dataUrl: string; name: string };

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Shrinks an already-in-conversation image (e.g. a 2K/4K generation being fed
 * back for an edit) so the outgoing request stays under Vercel's body cap.
 * No-op for images that are already small enough.
 */
const MAX_SEND_CHARS = 1_800_000; // base64 chars ≈ 1.35MB raw

export async function shrinkDataUrlIfLarge(dataUrl: string): Promise<string> {
  if (dataUrl.length <= MAX_SEND_CHARS) return dataUrl;
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas.toDataURL("image/jpeg", 0.9);
  } catch {
    return dataUrl;
  }
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error(`"${file.name}" isn't an image.`);
  }

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));

  // Small enough and already web-friendly: pass through untouched.
  if (scale === 1 && file.size <= MAX_INLINE_BYTES && /png|jpeg|webp/.test(file.type)) {
    bitmap.close();
    return { dataUrl: await blobToDataUrl(file), name: file.name };
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't read the image.");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  // PNG keeps transparency (logos, cutouts); everything else goes JPEG.
  const keepPng = file.type === "image/png" && file.size <= MAX_INLINE_BYTES;
  const dataUrl = keepPng
    ? canvas.toDataURL("image/png")
    : canvas.toDataURL("image/jpeg", 0.9);
  return { dataUrl, name: file.name };
}
