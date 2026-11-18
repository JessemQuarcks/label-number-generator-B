import { PX_PER_MM, round } from "./units";

const IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/svg+xml",
  "image/bmp",
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
};

export const UNSUPPORTED_IMAGE =
  "Unsupported image format. Use JPG, PNG, GIF, WebP, AVIF, SVG, or BMP.";

const mimeOf = (file: File): string => {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return (file.type || MIME_BY_EXTENSION[extension] || "").toLowerCase();
};

export const isImageFile = (file: File): boolean => IMAGE_MIME_TYPES.has(mimeOf(file));

export const isJsonFile = (file: File): boolean =>
  file.type === "application/json" || file.name.toLowerCase().endsWith(".json");

/** Read an image into a data URL, so it is embedded in the design. */
export const readImageFile = (file: File): Promise<string> => {
  const mimeType = mimeOf(file);
  if (!IMAGE_MIME_TYPES.has(mimeType)) {
    return Promise.reject(new Error(UNSUPPORTED_IMAGE));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Could not read that image file."));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read that image file."));
    reader.readAsDataURL(new Blob([file], { type: mimeType }));
  });
};

/** "citrus-label.png" → "citrus-label". */
export const imageNameOf = (file: File): string =>
  file.name.replace(/\.[^.]+$/, "") || "Image";

/**
 * The image's pixel size, or null when it cannot be decoded in time (jsdom,
 * a broken file). Callers fall back to a sensible box rather than waiting.
 */
export const measureImage = (src: string, timeoutMs = 3000): Promise<{ width: number; height: number } | null> =>
  new Promise((resolve) => {
    if (typeof Image === "undefined") return resolve(null);
    const img = new Image();
    const timer = window.setTimeout(() => resolve(null), timeoutMs);
    img.onload = () => {
      window.clearTimeout(timer);
      resolve(
        img.naturalWidth > 0 && img.naturalHeight > 0
          ? { width: img.naturalWidth, height: img.naturalHeight }
          : null
      );
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      resolve(null);
    };
    img.src = src;
  });

/**
 * Where a placed image lands: its natural size at 96 dpi, scaled down to fit
 * 80% of the label if larger, centred on `at` (the drop point) or the label.
 */
export const placementFor = (
  natural: { width: number; height: number } | null,
  label: { width: number; height: number },
  at?: { x: number; y: number }
): { x: number; y: number; width: number; height: number } => {
  const maxW = label.width * 0.8;
  const maxH = label.height * 0.8;
  let width: number;
  let height: number;
  if (natural) {
    width = natural.width / PX_PER_MM;
    height = natural.height / PX_PER_MM;
    const shrink = Math.min(1, maxW / width, maxH / height);
    width *= shrink;
    height *= shrink;
  } else {
    width = maxW * 0.6;
    height = maxH * 0.6;
  }
  width = Math.max(1, width);
  height = Math.max(1, height);
  const cx = at?.x ?? label.width / 2;
  const cy = at?.y ?? label.height / 2;
  return {
    x: round(cx - width / 2, 2),
    y: round(cy - height / 2, 2),
    width: round(width, 2),
    height: round(height, 2),
  };
};
