// ---------------------------------------------------------------------------
// attachments.ts — screenshot attachments for the chats (client-side).
//
// Attach / paste / drop an image; it's downscaled in the browser (max 1600px,
// JPEG) so the request stays under Vercel's body cap before it's sent to Claude
// as an image block. Shared by the employee chats and the accounting (Sterling
// / Penny) chat so paste-a-screenshot works the same everywhere.
// ---------------------------------------------------------------------------

export interface Attachment {
  mediaType: string;
  data: string; // base64, no data: prefix
  preview: string; // data URL for the thumbnail
}

export const MAX_ATTACHMENTS = 4;

export async function fileToAttachment(file: File): Promise<Attachment | null> {
  if (!file.type.startsWith("image/")) return null;
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("bad image"));
    el.src = dataUrl;
  });

  const MAX_DIM = 1600;
  const oversized = img.width > MAX_DIM || img.height > MAX_DIM;
  // Small originals go through untouched (keeps PNG text crisp).
  if (!oversized && dataUrl.length < 900_000) {
    const comma = dataUrl.indexOf(",");
    const meta = dataUrl.slice(0, comma); // data:image/png;base64
    return {
      mediaType: meta.slice(5, meta.indexOf(";")),
      data: dataUrl.slice(comma + 1),
      preview: dataUrl,
    };
  }

  const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
  const out = canvas.toDataURL("image/jpeg", 0.85);
  return { mediaType: "image/jpeg", data: out.slice(out.indexOf(",") + 1), preview: out };
}

/** Pull image files out of a paste/drop event. */
export function imageFilesFrom(
  items: DataTransferItemList | null | undefined,
  files: FileList | null | undefined
): File[] {
  const out: File[] = [];
  for (const item of Array.from(items ?? [])) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const f = item.getAsFile();
      if (f) out.push(f);
    }
  }
  if (out.length === 0) {
    for (const f of Array.from(files ?? [])) {
      if (f.type.startsWith("image/")) out.push(f);
    }
  }
  return out;
}
