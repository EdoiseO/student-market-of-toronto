import * as React from "react";

function getImageFiles(fileList) {
  return Array.from(fileList ?? []).filter((file) => file.type.startsWith("image/"));
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

    const imageFiles = getImageFiles(event.dataTransfer?.files);

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
