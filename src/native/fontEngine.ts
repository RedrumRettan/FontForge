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
  rgba: Uint8Array;
}

interface NativeModule {
  NativeFontEngine: new (data: Uint8Array) => NativeFontEngine;
}

interface NativeFontEngine {
  table_inventory(): unknown;
  resolve_glyph_indices(codepoints: number[]): number[];
  metrics(pxSize: number): { ascent: number; descent: number; line_gap: number };
  glyph_metrics(glyphId: number, pxSize: number): { advance_width: number; left_side_bearing: number };
  shape(text: string, pxSize: number): NativeShapedGlyph[];
  rasterize_glyph(glyphId: number, pxSize: number, colorRgba: number): NativeGlyphBitmap;
}

let nativeModulePromise: Promise<NativeModule> | null = null;

async function loadModule(): Promise<NativeModule> {
  if (!nativeModulePromise) {
    nativeModulePromise = import('./wasm/pkg/font_native.js') as Promise<NativeModule>;
  }
  return nativeModulePromise;
}

export async function createNativeFontEngine(fontData: Uint8Array) {
  const mod = await loadModule();
  const engine = new mod.NativeFontEngine(fontData);

  return {
    getTableInfo(): FontTableInfo {
      const inventory = engine.table_inventory() as Record<string, unknown>;
      return {
        hasSVG: !!inventory.has_svg,
        hasGPOS: !!inventory.has_gpos,
        hasGSUB: !!inventory.has_gsub,
        hasOS2: !!inventory.has_os2,
        hasCFF: !!inventory.has_cff,
        hasCFF2: !!inventory.has_cff2,
        hasCOLR: !!inventory.has_colr || !!inventory.has_cpal,
        hasCBDT: !!inventory.has_cbdt || !!inventory.has_cblc,
        hasSBIX: !!inventory.has_sbix,
        rawTables: (inventory.raw_tables as string[]) ?? [],
      };
    },
    resolveGlyphIndices(codepoints: number[]): number[] {
      return engine.resolve_glyph_indices(codepoints);
    },
    metrics(pxSize: number) {
      return engine.metrics(pxSize);
    },
    glyphMetrics(glyphId: number, pxSize: number) {
      return engine.glyph_metrics(glyphId, pxSize);
    },
    shape(text: string, pxSize: number): NativeShapedGlyph[] {
      return engine.shape(text, pxSize);
    },
    rasterizeGlyph(glyphId: number, pxSize: number, colorRgba: number): NativeGlyphBitmap {
      return engine.rasterize_glyph(glyphId, pxSize, colorRgba);
    },
  };
}
