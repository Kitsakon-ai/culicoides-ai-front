"use client";

import { useCallback, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, X, ImagePlus, FileImage } from "lucide-react";

interface ImageUploadProps {
  label: string;
  hint: string;
  onImageSelect: (file: File, preview: string) => void;
  onClear: () => void;
  preview: string | null;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ImageUpload({ label, hint, onImageSelect, onClear, preview }: ImageUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [fileMeta, setFileMeta] = useState<{ name: string; size: number } | null>(null);

  const handleFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        setFileMeta({ name: file.name, size: file.size });
        onImageSelect(file, e.target?.result as string);
      };
      reader.readAsDataURL(file);
    },
    [onImageSelect]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const openFilePicker = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".jpg,.jpeg,.png,.tif,.tiff";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) handleFile(file);
    };
    input.click();
  }, [handleFile]);

  if (preview) {
    return (
      <div className="card-surface overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/10">
            <FileImage className="h-3.5 w-3.5 text-accent" />
          </div>
          <span className="truncate text-xs font-medium text-foreground">
            {fileMeta?.name ?? "image"}
          </span>
          {fileMeta && (
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              {formatBytes(fileMeta.size)}
            </span>
          )}
          <button
            onClick={onClear}
            className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex min-h-[58vh] items-center justify-center bg-muted/20 p-4">
          <img
            src={preview}
            alt="Uploaded insect"
            className="max-h-[440px] w-auto max-w-full rounded-md object-contain shadow-sm"
          />
        </div>
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      onClick={openFilePicker}
      className={`group relative flex min-h-[58vh] cursor-pointer flex-col items-center justify-center gap-5 overflow-hidden rounded-xl border-2 border-dashed bg-card transition-all duration-200 ${
        isDragging
          ? "border-accent bg-accent/5"
          : "border-border hover:border-accent/50 hover:bg-accent/[0.02]"
      }`}
    >
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-accent/5 via-transparent to-transparent" />

      <motion.div
        animate={{ scale: isDragging ? 1.08 : 1 }}
        transition={{ duration: 0.2 }}
        className={`relative flex h-20 w-20 items-center justify-center rounded-2xl border ${
          isDragging ? "border-accent bg-accent/10" : "border-border bg-secondary"
        }`}
      >
        <AnimatePresence mode="wait">
          {isDragging ? (
            <motion.div
              key="dragging"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
            >
              <ImagePlus className="h-8 w-8 text-accent" />
            </motion.div>
          ) : (
            <motion.div
              key="idle"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
            >
              <Upload className="h-8 w-8 text-muted-foreground transition-colors group-hover:text-accent" />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <div className="relative space-y-1.5 text-center px-6">
        <p className="text-base font-semibold text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          openFilePicker();
        }}
        className="relative flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-xs font-medium text-accent-foreground transition-colors hover:bg-accent/90"
      >
        <Upload className="h-3.5 w-3.5" />
        เลือกไฟล์
      </button>

      <div className="relative flex items-center gap-1.5">
        {["JPG", "PNG", "TIFF"].map((ext) => (
          <span
            key={ext}
            className="rounded border bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
          >
            {ext}
          </span>
        ))}
      </div>
    </div>
  );
}
