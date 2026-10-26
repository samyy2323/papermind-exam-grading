import { useDropzone } from 'react-dropzone';
import Icon from './Icon';

/**
 * Drag-and-drop + click-to-browse upload area.
 * `accept` follows react-dropzone's MIME map, e.g. { 'application/pdf': ['.pdf'] }.
 */
export default function FileUpload({
  onFiles,
  accept,
  multiple = false,
  disabled = false,
  title = 'Drag & drop a file here',
  hint,
  icon = 'upload',
  compact = false,
}) {
  const { getRootProps, getInputProps, isDragActive, fileRejections } = useDropzone({
    onDrop: (accepted) => accepted.length && onFiles(accepted),
    accept,
    multiple,
    disabled,
  });

  return (
    <div>
      <div
        {...getRootProps()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed text-center transition-colors
          ${compact ? 'px-4 py-6' : 'px-6 py-10'}
          ${isDragActive ? 'border-accent bg-accent-soft' : 'border-line bg-paper/60 hover:border-accent/50 hover:bg-accent-soft/40'}
          ${disabled ? 'pointer-events-none opacity-50' : ''}`}
      >
        <input {...getInputProps()} />
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-card text-accent shadow-sm ring-1 ring-line">
          <Icon name={icon} size={20} />
        </div>
        <p className="text-sm font-medium text-ink">{isDragActive ? 'Drop to upload' : title}</p>
        <p className="mt-1 text-xs text-ink-soft">
          or <span className="font-medium text-accent underline underline-offset-2">browse files</span>
          {hint && <> · {hint}</>}
        </p>
      </div>
      {fileRejections.length > 0 && (
        <p className="mt-2 text-xs text-bad">
          {fileRejections.map((r) => r.file.name).join(', ')} — unsupported file type.
        </p>
      )}
    </div>
  );
}
