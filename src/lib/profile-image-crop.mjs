export const PROFILE_IMAGE_SOURCE_MAX_BYTES = 10 * 1024 * 1024;
export const PROFILE_IMAGE_SOURCE_MAX_PIXELS = 40_000_000;
export const PROFILE_IMAGE_SOURCE_MAX_DIMENSION = 12_000;
export const PROFILE_IMAGE_OUTPUT_SIZE = 512;
export const PROFILE_IMAGE_OUTPUT_TYPE = "image/jpeg";

const SUPPORTED_PROFILE_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export function isSupportedProfileImageType(type) {
  return SUPPORTED_PROFILE_IMAGE_TYPES.has(type);
}

export function buildCroppedProfileImageFileName(originalFileName) {
  const sourceName = typeof originalFileName === "string" ? originalFileName : "";
  const sourceStem = sourceName.replace(/\.[^.]+$/, "");
  const safeStem = sourceStem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return `${safeStem || "profile-picture"}-cropped.jpg`;
}

export function validateProfileImageDimensions(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return false;
  }

  return (
    width <= PROFILE_IMAGE_SOURCE_MAX_DIMENSION &&
    height <= PROFILE_IMAGE_SOURCE_MAX_DIMENSION &&
    width * height <= PROFILE_IMAGE_SOURCE_MAX_PIXELS
  );
}

function loadImage(sourceUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The selected image could not be decoded."));
    image.src = sourceUrl;
  });
}

export async function readProfileImageDimensions(sourceUrl) {
  const image = await loadImage(sourceUrl);

  return {
    width: image.naturalWidth,
    height: image.naturalHeight,
  };
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }

        reject(new Error("The cropped profile image could not be encoded."));
      },
      PROFILE_IMAGE_OUTPUT_TYPE,
      0.88,
    );
  });
}

export async function createCroppedProfileImageFile({
  sourceUrl,
  cropPixels,
  originalFileName,
}) {
  const image = await loadImage(sourceUrl);
  const sourceX = Math.max(0, Math.round(cropPixels?.x ?? 0));
  const sourceY = Math.max(0, Math.round(cropPixels?.y ?? 0));
  const sourceWidth = Math.min(
    image.naturalWidth - sourceX,
    Math.max(1, Math.round(cropPixels?.width ?? 0)),
  );
  const sourceHeight = Math.min(
    image.naturalHeight - sourceY,
    Math.max(1, Math.round(cropPixels?.height ?? 0)),
  );

  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error("The selected crop is outside the source image.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = PROFILE_IMAGE_OUTPUT_SIZE;
  canvas.height = PROFILE_IMAGE_OUTPUT_SIZE;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("This browser cannot prepare the cropped profile image.");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, PROFILE_IMAGE_OUTPUT_SIZE, PROFILE_IMAGE_OUTPUT_SIZE);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    PROFILE_IMAGE_OUTPUT_SIZE,
    PROFILE_IMAGE_OUTPUT_SIZE,
  );

  const blob = await canvasToBlob(canvas);

  return new File(
    [blob],
    buildCroppedProfileImageFileName(originalFileName),
    {
      type: PROFILE_IMAGE_OUTPUT_TYPE,
      lastModified: Date.now(),
    },
  );
}
