import { ConversionResult } from '@/types/font';
import { useEffect, useRef } from 'react';
import { Type } from 'lucide-react';

interface GlyphPreviewProps {
  result: ConversionResult;
  fontFamily: string;
  fontSize: number;
}

export function GlyphPreview({ result, fontFamily, fontSize }: GlyphPreviewProps) {
  const previewText = "The quick brown fox jumps over the lazy dog. 0123456789!@#$%";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Type className="w-4 h-4 text-accent" />
        <h3 className="text-sm font-semibold text-foreground">Glyph Preview</h3>
        <span className="ml-auto text-xs text-muted-foreground mono">{result.glyphs.length} chars packed</span>
      </div>

      {/* Preview text */}
      <div className="bg-black rounded-lg border border-border p-5 overflow-hidden">
        <p
          style={{
            fontFamily: `"${fontFamily}", monospace`,
            fontSize: `${Math.min(fontSize, 32)}px`,
            lineHeight: 1.4,
            color: '#ffffff',
            wordBreak: 'break-all',
          }}
        >
          {previewText}
        </p>
      </div>

      {/* Glyph grid */}
      <div className="bg-card rounded-lg border border-border p-3">
        <p className="text-xs text-muted-foreground mb-3 uppercase tracking-wider">All packed glyphs</p>
        <div className="flex flex-wrap gap-1">
          {result.glyphs.map((g) => (
            <div
              key={g.id}
              className="relative group"
            >
              <div
                className="w-8 h-8 flex items-center justify-center rounded text-xs bg-secondary border border-border hover:border-primary/50 hover:bg-primary/10 transition-all cursor-default"
                style={{
                  fontFamily: `"${fontFamily}", monospace`,
                  fontSize: '14px',
                  color: '#ffffff',
                }}
                title={`id=${g.id} '${g.char}' ${g.width}×${g.height} adv=${g.xadvance}`}
              >
                {g.char === ' ' ? '␣' : g.char}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
