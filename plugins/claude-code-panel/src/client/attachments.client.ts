/** What the composer is holding until the prompt is sent. */
export type AttachmentKind = "image" | "file" | "issue" | "pr";

export type Attachment = {
  kind: AttachmentKind;
  /** The line appended to the prompt: a path the CLI reads, or a URL it fetches. */
  reference: string;
  title: string;
  subtitle: string;
  /** Drawn instead of the title and subtitle when the panel has the image itself. */
  previewDataUrl: string | null;
};

export type ForgeItem = {
  kind: "issue" | "pr";
  number: number;
  title: string;
  state: string;
  url: string;
};

export function attachmentName(target: string): string {
  const name = target.split("/").pop();
  return name === undefined || name === "" ? target : name;
}

export function imageAttachment(path: string, previewDataUrl: string | null): Attachment {
  return { kind: "image", reference: path, title: attachmentName(path), subtitle: "Image", previewDataUrl };
}

export function fileAttachment(path: string): Attachment {
  return { kind: "file", reference: path, title: attachmentName(path), subtitle: "File", previewDataUrl: null };
}

export function forgeAttachment(item: ForgeItem): Attachment {
  return {
    kind: item.kind,
    reference: item.url,
    title: item.title,
    subtitle: `${forgeLabel(item.kind)} #${item.number}`,
    previewDataUrl: null,
  };
}

export function forgeLabel(kind: "issue" | "pr"): string {
  return kind === "pr" ? "PR" : "Issue";
}

export function forgeOptionLabel(item: ForgeItem): string {
  return `#${item.number} ${item.title}`;
}

/** An attachment is only ever added once, and the reference is what the CLI would see twice. */
export function addAttachment(current: Attachment[], next: Attachment): Attachment[] {
  return current.some((attachment) => attachment.reference === next.reference)
    ? current
    : [...current, next];
}
