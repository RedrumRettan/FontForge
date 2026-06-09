import { ConversionResult } from '@/types/font';
import { useEffect, useState } from 'react';
import { Download, FileText, Image, Package, Eye, Code } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface OutputPanelProps {
  result: ConversionResult;
  onDownloadFnt: () => void;
  onDownloadAtlas: () => void;
  onDownloadBoth: () => void;
  onOutputNameChange: (name: string) => void;
}

type Tab = 'atlas' | 'fnt';

export function OutputPanel({ result, onDownloadFnt, onDownloadAtlas, onDownloadBoth, onOutputNameChange }: OutputPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('atlas');
  const [checkerBg, setCheckerBg] = useState(true);
  const [outputName, setOutputName] = useState(result.fontName);

  useEffect(() => {
    setOutputName(result.fontName);
  }, [result.fontName]);

  const commitOutputName = () => {
    if (!outputName.trim()) {
      setOutputName(result.fontName);
      return;
    }
    onOutputNameChange(outputName);
  };

  return (
    <div className="space-y-4">
      {/* Output Name */}
      <div className="space-y-2 rounded-lg border border-border bg-secondary p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Output Name</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Used for the .fnt face and PNG filename</p>
          </div>
          <Input
            value={outputName}
            onChange={(e) => setOutputName(e.target.value)}
            onBlur={commitOutputName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            className="max-w-[220px] bg-background border-border mono text-xs"
            aria-label="Custom output name"
          />
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-secondary rounded-lg p-3 border border-border">
          <p className="text-xs text-muted-foreground">Glyphs</p>
          <p className="mono text-lg font-semibold text-primary">{result.glyphs.length}</p>
        </div>
        <div className="bg-secondary rounded-lg p-3 border border-border">
          <p className="text-xs text-muted-foreground">Kernings</p>
          <p className="mono text-lg font-semibold text-primary">{result.kernings.length}</p>
        </div>
        <div className="bg-secondary rounded-lg p-3 border border-border">
          <p className="text-xs text-muted-foreground">Line Height</p>
          <p className="mono text-lg font-semibold text-accent">{result.lineHeight}px</p>
        </div>
        <div className="bg-secondary rounded-lg p-3 border border-border">
          <p className="text-xs text-muted-foreground">Base</p>
          <p className="mono text-lg font-semibold text-foreground">{result.base}px</p>
        </div>
      </div>

      {/* Tab Selector */}
      <div className="flex gap-1 p-1 bg-secondary rounded-lg border border-border">
        <button
          onClick={() => setActiveTab('atlas')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded text-sm font-medium transition-all ${
            activeTab === 'atlas'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Image className="w-4 h-4" />
          Atlas Preview
        </button>
        <button
          onClick={() => setActiveTab('fnt')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded text-sm font-medium transition-all ${
            activeTab === 'fnt'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Code className="w-4 h-4" />
          FNT Content
        </button>
      </div>

      {/* Content */}
      {activeTab === 'atlas' ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Texture Atlas</span>
            <button
              onClick={() => setCheckerBg(!checkerBg)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            >
              <Eye className="w-3 h-3" />
              {checkerBg ? 'Dark bg' : 'Checker bg'}
            </button>
          </div>
          <div
            className="rounded-lg border border-border overflow-auto max-h-[400px]"
            style={{
              background: checkerBg
                ? 'repeating-conic-gradient(#1a1f2e 0% 25%, #0f1117 0% 50%) 0 0 / 16px 16px'
                : '#000000',
            }}
          >
            <img
              src={result.atlasDataUrl}
              alt="Font Atlas"
              className="max-w-full"
              style={{ imageRendering: 'pixelated' }}
            />
          </div>
          <p className="text-xs text-muted-foreground mono">
            {result.fontName}_0.png
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">BMFont Text Format</span>
            <span className="mono text-xs text-muted-foreground">{result.fntContent.length} bytes</span>
          </div>
          <pre className="bg-secondary border border-border rounded-lg p-4 text-xs mono text-primary overflow-auto max-h-[400px] whitespace-pre leading-relaxed scanline">
            {result.fntContent.slice(0, 3000)}
            {result.fntContent.length > 3000 && '\n\n... (truncated for display)'}
          </pre>
        </div>
      )}

      {/* Download Buttons */}
      <div className="grid grid-cols-1 gap-2 pt-2">
        <Button
          onClick={onDownloadBoth}
          className="bg-primary text-primary-foreground hover:bg-primary/90 font-semibold gap-2 h-11"
        >
          <Package className="w-4 h-4" />
          Download Both Files (.fnt + .png)
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            onClick={onDownloadFnt}
            className="gap-2 text-sm border-border hover:bg-secondary"
          >
            <FileText className="w-4 h-4 text-accent" />
            .fnt only
          </Button>
          <Button
            variant="outline"
            onClick={onDownloadAtlas}
            className="gap-2 text-sm border-border hover:bg-secondary"
          >
            <Download className="w-4 h-4 text-primary" />
            .png only
          </Button>
        </div>
      </div>
    </div>
  );
}
