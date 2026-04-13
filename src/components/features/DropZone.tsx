import { useRef, useState, DragEvent, ChangeEvent } from 'react';
import { Upload, FileType, CheckCircle } from 'lucide-react';

interface DropZoneProps {
  onFileSelected: (file: File) => void;
  loadedFontName: string | null;
}

export function DropZone({ onFileSelected, loadedFontName }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) onFileSelected(file);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFileSelected(file);
  };

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      className={`
        relative cursor-pointer rounded-xl border-2 border-dashed transition-all duration-200 p-10
        flex flex-col items-center justify-center gap-4 min-h-[200px] select-none
        ${isDragging
          ? 'border-primary bg-primary/10 glow-green scale-[1.01]'
          : loadedFontName
            ? 'border-primary/50 bg-primary/5'
            : 'border-border bg-card hover:border-primary/40 hover:bg-card'
        }
      `}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".ttf,.otf"
        className="hidden"
        onChange={handleChange}
      />

      {loadedFontName ? (
        <>
          <CheckCircle className="w-10 h-10 text-primary" />
          <div className="text-center">
            <p className="text-primary font-semibold mono text-sm">{loadedFontName}</p>
            <p className="text-muted-foreground text-xs mt-1">Font loaded — click to change</p>
          </div>
        </>
      ) : (
        <>
          <div className={`p-4 rounded-xl border transition-colors ${isDragging ? 'border-primary bg-primary/20' : 'border-border bg-secondary'}`}>
            {isDragging ? (
              <FileType className="w-8 h-8 text-primary" />
            ) : (
              <Upload className="w-8 h-8 text-muted-foreground" />
            )}
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">
              {isDragging ? 'Drop your font here' : 'Drop a font file or click to browse'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Supports .TTF and .OTF formats</p>
          </div>
        </>
      )}
    </div>
  );
}
