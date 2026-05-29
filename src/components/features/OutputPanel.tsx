import { ConversionResult } from '@/types/font';
import { useState } from 'react';
import { Download, FileText, Image, Package, Eye, Code } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface OutputPanelProps {
  result: ConversionResult;
  onDownloadFnt: () => void;
  onDownloadAtlas: () => void;
  onDownloadBoth: () => void;
}

type Tab = 'atlas' | 'fnt';

export function OutputPanel({ result, onDownloadFnt, onDownloadAtlas, onDownloadBoth }: OutputPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('atlas');
  const [checkerBg, setCheckerBg] = useState(true);

  return (
    <div className="space-y-4">
      {/* Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-secondary rounded-lg p-3 border border-border">
          <p className="text-xs text-muted-foreground">Glyphs</p>
          <p className="mono text-lg font-semibold text-primary">{result.glyphs.length}</p>
        </div>
        <div className="bg-secondary rounded-lg p-3 border border-border">
          <p className="text-xs text-muted-foreground">Line Height</p>
          <p className="mono text-lg font-semibold text-accent">{result.lineHeight}px</p>
        </div>
        <div className="bg-secondary rounded-lg p-3 border border-border">
          <p className="text-xs text-muted-foreground">Base</p>
          <p className="mono text-lg font-semibold text-foreground">{result.base}px</p>
        </div>
        <div className="bg-secondary rounded-lg p-3 border border-border">
          <p className="text-xs text-muted-foreground">Pages / Fill</p>
          <p className="mono text-lg font-semibold text-foreground">
            {result.packingStats.pages} / {Math.round(result.packingStats.occupancy * 100)}%
          </p>
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
            <div className="space-y-3 p-2">
              {result.atlasPages.map((page) => (
                <div key={page.id} className="space-y-1">
                  <img
                    src={page.dataUrl}
                    alt={`Font Atlas page ${page.id}`}
                    className="max-w-full"
                    style={{ imageRendering: 'pixelated' }}
                  />
                  <p className="text-xs text-muted-foreground mono">
                    {page.fileName} · {result.packingStats.pageStats[page.id]?.rects ?? 0} glyphs · {Math.round((result.packingStats.pageStats[page.id]?.occupancy ?? 0) * 100)}% full
                  </p>
                </div>
              ))}
            </div>
          </div>
          <p className="text-xs text-muted-foreground mono">
            {result.atlasPages.map(page => page.fileName).join(', ')}
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
          Download Files (.fnt + {result.packingStats.pages} .png{result.packingStats.pages === 1 ? '' : 's'})
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
            atlas .png{result.packingStats.pages === 1 ? '' : 's'}
          </Button>
        </div>
      </div>
    </div>
  );
}
