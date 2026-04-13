import { useState, useCallback, useRef } from 'react';
import { FontConversionConfig, ConversionResult, CharGlyph, CHARSETS, FontTableInfo } from '@/types/font';
import { createNativeFontEngine } from '@/native/fontEngine';

interface LoadedFont {
  name: string;
  file: File;
  objectUrl: string;
  isColorFont: boolean;
  tableInfo: FontTableInfo;
}

interface FontNativeEngine {
  getTableInfo(): FontTableInfo;
  resolveGlyphIndices(codepoints: number[]): number[];
  metrics(pxSize: number): { ascent: number; descent: number; line_gap: number };
  glyphMetrics(glyphId: number, pxSize: number): { advance_width: number; left_side_bearing: number };
  shape(text: string, pxSize: number): Array<{ glyph_id: number; cluster: number }>;
  rasterizeGlyph(glyphId: number, pxSize: number, colorRgba: number): {
    width: number;
    height: number;
    left: number;
    top: number;
    advance_width: number;
    rgba: Uint8Array;
  };
}

interface GlyphRender {
  imageData: ImageData;
  ascent: number;
  xoffset: number;
}

async function parseFontTables(file: File): Promise<FontTableInfo> {
  const empty: FontTableInfo = {
    hasSVG: false, hasGPOS: false, hasGSUB: false, hasOS2: false,
    hasCFF: false, hasCFF2: false, hasCOLR: false, hasCBDT: false, hasSBIX: false, rawTables: [],
  };
  try {
    const buffer = await file.arrayBuffer();
    const view = new DataView(buffer);
    if (buffer.byteLength < 12) return empty;

    const numTables = view.getUint16(4);
    const tableTags = new Set<string>();
    const rawTables: string[] = [];

    for (let i = 0; i < numTables; i++) {
      const base = 12 + i * 16;
      if (base + 4 > buffer.byteLength) break;
      const tag = String.fromCharCode(view.getUint8(base), view.getUint8(base + 1), view.getUint8(base + 2), view.getUint8(base + 3));
      tableTags.add(tag);
      rawTables.push(tag.trimEnd());
    }

    return {
      hasSVG: tableTags.has('SVG '),
      hasGPOS: tableTags.has('GPOS'),
      hasGSUB: tableTags.has('GSUB'),
      hasOS2: tableTags.has('OS/2'),
      hasCFF: tableTags.has('CFF '),
      hasCFF2: tableTags.has('CFF2'),
      hasCOLR: tableTags.has('COLR') || tableTags.has('CPAL'),
      hasCBDT: tableTags.has('CBDT') || tableTags.has('CBLC'),
      hasSBIX: tableTags.has('sbix'),
      rawTables,
    };
  } catch {
    return empty;
  }
}

function detectColorFont(fontFamily: string): boolean {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  ctx.font = `48px "${fontFamily}"`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('A', 8, 48);
  const { data } = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    if (a > 20) {
      const avg = (r + g + b) / 3;
      if (Math.abs(r - avg) > 15 || Math.abs(g - avg) > 15 || Math.abs(b - avg) > 15) return true;
    }
  }
  return false;
}

function colorToRgbaInt(color: string): number {
  const c = document.createElement('canvas').getContext('2d');
  if (!c) return 0xffffffff;
  c.fillStyle = color;
  const resolved = c.fillStyle;
  const m = /^#([0-9a-f]{6})$/i.exec(resolved);
  if (!m) return 0xffffffff;
  const hex = parseInt(m[1], 16);
  return ((hex << 8) | 0xff) >>> 0;
}

function cropGlyphFromCanvas(ctx: CanvasRenderingContext2D, cw: number, ch: number, drawX: number, drawY: number): GlyphRender | null {
  const { data } = ctx.getImageData(0, 0, cw, ch);
  let minX = cw, maxX = -1, minY = ch, maxY = -1;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const i = (y * cw + x) * 4;
      const a = data[i + 3];
      const hasInk = a > 6 || (a > 0 && (data[i] > 6 || data[i + 1] > 6 || data[i + 2] > 6));
      if (hasInk) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;
  return { imageData: ctx.getImageData(minX, minY, cropW, cropH), ascent: drawY - minY, xoffset: minX - drawX };
}

async function renderGlyph(char: string, fontFamily: string, fontSize: number, color: string, nativeColors: boolean): Promise<GlyphRender | null> {
  const margin = Math.ceil(fontSize * 1.5);
  const cw = Math.ceil(fontSize * 3);
  const ch = Math.ceil(fontSize * 3);
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const drawX = margin;
  const drawY = Math.round(ch * 0.6);
  ctx.clearRect(0, 0, cw, ch);
  ctx.font = `${fontSize}px "${fontFamily}"`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = nativeColors ? '#ffffff' : color;
  ctx.fillText(char, drawX, drawY);
  return cropGlyphFromCanvas(ctx, cw, ch, drawX, drawY);
}

export function useFontConverter() {
  const [loadedFont, setLoadedFont] = useState<LoadedFont | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fontFamilyRef = useRef<string | null>(null);
  const fontFaceRef = useRef<FontFace | null>(null);
  const nativeEngineRef = useRef<FontNativeEngine | null>(null);

  const ensureFontReady = useCallback(async (family: string, px: number) => {
    try {
      await document.fonts.load(`${px}px "${family}"`, 'Aa');
      await document.fonts.ready;
      return document.fonts.check(`${px}px "${family}"`, 'Aa');
    } catch {
      return false;
    }
  }, []);

  const loadFont = useCallback(async (file: File) => {
    setError(null);
    setResult(null);

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'ttf' && ext !== 'otf') {
      setError('Only TTF and OTF files are supported.');
      return false;
    }

    if (fontFaceRef.current) {
      try { document.fonts.delete(fontFaceRef.current); } catch {}
    }
    if (loadedFont?.objectUrl) URL.revokeObjectURL(loadedFont.objectUrl);

    const objectUrl = URL.createObjectURL(file);
    const fontFamily = `FF_${Date.now()}`;

    try {
      const fontData = new Uint8Array(await file.arrayBuffer());
      try {
        nativeEngineRef.current = await createNativeFontEngine(fontData);
      } catch (nativeErr) {
        console.warn('[FontForge] native engine unavailable, using JS fallback path', nativeErr);
        nativeEngineRef.current = null;
      }

      let ff: FontFace;
      try {
        ff = new FontFace(fontFamily, fontData.buffer);
      } catch {
        ff = new FontFace(fontFamily, `url(${objectUrl})`);
      }
      await ff.load();
      document.fonts.add(ff);
      fontFaceRef.current = ff;
      fontFamilyRef.current = fontFamily;

      const active = await ensureFontReady(fontFamily, 32);
      if (!active) throw new Error('FontFace loaded but browser did not activate it');

      const cleanName = file.name.replace(/\.(ttf|otf)$/i, '');
      const tableInfo = nativeEngineRef.current?.getTableInfo() ?? await parseFontTables(file);
      const isColorFont = tableInfo.hasSVG || tableInfo.hasCOLR || tableInfo.hasCBDT || tableInfo.hasSBIX || detectColorFont(fontFamily);

      setLoadedFont({ name: cleanName, file, objectUrl, isColorFont, tableInfo });
      return { fontFamily, isColorFont, tableInfo };
    } catch (e) {
      console.error('[FontForge] load error:', e);
      setError('Failed to load font data.');
      URL.revokeObjectURL(objectUrl);
      return false;
    }
  }, [loadedFont, ensureFontReady]);

  const convert = useCallback(async (config: FontConversionConfig) => {
    const fontFamily = fontFamilyRef.current;
    const fontName = loadedFont?.name;
    if (!fontFamily || !fontName) {
      setError('No font loaded.');
      return;
    }

    setIsConverting(true);
    setError(null);
    await new Promise(r => setTimeout(r, 20));

    try {
      const { fontSize, padding, spacing, atlasWidth, atlasHeight, color } = config;
      const chars = CHARSETS[config.charset] ?? config.charset;

      const active = await ensureFontReady(fontFamily, fontSize);
      if (!active) throw new Error(`Font "${fontFamily}" is not active for rendering`);

      const atlas = document.createElement('canvas');
      atlas.width = atlasWidth;
      atlas.height = atlasHeight;
      const actx = atlas.getContext('2d');
      if (!actx) throw new Error('No atlas 2D context available');
      actx.clearRect(0, 0, atlasWidth, atlasHeight);

      const glyphs: CharGlyph[] = [];
      let cx = padding;
      let cy = padding;

      const engine = nativeEngineRef.current;
      const rowGlyphs: Array<CharGlyph & { imageData?: ImageData }> = [];
      let globalAscent = 0;
      let globalDescent = 0;

      if (engine) {
        const codepoints = Array.from(chars).map((ch) => ch.codePointAt(0) ?? 0);
        const glyphIds = engine.resolveGlyphIndices(codepoints);
        const shapedByCluster = new Map<number, number>();
        engine.shape(chars, fontSize).forEach((g) => shapedByCluster.set(g.cluster, g.glyph_id));

        const fontMetrics = engine.metrics(fontSize);
        globalAscent = Math.round(Math.max(0, fontMetrics.ascent));
        globalDescent = Math.round(Math.abs(Math.min(0, fontMetrics.descent)));

        const rgbaColor = colorToRgbaInt(color);
        for (let i = 0; i < chars.length; i++) {
          const char = chars[i];
          const id = codepoints[i];
          const glyphId = shapedByCluster.get(i) ?? glyphIds[i] ?? 0;
          if (!glyphId) {
            rowGlyphs.push({ id, char, x: 0, y: 0, width: 0, height: 0, xoffset: 0, yoffset: 0, xadvance: 0 });
            continue;
          }
          const gm = engine.glyphMetrics(glyphId, fontSize);
          const bitmap = engine.rasterizeGlyph(glyphId, fontSize, rgbaColor);
          const imageData = bitmap.width > 0 && bitmap.height > 0
            ? new ImageData(new Uint8ClampedArray(bitmap.rgba), bitmap.width, bitmap.height)
            : undefined;

          rowGlyphs.push({
            id, char, x: 0, y: 0,
            width: bitmap.width,
            height: bitmap.height,
            xoffset: bitmap.left,
            yoffset: globalAscent - bitmap.top,
            xadvance: Math.round(gm.advance_width),
            imageData,
          });
        }
      } else {
        const measureCanvas = document.createElement('canvas');
        const mCtx = measureCanvas.getContext('2d');
        if (!mCtx) throw new Error('No measure context available');
        mCtx.font = `${fontSize}px "${fontFamily}"`;

        for (const char of chars) {
          const render = await renderGlyph(char, fontFamily, fontSize, color, useNativeColors);
          const xadvance = Math.round(mCtx.measureText(char).width);
          if (render) {
            globalAscent = Math.max(globalAscent, render.ascent);
            globalDescent = Math.max(globalDescent, render.imageData.height - render.ascent);
          }
          rowGlyphs.push({
            id: char.codePointAt(0) ?? 0,
            char,
            x: 0,
            y: 0,
            width: render?.imageData.width ?? 0,
            height: render?.imageData.height ?? 0,
            xoffset: render?.xoffset ?? 0,
            yoffset: 0,
            xadvance,
            imageData: render?.imageData,
          });
        }
      }

      const lineHeight = globalAscent + globalDescent + 1;
      const base = globalAscent;
      const rowH = lineHeight + padding * 2;

      for (const g of rowGlyphs) {
        const cellW = g.width + padding * 2;
        if (cx + cellW > atlasWidth - padding) {
          cx = padding;
          cy += rowH + spacing;
        }
        if (cy + rowH > atlasHeight) {
          glyphs.push({ ...g, x: 0, y: 0, width: 0, height: 0 });
          continue;
        }

        const atlasX = cx + padding;
        const atlasY = cy + padding + g.yoffset;

        if (g.imageData && g.width > 0 && g.height > 0) actx.putImageData(g.imageData, atlasX, atlasY);

        glyphs.push({
          ...g,
          x: atlasX,
          y: atlasY,
          yoffset: g.yoffset,
        });

        cx += cellW + spacing;
      }

      const lines: string[] = [];
      lines.push(`info face="${fontName}" size=${fontSize} bold=0 italic=0 charset="" unicode=1 stretchH=100 smooth=1 aa=1 padding=${padding},${padding},${padding},${padding} spacing=${spacing},${spacing}`);
      lines.push(`common lineHeight=${lineHeight} base=${base} scaleW=${atlasWidth} scaleH=${atlasHeight} pages=1 packed=0`);
      lines.push(`page id=0 file="${fontName}_0.png"`);
      lines.push(`chars count=${glyphs.length}`);
      for (const g of glyphs) lines.push(`char id=${g.id} x=${g.x} y=${g.y} width=${g.width} height=${g.height} xoffset=${g.xoffset} yoffset=${g.yoffset} xadvance=${g.xadvance} page=0 chnl=15`);

      setResult({ fntContent: lines.join('\n'), atlasDataUrl: atlas.toDataURL('image/png'), glyphs, fontName, lineHeight, base });
    } catch (e) {
      console.error('[FontForge] convert error:', e);
      setError('Conversion failed — check native module availability and console logs.');
    } finally {
      setIsConverting(false);
    }
  }, [loadedFont, ensureFontReady]);

  const downloadFnt = useCallback(() => {
    if (!result) return;
    const blob = new Blob([result.fntContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${result.fontName}.fnt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [result]);

  const downloadAtlas = useCallback(() => {
    if (!result) return;
    const a = document.createElement('a');
    a.href = result.atlasDataUrl;
    a.download = `${result.fontName}_0.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [result]);

  const downloadZip = useCallback(() => {
    if (!result) return;
    downloadFnt();
    setTimeout(downloadAtlas, 350);
  }, [result, downloadFnt, downloadAtlas]);

  return { loadedFont, isConverting, result, error, loadFont, convert, downloadFnt, downloadAtlas, downloadZip, previewFontFamily: fontFamilyRef.current };
}
