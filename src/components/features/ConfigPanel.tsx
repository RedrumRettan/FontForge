import { FontConversionConfig, CHARSETS } from '@/types/font';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useState } from 'react';
import { Settings2 } from 'lucide-react';

interface ConfigPanelProps {
  config: FontConversionConfig;
  onChange: (config: FontConversionConfig) => void;
  isColorFont?: boolean;
}

const ATLAS_SIZES = [256, 512, 1024, 2048, 4096];

export function ConfigPanel({ config, onChange, isColorFont = false }: ConfigPanelProps) {
  const [customChars, setCustomChars] = useState('');
  const [showCustom, setShowCustom] = useState(false);

  const update = (partial: Partial<FontConversionConfig>) => {
    onChange({ ...config, ...partial });
  };

  const handleCharsetChange = (val: string) => {
    if (val === 'CUSTOM') {
      setShowCustom(true);
    } else {
      setShowCustom(false);
      update({ charset: val });
    }
  };

  const handleCustomCharsChange = (val: string) => {
    setCustomChars(val);
    update({ charset: val });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 mb-2">
        <Settings2 className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Conversion Settings</h3>
      </div>

      {/* Font Size */}
      <div className="space-y-2">
        <div className="flex justify-between">
          <Label className="text-xs text-muted-foreground uppercase tracking-wider">Font Size</Label>
          <span className="mono text-xs text-primary font-semibold">{config.fontSize}px</span>
        </div>
        <Slider
          min={8}
          max={128}
          step={1}
          value={[config.fontSize]}
          onValueChange={([v]) => update({ fontSize: v })}
          className="w-full"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>8px</span><span>128px</span>
        </div>
      </div>

      {/* Padding */}
      <div className="space-y-2">
        <div className="flex justify-between">
          <Label className="text-xs text-muted-foreground uppercase tracking-wider">Padding</Label>
          <span className="mono text-xs text-primary font-semibold">{config.padding}px</span>
        </div>
        <Slider
          min={0}
          max={16}
          step={1}
          value={[config.padding]}
          onValueChange={([v]) => update({ padding: v })}
        />
      </div>


      {/* Edge Extrude */}
      <div className="space-y-2">
        <div className="flex justify-between">
          <Label className="text-xs text-muted-foreground uppercase tracking-wider">Edge Extrude</Label>
          <span className="mono text-xs text-primary font-semibold">{config.extrude}px</span>
        </div>
        <Slider
          min={0}
          max={2}
          step={1}
          value={[config.extrude]}
          onValueChange={([v]) => update({ extrude: v })}
        />
        <p className="text-xs text-muted-foreground">Duplicates glyph edge pixels for mip-safe sampling.</p>
      </div>

      {/* Spacing */}
      <div className="space-y-2">
        <div className="flex justify-between">
          <Label className="text-xs text-muted-foreground uppercase tracking-wider">Spacing</Label>
          <span className="mono text-xs text-primary font-semibold">{config.spacing}px</span>
        </div>
        <Slider
          min={0}
          max={8}
          step={1}
          value={[config.spacing]}
          onValueChange={([v]) => update({ spacing: v })}
        />
      </div>

      {/* Atlas Size */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground uppercase tracking-wider">Atlas Dimensions</Label>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Width</Label>
            <Select
              value={String(config.atlasWidth)}
              onValueChange={(v) => update({ atlasWidth: Number(v) })}
            >
              <SelectTrigger className="bg-secondary border-border text-sm mono h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ATLAS_SIZES.map(s => (
                  <SelectItem key={s} value={String(s)} className="mono">{s}px</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Height</Label>
            <Select
              value={String(config.atlasHeight)}
              onValueChange={(v) => update({ atlasHeight: Number(v) })}
            >
              <SelectTrigger className="bg-secondary border-border text-sm mono h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ATLAS_SIZES.map(s => (
                  <SelectItem key={s} value={String(s)} className="mono">{s}px</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Atlas: {config.atlasWidth}×{config.atlasHeight} — {Math.round(config.atlasWidth * config.atlasHeight / 1024)}K pixels
        </p>
      </div>

      {/* Character Set */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground uppercase tracking-wider">Character Set</Label>
        <Select
          value={showCustom ? 'CUSTOM' : config.charset}
          onValueChange={handleCharsetChange}
        >
          <SelectTrigger className="bg-secondary border-border text-sm h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ASCII_PRINTABLE">ASCII Printable (95 chars)</SelectItem>
            <SelectItem value="ALPHANUMERIC">Alphanumeric (62 chars)</SelectItem>
            <SelectItem value="UPPERCASE">Uppercase A–Z</SelectItem>
            <SelectItem value="LOWERCASE">Lowercase a–z</SelectItem>
            <SelectItem value="DIGITS">Digits 0–9</SelectItem>
            <SelectItem value="EXTENDED">Extended (Latin + symbols)</SelectItem>
            <SelectItem value="CUSTOM">Custom…</SelectItem>
          </SelectContent>
        </Select>

        {showCustom && (
          <div className="space-y-1">
            <Textarea
              className="bg-secondary border-border mono text-xs resize-none h-20"
              placeholder="Type the characters you want to include..."
              value={customChars}
              onChange={(e) => handleCustomCharsChange(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{customChars.length} characters</p>
          </div>
        )}
      </div>

      {/* Glyph Color */}
      <div className={`space-y-2 transition-opacity ${config.useNativeColors ? 'opacity-40 pointer-events-none' : ''}`}>
        <Label className="text-xs text-muted-foreground uppercase tracking-wider">Glyph Color</Label>
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={config.color}
            onChange={(e) => update({ color: e.target.value })}
            className="w-10 h-8 rounded border border-border bg-secondary cursor-pointer"
          />
          <span className="mono text-xs text-muted-foreground">{config.color.toUpperCase()}</span>
          <button
            onClick={() => update({ color: '#ffffff' })}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Native Colors */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground uppercase tracking-wider">Native Font Colors</Label>
            {isColorFont && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-accent/20 text-accent border border-accent/30 mono">
                DETECTED
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isColorFont ? 'Color glyphs found — enable for full color atlas' : 'Use font\'s built-in glyph colors'}
          </p>
        </div>
        <Switch
          checked={config.useNativeColors}
          disabled={!isColorFont}
          onCheckedChange={(v) => update({ useNativeColors: v })}
        />
      </div>

      {/* xadvance Offset */}
      <div className="space-y-2">
        <div className="flex justify-between">
          <Label className="text-xs text-muted-foreground uppercase tracking-wider">xadvance Offset</Label>
          <span className={`mono text-xs font-semibold ${config.xadvanceOffset > 0 ? 'text-accent' : config.xadvanceOffset < 0 ? 'text-destructive' : 'text-primary'}`}>
            {config.xadvanceOffset > 0 ? `+${config.xadvanceOffset}` : config.xadvanceOffset}px
          </span>
        </div>
        <Slider
          min={-20}
          max={20}
          step={1}
          value={[config.xadvanceOffset]}
          onValueChange={([v]) => update({ xadvanceOffset: v })}
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>-20px</span>
          <button
            onClick={() => update({ xadvanceOffset: 0 })}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Reset
          </button>
          <span>+20px</span>
        </div>
        <p className="text-xs text-muted-foreground">Adjusts every glyph's advance width for tighter or looser spacing.</p>
      </div>

      {/* Anti-aliasing */}
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-xs text-muted-foreground uppercase tracking-wider">Anti-aliasing</Label>
          <p className="text-xs text-muted-foreground mt-0.5">Smooth glyph edges</p>
        </div>
        <Switch
          checked={config.antialiasing}
          onCheckedChange={(v) => update({ antialiasing: v })}
        />
      </div>
    </div>
  );
}
