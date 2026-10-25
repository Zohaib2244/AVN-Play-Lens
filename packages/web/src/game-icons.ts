/** Resize uploads before sending them to the existing compact library storage. */
export async function prepareGameIcon(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw new Error("Choose a PNG, JPEG or WebP image.");
  if (file.size > 20 * 1024 * 1024)
    throw new Error(
      "Choose an image under 20 MB. PlayLens will resize it automatically.",
    );
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error(
      "Could not open this image. Try another PNG, JPEG or WebP.",
    );
  });
  try {
    for (const size of [512, 384, 256, 128]) {
      const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context)
        throw new Error(
          "Could not resize the image. Try again in a browser with canvas support.",
        );
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL("image/webp", 0.85);
      if (data.length <= 340000) return data;
    }
    throw new Error("Could not compress this image. Try a smaller image.");
  } finally {
    bitmap.close();
  }
}
