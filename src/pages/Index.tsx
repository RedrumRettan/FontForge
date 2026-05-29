import { useState } from 'react';
import { Header } from '@/components/layout/Header';
import { DropZone } from '@/components/features/DropZone';
import { ConfigPanel } from '@/components/features/ConfigPanel';
import { OutputPanel } from '@/components/features/OutputPanel';
import { GlyphPreview } from '@/components/features/GlyphPreview';
import { useFontConverter } from '@/hooks/useFontConverter';
import { DEFAULT_CONFIG, FontConversionConfig, CHARSETS, FontTableInfo } from '@/types/font';
import { Button } from '@/components/ui/button';
import { AlertCircle, Zap, ChevronRight, FileCode, Image as ImageIcon, Layers } from 'lucide-react';
import heroBanner from '@/assets/hero-banner.png';

const TABLE_LABELS: { key: keyof FontTableInfo; label: string; description: string; color: string }[] = [
  { key: 'hasSVG',  label: 'SVG',  description: 'SVG color glyphs (SVG table)',           color: 'text-pink-400 border-pink-400/30 bg-pink-400/10' },
  { key: 'hasCOLR', label: 'COLR', description: 'Color layers (COLR/CPAL tables)',          color: 'text-purple-400 border-purple-400/30 bg-purple-400/10' },
  { key: 'hasCBDT', label: 'CBDT', description: 'Bitmap color glyphs (CBDT/CBLC tables)',   color: 'text-fuchsia-400 border-fuchsia-400/30 bg-fuchsia-400/10' },
  { key: 'hasSBIX', label: 'sbix', description: 'Apple bitmap color glyphs (sbix table)',    color: 'text-rose-400 border-rose-400/30 bg-rose-400/10' },
  { key: 'hasGPOS', label: 'GPOS', description: 'Glyph positioning & kerning (GPOS table)', color: 'text-sky-400 border-sky-400/30 bg-sky-400/10' },
  { key: 'hasGSUB', label: 'GSUB', description: 'Glyph substitution & ligatures (GSUB table)', color: 'text-amber-400 border-amber-400/30 bg-amber-400/10' },
  { key: 'hasOS2',  label: 'OS/2', description: 'OpenType metrics & style data (OS/2 table)', color: 'text-indigo-400 border-indigo-400/30 bg-indigo-400/10' },
  { key: 'hasCFF',  label: 'CFF',  description: 'PostScript/CFF outlines (CFF table)',      color: 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10' },
  { key: 'hasCFF2', label: 'CFF2', description: 'Variable CFF outlines (CFF2 table)',       color: 'text-teal-400 border-teal-400/30 bg-teal-400/10' },
];

function FontTableBadges({ info }: { info: FontTableInfo }) {
  const active = TABLE_LABELS.filter(t => info[t.key]);
  if (active.length === 0) {
    return (
      <p className="text-xs text-muted-foreground mono">
        No advanced tables detected (plain TrueType outlines)
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {active.map(t => (
        <span
          key={t.key}
          title={t.description}
          className={`px-2 py-0.5 rounded border text-[11px] font-semibold mono cursor-help ${t.color}`}
        >
          {t.label}
        </span>
      ))}
    </div>
  );
}

const Index = () => {
  const [config, setConfig] = useState<FontConversionConfig>(DEFAULT_CONFIG);
  const [isColorFont, setIsColorFont] = useState(false);
  const [tableInfo, setTableInfo] = useState<FontTableInfo | null>(null);
  const {
    loadedFont,
    referenceFnt,
    isConverting,
    result,
    error,
    loadFont,
    loadReferenceFnt,
    clearReferenceFnt,
    convert,
    downloadFnt,
    downloadAtlas,
    downloadZip,
    updateOutputName,
    previewFontFamily,
  } = useFontConverter();

  const handleFileSelected = async (file: File) => {
    const res = await loadFont(file);
    if (res && typeof res === 'object' && 'isColorFont' in res) {
      setIsColorFont(res.isColorFont);
      setTableInfo(res.tableInfo);
      setConfig(prev => ({ ...prev, useNativeColors: res.isColorFont ? true : false }));
    }
  };

  const handleReferenceFntSelected = async (file: File | undefined) => {
    if (file) await loadReferenceFnt(file);
  };

  const handleConvert = () => {
    convert(config);
  };

  const charCount = referenceFnt?.glyphs.length ?? CHARSETS[config.charset]?.length ?? config.charset.length;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />

      {/* Hero */}
      {!result && !loadedFont && (
        <div className="relative overflow-hidden border-b border-border">
          <img
            src={heroBanner}
            alt="FontForge banner"
            className="w-full object-cover h-40 sm:h-52 opacity-60"
          />
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-r from-background/80 via-background/60 to-background/80">
            <div className="text-center px-4">
              <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">
                TTF / OTF <span className="text-primary">→</span> BMFont Converter
              </h1>
              <p className="text-sm text-muted-foreground max-w-lg mx-auto">
                Convert your TrueType or OpenType fonts into the BMFont format for game engines, renderers, and embedded systems. Runs entirely in your browser — no uploads.
              </p>
              <div className="flex items-center justify-center gap-4 mt-3">
                {[
                  { icon: FileCode, label: '.fnt metadata' },
                  { icon: ImageIcon, label: 'PNG texture atlas' },
                  { icon: Layers, label: 'Glyph packing' },
                ].map(({ icon: Icon, label }) => (
                  <div key={label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Icon className="w-3.5 h-3.5 text-primary" />
                    <span>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">

          {/* Left column */}
          <div className="space-y-6">
            {/* Step 1: Upload */}
            <section className="bg-card rounded-xl border border-border p-6">
              <div className="flex items-center gap-2 mb-4">
                <span className="w-6 h-6 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center text-xs font-bold text-primary mono">1</span>
                <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Load Font</h2>
              </div>
              <DropZone
                onFileSelected={handleFileSelected}
                loadedFontName={loadedFont?.name ?? null}
              />

              {/* Font table info */}
              {tableInfo && (
                <div className="mt-4 pt-4 border-t border-border">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Detected OpenType Tables</p>
                  <FontTableBadges info={tableInfo} />
                  {tableInfo.rawTables.length > 0 && (
                    <p className="text-xs text-muted-foreground mono mt-2">
                      All tables: {tableInfo.rawTables.join(', ')}
                    </p>
                  )}
                </div>
              )}
            </section>

            {/* Step 2: Configure + Convert */}
            {loadedFont && (
              <section className="bg-card rounded-xl border border-border p-6">
                <div className="flex items-center gap-2 mb-4">
                  <span className="w-6 h-6 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center text-xs font-bold text-primary mono">2</span>
                  <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Configure & Convert</h2>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-[1fr_200px] gap-6 items-end">
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mono">
                      <span className="text-foreground font-medium">{loadedFont.name}</span>
                      <span>·</span>
                      <span>{config.fontSize}px</span>
                      <span>·</span>
                      <span>{charCount} chars</span>
                      <span>·</span>
                      <span>{referenceFnt ? `${referenceFnt.scaleW}×${referenceFnt.scaleH} reference atlas` : `${config.atlasWidth}×${config.atlasHeight} atlas`}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Configure settings in the panel on the right, then click Convert.
                    </p>

                    <div className="mt-4 rounded-lg border border-border bg-secondary/50 p-3 space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs text-muted-foreground uppercase tracking-wider">Reference .fnt Layout</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            Optional: place the generated PNG pixels into an existing BMFont layout.
                          </p>
                        </div>
                        {referenceFnt && (
                          <button
                            type="button"
                            onClick={clearReferenceFnt}
                            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                      <input
                        type="file"
                        accept=".fnt"
                        onChange={(e) => handleReferenceFntSelected(e.target.files?.[0])}
                        className="block w-full text-xs text-muted-foreground file:mr-3 file:rounded file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-primary-foreground hover:file:bg-primary/90"
                      />
                      {referenceFnt && (
                        <p className="text-xs text-primary mono">
                          {referenceFnt.name}.fnt · {referenceFnt.glyphs.length} chars · {referenceFnt.scaleW}×{referenceFnt.scaleH}
                        </p>
                      )}
                    </div>
                  </div>

                  <Button
                    onClick={handleConvert}
                    disabled={isConverting}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 font-semibold gap-2 h-11 w-full glow-green"
                  >
                    {isConverting ? (
                      <>
                        <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                        Converting…
                      </>
                    ) : (
                      <>
                        <Zap className="w-4 h-4" />
                        Convert
                        <ChevronRight className="w-4 h-4" />
                      </>
                    )}
                  </Button>
                </div>
              </section>
            )}

            {/* Error */}
            {error && (
              <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4 flex gap-3">
                <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-destructive">Conversion Error</p>
                  <p className="text-xs text-destructive/80 mt-0.5">{error}</p>
                </div>
              </div>
            )}

            {/* Step 3: Glyph Preview */}
            {result && loadedFont && (
              <section className="bg-card rounded-xl border border-border p-6">
                <div className="flex items-center gap-2 mb-4">
                  <span className="w-6 h-6 rounded-full bg-accent/20 border border-accent/40 flex items-center justify-center text-xs font-bold text-accent mono">3</span>
                  <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Preview</h2>
                </div>
                <GlyphPreview
                  result={result}
                  fontFamily={previewFontFamily ?? loadedFont.name}
                  fontSize={config.fontSize}
                />
              </section>
            )}

            {/* Step 4: Output */}
            {result && (
              <section className="bg-card rounded-xl border border-border p-6">
                <div className="flex items-center gap-2 mb-4">
                  <span className="w-6 h-6 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center text-xs font-bold text-primary mono">4</span>
                  <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Download Output</h2>
                </div>
                <OutputPanel
                  result={result}
                  onDownloadFnt={downloadFnt}
                  onDownloadAtlas={downloadAtlas}
                  onDownloadBoth={downloadZip}
                  onOutputNameChange={updateOutputName}
                />
              </section>
            )}

            {/* How it works — shown when nothing loaded */}
            {!loadedFont && (
              <section className="bg-card rounded-xl border border-border p-6">
                <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-4">How it works</h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {[
                    { step: '01', title: 'Drop your font', body: 'Upload any TTF or OTF font file. The file never leaves your browser.' },
                    { step: '02', title: 'Configure', body: 'Choose font size, atlas dimensions, padding, character set, and glyph color.' },
                    { step: '03', title: 'Export', body: 'Download the .fnt metadata and .png texture atlas ready for your game engine.' },
                  ].map(({ step, title, body }) => (
                    <div key={step} className="space-y-2">
                      <span className="mono text-3xl font-bold text-border">{step}</span>
                      <h3 className="font-semibold text-sm text-foreground">{title}</h3>
                      <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-6 pt-5 border-t border-border">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Compatible with</p>
                  <div className="flex flex-wrap gap-2">
                    {['LibGDX', 'Phaser 3', 'LÖVE2D', 'Godot (GDFont)', 'OpenGL renderers', 'Custom engines'].map(e => (
                      <span key={e} className="px-2.5 py-1 bg-secondary border border-border rounded text-xs mono text-muted-foreground">
                        {e}
                      </span>
                    ))}
                  </div>
                </div>
              </section>
            )}
          </div>

          {/* Right column — Config panel */}
          <div className="lg:sticky lg:top-[56px] lg:self-start">
            <div className="bg-card rounded-xl border border-border p-5">
              <ConfigPanel config={config} onChange={setConfig} isColorFont={isColorFont} />
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-border py-4 text-center">
        <p className="text-xs text-muted-foreground mono">
          FontForge · Client-side · No data stored or transmitted
        </p>
      </footer>
    </div>
  );
};

export default Index;
