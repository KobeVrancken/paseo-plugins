/** What the composer is holding until the prompt is sent. */
export type Attachment = {
  /** Where the CLI will read it from; appended to the prompt on send. */
  path: string;
  previewDataUrl: string | null;
};

export function attachmentName(target: string): string {
  const name = target.split("/").pop();
  return name === undefined || name === "" ? target : name;
}
