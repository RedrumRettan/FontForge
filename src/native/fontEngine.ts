import { FontTableInfo } from '@/types/font';
import init, { NativeFontEngine as WasmNativeFontEngine } from './wasm/pkg/font_native.js';

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
  await init();
  const engine = new WasmNativeFontEngine(fontData);

  return {
    getTableInfo: () => engine.table_inventory() as FontTableInfo,
    resolveGlyphIndices: (codepoints: number[]) => engine.resolve_glyph_indices(codepoints),
    metrics: (pxSize: number) => engine.metrics(pxSize),
    glyphMetrics: (glyphId: number, pxSize: number) => engine.glyph_metrics(glyphId, pxSize),
    shape: (text: string, pxSize: number) => engine.shape(text, pxSize) as NativeShapedGlyph[],
    rasterizeGlyph: (glyphId: number, pxSize: number, colorRgba: number) => engine.rasterize_glyph(glyphId, pxSize, colorRgba),
  };
}
