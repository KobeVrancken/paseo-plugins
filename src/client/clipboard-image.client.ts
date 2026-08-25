/**
 * Pulling images out of a web paste.
 * The DOM's clipboard types are restated structurally, so the same functions run in a test with no
 * clipboard, no `File` and no `document` anywhere.
 */
export type PastedFile = { name?: string; type: string };

export type PastedItem = { kind: string; type: string; getAsFile: () => PastedFile | null };

export type PastedClipboard = {
  items?: ArrayLike<PastedItem> | null;
  files?: ArrayLike<PastedFile> | null;
};

/** The raster formats the CLI accepts, and the extension each one is saved under. */
const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

export function isPasteableImage(mimeType: string): boolean {
  return IMAGE_EXTENSIONS[mimeType.trim().toLowerCase()] !== undefined;
}

/**
 * A screenshot arrives as a clipboard item, a file copied out of a file manager as a file entry,
 * and a rich-text paste as both an image and the HTML that embeds it.
 */
export function pastedImages(clipboard: PastedClipboard): PastedFile[] {
  const images: PastedFile[] = [];
  const items = clipboard.items;
  for (let index = 0; items && index < items.length; index += 1) {
    const item = items[index]!;
    if (item.kind !== "file" || !isPasteableImage(item.type)) continue;
    const file = item.getAsFile();
    if (file) images.push(file);
  }
  if (images.length > 0) return images;

  const files = clipboard.files;
  for (let index = 0; files && index < files.length; index += 1) {
    const file = files[index]!;
    if (isPasteableImage(file.type)) images.push(file);
  }
  return images;
}

export function pastedImageName(file: PastedFile): string {
  const name = file.name?.trim();
  if (name !== undefined && name !== "") return name;
  return `clipboard${IMAGE_EXTENSIONS[file.type.trim().toLowerCase()] ?? ".png"}`;
}

export function base64FromDataUrl(dataUrl: string): string | null {
  const match = /^data:[^;,]*;base64,(.*)$/s.exec(dataUrl);
  return match ? match[1]! : null;
}
