`use client`;

import { useCallback, useState } from "react";
import { Upload, X, Image as ImageIcon } from "lucide-react";

interface ImageUploadProps {
  label: string;
  hint: string;
  onImageSelect: (file: File, preview: string) => void;
  onClear: () => void;
  preview: string | null;
}

export function ImageUpload({ label, hint, onImageSelect, onClear, preview }: ImageUploadProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = (e) => {
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

  if (preview) {
    return (
      <div className="relative">
        <div className="card-surface overflow-hidden">
          <img src={preview} alt="Uploaded insect" className="w-full object-contain" style={{ maxHeight: 400 }} />
        </div>
        <button
          onClick={onClear}
          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md border bg-background/80 text-muted-foreground transition-colors hover:text-foreground backdrop-blur-sm"
        >
          <X className="h-3.5 w-3.5" />
        </button>
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
      className={`workbench-input flex cursor-pointer flex-col items-center justify-center gap-4 py-20 transition-all duration-200 ${
        isDragging ? "border-accent bg-accent/5" : "border-border"
      }`}
      onClick={() => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".jpg,.jpeg,.png,.tif,.tiff";
        input.onchange = (e) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          if (file) handleFile(file);
        };
        input.click();
      }}
    >
      <div className={`flex h-12 w-12 items-center justify-center rounded-lg border ${
        isDragging ? "border-accent bg-accent/10" : "bg-secondary"
      }`}>
        {isDragging ? (
          <ImageIcon className="h-5 w-5 text-accent" />
        ) : (
          <Upload className="h-5 w-5 text-muted-foreground" />
        )}
      </div>
      <div className="text-center">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}
