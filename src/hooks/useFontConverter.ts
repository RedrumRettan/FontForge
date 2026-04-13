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
    if (loadedFont?.objectUrl) {
      URL.revokeObjectURL(loadedFont.objectUrl);
    }

    const objectUrl = URL.createObjectURL(file);
    const fontFamily = `FF_${Date.now()}`;

    try {
      const fontData = new Uint8Array(await file.arrayBuffer());
      nativeEngineRef.current = await createNativeFontEngine(fontData);

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
      const tableInfo = nativeEngineRef.current.getTableInfo();
      const isColorFont = tableInfo.hasSVG || tableInfo.hasCOLR || tableInfo.hasCBDT || tableInfo.hasSBIX;

      setLoadedFont({ name: cleanName, file, objectUrl, isColorFont, tableInfo });
      return { fontFamily, isColorFont, tableInfo };
    } catch (e) {
      console.error('[FontForge] load error:', e);
      setError('Failed to load native font engine or font data.');
      URL.revokeObjectURL(objectUrl);
      return false;
    }
  }, [loadedFont, ensureFontReady]);

  const convert = useCallback(async (config: FontConversionConfig) => {
    const fontFamily = fontFamilyRef.current;
    const fontName = loadedFont?.name;
    const engine = nativeEngineRef.current;

    if (!fontFamily || !fontName || !engine) {
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

      const codepoints = Array.from(chars).map((ch) => ch.codePointAt(0) ?? 0);
      const glyphIds = engine.resolveGlyphIndices(codepoints);
      const shaped = engine.shape(chars, fontSize);
      const shapedByCluster = new Map<number, number>();
      shaped.forEach((g) => shapedByCluster.set(g.cluster, g.glyph_id));

      const fontMetrics = engine.metrics(fontSize);
      const globalAscent = Math.round(Math.max(0, fontMetrics.ascent));
      const globalDescent = Math.round(Math.abs(Math.min(0, fontMetrics.descent)));
      const lineHeight = Math.round(globalAscent + globalDescent + fontMetrics.line_gap);
      const base = globalAscent;

      const atlas = document.createElement('canvas');
      atlas.width = atlasWidth;
      atlas.height = atlasHeight;
      const actx = atlas.getContext('2d');
      if (!actx) throw new Error('No atlas 2D context available');
      actx.clearRect(0, 0, atlasWidth, atlasHeight);

      const glyphs: CharGlyph[] = [];
      let cx = padding;
      let cy = padding;
      const rowH = lineHeight + padding * 2;
      const rgbaColor = colorToRgbaInt(color);

      for (let i = 0; i < chars.length; i++) {
        const char = chars[i];
        const id = codepoints[i];
        const glyphId = shapedByCluster.get(i) ?? glyphIds[i] ?? 0;

        if (!glyphId) {
          glyphs.push({ id, char, x: 0, y: 0, width: 0, height: 0, xoffset: 0, yoffset: 0, xadvance: 0 });
          continue;
        }

        const gm = engine.glyphMetrics(glyphId, fontSize);
        const bitmap = engine.rasterizeGlyph(glyphId, fontSize, rgbaColor);

        const gw = bitmap.width;
        const gh = bitmap.height;
        const cellW = gw + padding * 2;

        if (cx + cellW > atlasWidth - padding) {
          cx = padding;
          cy += rowH + spacing;
        }

        if (cy + rowH > atlasHeight) {
          glyphs.push({ id, char, x: 0, y: 0, width: 0, height: 0, xoffset: 0, yoffset: 0, xadvance: Math.round(gm.advance_width) });
          continue;
        }

        const atlasX = cx + padding;
        const atlasY = cy + padding + (base - bitmap.top);

        if (gw > 0 && gh > 0) {
          const imageData = new ImageData(new Uint8ClampedArray(bitmap.rgba), gw, gh);
          actx.putImageData(imageData, atlasX, atlasY);
        }

        glyphs.push({
          id,
          char,
          x: atlasX,
          y: atlasY,
          width: gw,
          height: gh,
          xoffset: bitmap.left,
          yoffset: base - bitmap.top,
          xadvance: Math.round(gm.advance_width),
        });

        cx += cellW + spacing;
      }

      const lines: string[] = [];
      lines.push(
        `info face="${fontName}" size=${fontSize} bold=0 italic=0 charset="" unicode=1 stretchH=100 smooth=1 aa=1` +
        ` padding=${padding},${padding},${padding},${padding} spacing=${spacing},${spacing}`,
      );
      lines.push(`common lineHeight=${lineHeight} base=${base} scaleW=${atlasWidth} scaleH=${atlasHeight} pages=1 packed=0`);
      lines.push(`page id=0 file="${fontName}_0.png"`);
      lines.push(`chars count=${glyphs.length}`);

      for (const g of glyphs) {
        lines.push(
          `char id=${g.id} x=${g.x} y=${g.y} width=${g.width} height=${g.height} xoffset=${g.xoffset} yoffset=${g.yoffset} xadvance=${g.xadvance} page=0 chnl=15`,
        );
      }

      setResult({
        fntContent: lines.join('\n'),
        atlasDataUrl: atlas.toDataURL('image/png'),
        glyphs,
        fontName,
        lineHeight,
        base,
      });
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

  return {
    loadedFont,
    isConverting,
    result,
    error,
    loadFont,
    convert,
    downloadFnt,
    downloadAtlas,
    downloadZip,
    previewFontFamily: fontFamilyRef.current,
  };
}
