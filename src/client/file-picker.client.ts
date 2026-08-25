export type PickedFile = { fileName: string; dataUrl: string };

/** Reads a picked or pasted file into the data url the panel previews and uploads. */
export function readFileDataUrl(file: { name?: string; type: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("the file could not be read"));
    reader.readAsDataURL(file as unknown as Blob);
  });
}

/**
 * The host gives a plugin no file dialog, so on web the panel opens the browser's own by clicking a
 * hidden input. The picker reaches the machine the panel is rendered on, which is why the
 * attach-by-path sheet stays: it is the only way to name a file on the machine paseo runs on.
 */
export function pickFiles(options: { accept: string; multiple: boolean }): Promise<PickedFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = options.accept;
    input.multiple = options.multiple;
    input.style.display = "none";
    document.body.appendChild(input);

    const finish = (files: PickedFile[]) => {
      input.remove();
      resolve(files);
    };
    input.addEventListener(
      "change",
      () => {
        const files = Array.from(input.files ?? []);
        void Promise.all(
          files.map(async (file) => ({ fileName: file.name, dataUrl: await readFileDataUrl(file) })),
        ).then(finish, () => finish([]));
      },
      { once: true },
    );
    input.addEventListener("cancel", () => finish([]), { once: true });
    input.click();
  });
}

export const IMAGE_ACCEPT = "image/png,image/jpeg,image/gif,image/webp";
