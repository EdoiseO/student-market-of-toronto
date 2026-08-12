import * as React from "react";

export const LISTING_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const LISTING_IMAGE_MAX_COUNT = 10;
export const LISTING_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

export function getValidListingImageFiles(fileList) {
  return Array.from(fileList ?? []).filter(
    (file) =>
      LISTING_IMAGE_MIME_TYPES.includes(file.type) &&
      file.size <= LISTING_IMAGE_MAX_BYTES,
  );
}

export function useFileDropzone(onFilesAdded) {
  const [isDragActive, setIsDragActive] = React.useState(false);
  const dragDepth = React.useRef(0);

  const handleDragEnter = React.useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();

    if (!event.dataTransfer?.types?.includes("Files")) {
      return;
    }

    dragDepth.current += 1;
    setIsDragActive(true);
  }, []);

  const handleDragOver = React.useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();

    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
  }, []);

  const handleDragLeave = React.useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();

    dragDepth.current = Math.max(0, dragDepth.current - 1);

    if (dragDepth.current === 0) {
      setIsDragActive(false);
    }
  }, []);

  const handleDrop = React.useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();

    dragDepth.current = 0;
    setIsDragActive(false);

    const imageFiles = Array.from(event.dataTransfer?.files ?? []);

    if (imageFiles.length > 0) {
      onFilesAdded(imageFiles);
    }
  }, [onFilesAdded]);

  return {
    isDragActive,
    dropzoneProps: {
      onDragEnter: handleDragEnter,
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    },
  };
}
