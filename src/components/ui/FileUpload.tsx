import { useRef, useState } from 'react';
import { UploadCloud, FileText, X } from 'lucide-react';
import { classNames } from '@/lib/format';

export interface UploadedFile {
  id: string;
  name: string;
  size: string;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

let uid = 0;

export function FileUpload({
  files,
  onChange,
  label = 'Upload file',
  hint = 'PDF, PNG or JPG up to 10MB',
  multiple = true,
}: {
  files: UploadedFile[];
  onChange: (files: UploadedFile[]) => void;
  label?: string;
  hint?: string;
  multiple?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = (list: FileList | null) => {
    if (!list) return;
    const next: UploadedFile[] = Array.from(list).map((f) => ({
      id: `up-${++uid}`,
      name: f.name,
      size: humanSize(f.size),
    }));
    onChange(multiple ? [...files, ...next] : next.slice(0, 1));
  };

  return (
    <div>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={classNames(
          'flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-6 text-center transition',
          dragOver ? 'border-brand-400 bg-brand-50' : 'border-surface-200 hover:border-surface-300 bg-surface-50/50'
        )}
      >
        <UploadCloud className="mb-2 h-6 w-6 text-surface-400" />
        <p className="text-sm font-medium text-surface-700">
          {label} <span className="text-brand-600">— browse</span>
        </p>
        <p className="mt-0.5 text-xs text-surface-400">{hint}</p>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          multiple={multiple}
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>
      {files.length > 0 && (
        <ul className="mt-3 space-y-2">
          {files.map((f) => (
            <li
              key={f.id}
              className="flex items-center gap-3 rounded-lg border border-surface-200 bg-white px-3 py-2"
            >
              <FileText className="h-4 w-4 flex-none text-brand-500" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-surface-700">{f.name}</p>
                <p className="text-xs text-surface-400">{f.size}</p>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(files.filter((x) => x.id !== f.id));
                }}
                className="rounded p-1 text-surface-400 hover:bg-surface-100 hover:text-rose-500"
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
