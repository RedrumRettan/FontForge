import { FontTableInfo } from '@/types/font';

// Dynamic import so the build doesn't fail when the WASM package isn't compiled yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _wasmModule: any = null;
async function loadWasm() {
  if (_wasmModule) return _wasmModule;
  _wasmModule = await import(/* @vite-ignore */ './wasm/pkg/font_native.js');
  await _wasmModule.default();
  return _wasmModule;
}

export interface NativeShapedGlyph {
  glyph_id: number;
  cluster: number;
  x_advance: number;
  y_advance: number;
  x_offset: number;
  y_offset: number;
}

export interface NativeGlyphBitmap {
  width: number;
  height: number;
  left: number;
  top: number;
  advance_width: number;
  renderer: 'colr_cpal' | 'svg' | 'embedded_bitmap' | 'outline';
  rgba: Uint8Array;
}

export async function createNativeFontEngine(fontData: Uint8Array): Promise<{
  getTableInfo(): FontTableInfo;
  resolveGlyphIndices(codepoints: number[]): number[];
  metrics(pxSize: number): { ascent: number; descent: number; line_gap: number };
  glyphMetrics(glyphId: number, pxSize: number): { advance_width: number; left_side_bearing: number };
  shape(text: string, pxSize: number): NativeShapedGlyph[];
  rasterizeGlyph(glyphId: number, pxSize: number, colorRgba: number): NativeGlyphBitmap;
}> {
  const wasm = await loadWasm();
  const engine = new wasm.NativeFontEngine(fontData);

  return {
    getTableInfo: () => engine.table_inventory() as FontTableInfo,
    resolveGlyphIndices: (codepoints: number[]) => engine.resolve_glyph_indices(codepoints),
    metrics: (pxSize: number) => engine.metrics(pxSize),
    glyphMetrics: (glyphId: number, pxSize: number) => engine.glyph_metrics(glyphId, pxSize),
    shape: (text: string, pxSize: number) => engine.shape(text, pxSize) as NativeShapedGlyph[],
    rasterizeGlyph: (glyphId: number, pxSize: number, colorRgba: number) => engine.rasterize_glyph(glyphId, pxSize, colorRgba),
  };
}
