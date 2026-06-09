/**
 * Native font engine stub.
 *
 * The WASM build artefact (`./wasm/pkg/font_native.js`) is not bundled in this
 * project, so every call here throws immediately. The converter hook catches
 * the rejection and falls back to the fully-functional canvas-based pipeline.
 */

import { FontTableInfo } from '@/types/font';

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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function createNativeFontEngine(_fontData: Uint8Array): Promise<{
  getTableInfo(): FontTableInfo;
  resolveGlyphIndices(codepoints: number[]): number[];
  metrics(pxSize: number): { ascent: number; descent: number; line_gap: number };
  glyphMetrics(glyphId: number, pxSize: number): { advance_width: number; left_side_bearing: number };
  shape(text: string, pxSize: number): NativeShapedGlyph[];
  rasterizeGlyph(glyphId: number, pxSize: number, colorRgba: number): NativeGlyphBitmap;
}> {
  throw new Error('Native WASM engine not available — canvas fallback will be used.');
}
