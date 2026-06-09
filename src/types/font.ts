export interface FontTableInfo {
  hasSVG: boolean;    // SVG color table
  hasGPOS: boolean;   // Glyph Positioning
  hasGSUB: boolean;   // Glyph Substitution (ligatures, alternates)
  hasOS2: boolean;    // OS/2 metrics/weight/embedding table
  hasCFF: boolean;    // CFF (PostScript outlines)
  hasCFF2: boolean;   // CFF2 (variable font PostScript outlines)
  hasCOLR: boolean;   // COLR/CPAL color layers
  hasCBDT: boolean;   // Bitmap color glyphs (CBDT/CBLC)
  hasSBIX: boolean;   // Apple bitmap color glyphs (sbix)
  rawTables: string[];
}

export interface CharGlyph {
  id: number;
  char: string;
  x: number;
  y: number;
  width: number;
  height: number;
  xoffset: number;
  yoffset: number;
  xadvance: number;
}

export interface KerningPair {
  first: number;
  second: number;
  amount: number;
}

export interface FontConversionConfig {
  fontSize: number;
  padding: number;
  extrude: number;
  spacing: number;
  atlasWidth: number;
  atlasHeight: number;
  charset: string;
  antialiasing: boolean;
  color: string;
  useNativeColors: boolean;
  referenceGlyphs: string;
}

export interface ConversionResult {
  fntContent: string;
  atlasDataUrl: string;
  glyphs: CharGlyph[];
  kernings: KerningPair[];
  fontName: string;
  lineHeight: number;
  base: number;
}

export const DEFAULT_CONFIG: FontConversionConfig = {
  fontSize: 32,
  padding: 2,
  extrude: 0,
  spacing: 1,
  atlasWidth: 512,
  atlasHeight: 512,
  charset: 'ASCII_PRINTABLE',
  antialiasing: true,
  color: '#ffffff',
  useNativeColors: false,
  referenceGlyphs: '',
};

export const CHARSETS: Record<string, string> = {
  ASCII_PRINTABLE: ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~',
  ALPHANUMERIC: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  UPPERCASE: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  LOWERCASE: 'abcdefghijklmnopqrstuvwxyz',
  DIGITS: '0123456789',
  EXTENDED: ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~€£¥©®™°±×÷',
};
