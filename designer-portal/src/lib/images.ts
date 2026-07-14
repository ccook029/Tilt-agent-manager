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
