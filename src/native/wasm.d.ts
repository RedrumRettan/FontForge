declare module './wasm/pkg/font_native.js' {
  export class NativeFontEngine {
    constructor(data: Uint8Array);
    table_inventory(): unknown;
    resolve_glyph_indices(codepoints: number[]): number[];
    metrics(pxSize: number): { ascent: number; descent: number; line_gap: number };
    glyph_metrics(glyphId: number, pxSize: number): { advance_width: number; left_side_bearing: number };
    shape(text: string, pxSize: number): Array<{ glyph_id: number; cluster: number }>;
    rasterize_glyph(glyphId: number, pxSize: number, colorRgba: number): {
      width: number;
      height: number;
      left: number;
      top: number;
      advance_width: number;
      rgba: Uint8Array;
    };
  }
}
