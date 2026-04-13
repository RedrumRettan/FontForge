import { useState, useCallback, useRef } from 'react';
import { FontConversionConfig, ConversionResult, CharGlyph, CHARSETS, FontTableInfo } from '@/types/font';

interface LoadedFont {
  name: string;
  file: File;
  objectUrl: string;
  isColorFont: boolean;
  tableInfo: FontTableInfo;
}

// ─── Binary table parser ──────────────────────────────────────────────────────

async function parseFontTables(file: File): Promise<FontTableInfo> {
  const empty: FontTableInfo = {
    hasSVG: false, hasGPOS: false, hasGSUB: false,
    hasCFF: false, hasCFF2: false, hasCOLR: false, rawTables: [],
  };
  try {
    const buffer = await file.arrayBuffer();
    const view = new DataView(buffer);
    if (buffer.byteLength < 12) return empty;

    const numTables = view.getUint16(4);
    const rawTables: string[] = [];

    for (let i = 0; i < numTables; i++) {
      const base = 12 + i * 16;
      if (base + 4 > buffer.byteLength) break;
      const tag = String.fromCharCode(
        view.getUint8(base),
        view.getUint8(base + 1),
        view.getUint8(base + 2),
        view.getUint8(base + 3),
      );
      rawTables.push(tag.trimEnd());
    }

    console.log('[FontForge] tables:', rawTables.join(', '));

    return {
      hasSVG:  rawTables.includes('SVG '),
      hasGPOS: rawTables.includes('GPOS'),
      hasGSUB: rawTables.includes('GSUB'),
      hasCFF:  rawTables.includes('CFF '),
      hasCFF2: rawTables.includes('CFF2'),
      hasCOLR: rawTables.includes('COLR'),
      rawTables,
    };
  } catch (e) {
    console.warn('[FontForge] table parse failed:', e);
    return empty;
  }
}

// ─── Color font detection ─────────────────────────────────────────────────────

function detectColorFont(fontFamily: string): boolean {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.font = `48px "${fontFamily}"`;
  ctx.textBaseline = 'alphabetic';
  // Don't set fillStyle — let native colors render
  ctx.fillText('A', 8, 48);
  const { data } = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b, a] = [data[i], data[i+1], data[i+2], data[i+3]];
    if (a > 20) {
      const avg = (r + g + b) / 3;
      if (Math.abs(r - avg) > 15 || Math.abs(g - avg) > 15 || Math.abs(b - avg) > 15) {
        return true;
      }
    }
  }
  return false;
}

// ─── Single-glyph renderer ────────────────────────────────────────────────────

interface GlyphRender {
  imageData: ImageData;  // tight crop of just the ink pixels
  ascent: number;        // pixels above baseline in the crop
  xoffset: number;       // pixels the crop starts to the right of the draw point (can be negative)
}

function renderGlyph(
  char: string,
  fontFamily: string,
  fontSize: number,
  color: string,
  nativeColors: boolean,
): GlyphRender | null {
  // Oversized canvas so glyphs with extreme descenders/ascenders fit
  const margin = Math.ceil(fontSize * 1.5);
  const cw = Math.ceil(fontSize * 3);
  const ch = Math.ceil(fontSize * 3);

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  // Baseline sits at 60% down so there's room for ascenders and descenders
  const drawX = margin;
  const drawY = Math.round(ch * 0.6);

  ctx.clearRect(0, 0, cw, ch);
  ctx.font = `${fontSize}px "${fontFamily}"`;
  ctx.textBaseline = 'alphabetic';

  if (!nativeColors) {
    ctx.fillStyle = color;
  }
  // When nativeColors=true, leave fillStyle at default black — the browser
  // uses the font's embedded color tables automatically.

  ctx.fillText(char, drawX, drawY);

  // Scan for any ink pixel (alpha OR non-zero RGB for color fonts)
  const { data } = ctx.getImageData(0, 0, cw, ch);
  let minX = cw, maxX = -1, minY = ch, maxY = -1;

  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const i = (y * cw + x) * 4;
      const a = data[i + 3];
      // For color fonts: some pixels have r/g/b but low alpha due to
      // premultiplied alpha or compositing — use a combined check
      const hasInk = a > 6;
      if (hasInk) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) return null; // invisible char (e.g. space)

  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;
  const cropped = ctx.getImageData(minX, minY, cropW, cropH);

  return {
    imageData: cropped,
    ascent: drawY - minY,   // how many px above the baseline the top of the crop sits
    xoffset: minX - drawX,  // how far right (or left if negative) from nominal draw point
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useFontConverter() {
  const [loadedFont, setLoadedFont] = useState<LoadedFont | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Store the FontFace family name (string) so we never capture a stale ref
  const fontFamilyRef = useRef<string | null>(null);
  const fontFaceRef = useRef<FontFace | null>(null);

  // ── Load ──────────────────────────────────────────────────────────────────

  const loadFont = useCallback(async (file: File) => {
    setError(null);
    setResult(null);

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'ttf' && ext !== 'otf') {
      setError('Only TTF and OTF files are supported.');
      return false;
    }

    // Clean up previous font
    if (fontFaceRef.current) {
      try { document.fonts.delete(fontFaceRef.current); } catch {}
    }
    if (loadedFont?.objectUrl) {
      URL.revokeObjectURL(loadedFont.objectUrl);
    }

    const objectUrl = URL.createObjectURL(file);
    const fontFamily = `FF_${Date.now()}`;

    try {
      const ff = new FontFace(fontFamily, `url(${objectUrl})`);
      await ff.load();
      document.fonts.add(ff);
      fontFaceRef.current = ff;
      fontFamilyRef.current = fontFamily;

      const cleanName = file.name.replace(/\.(ttf|otf)$/i, '');

      const [tableInfo, isColorByPixel] = await Promise.all([
        parseFontTables(file),
        Promise.resolve(detectColorFont(fontFamily)),
      ]);

      const isColorFont = isColorByPixel || tableInfo.hasSVG || tableInfo.hasCOLR;
      console.log('[FontForge] loaded:', cleanName, 'color:', isColorFont, 'tables:', tableInfo.rawTables.join(', '));

      setLoadedFont({ name: cleanName, file, objectUrl, isColorFont, tableInfo });
      return { fontFamily, isColorFont, tableInfo };
    } catch (e) {
      console.error('[FontForge] load error:', e);
      setError('Failed to load font. Make sure it is a valid TTF/OTF file.');
      URL.revokeObjectURL(objectUrl);
      return false;
    }
  }, [loadedFont]);

  // ── Convert ───────────────────────────────────────────────────────────────

  const convert = useCallback(async (config: FontConversionConfig) => {
    const fontFamily = fontFamilyRef.current;
    const fontName = loadedFont?.name;

    if (!fontFamily || !fontName) {
      setError('No font loaded.');
      return;
    }

    setIsConverting(true);
    setError(null);

    // Yield to React so the spinner shows
    await new Promise(r => setTimeout(r, 20));

    try {
      const { fontSize, padding, spacing, atlasWidth, atlasHeight, color, useNativeColors } = config;
      const chars = CHARSETS[config.charset] ?? config.charset;

      // ── 1. Render every glyph and collect global metrics ──────────────────

      // Use a shared measure canvas for xadvance (faster than metrics per glyph)
      const measureCanvas = document.createElement('canvas');
      const mCtx = measureCanvas.getContext('2d')!;
      mCtx.font = `${fontSize}px "${fontFamily}"`;

      interface RenderEntry {
        char: string;
        id: number;
        render: GlyphRender | null;
        xadvance: number;
      }

      const entries: RenderEntry[] = [];
      let globalAscent = 0;   // max pixels above baseline across all glyphs
      let globalDescent = 0;  // max pixels below baseline

      for (const char of chars) {
        const render = renderGlyph(char, fontFamily, fontSize, color, useNativeColors);
        const xadvance = Math.round(mCtx.measureText(char).width);

        if (render) {
          globalAscent  = Math.max(globalAscent,  render.ascent);
          // descent = crop height - ascent  (pixels below baseline in the crop)
          globalDescent = Math.max(globalDescent, render.imageData.height - render.ascent);
        }

        entries.push({ char, id: char.charCodeAt(0), render, xadvance });
      }

      // Add 1px slack so descenders don't clip
      const lineHeight = globalAscent + globalDescent + 1;
      const base = globalAscent;

      console.log(`[FontForge] lineHeight=${lineHeight} base=${base} (ascent=${globalAscent} descent=${globalDescent})`);

      // ── 2. Pack glyphs into the atlas canvas ──────────────────────────────

      const atlas = document.createElement('canvas');
      atlas.width  = atlasWidth;
      atlas.height = atlasHeight;
      const actx = atlas.getContext('2d')!;
      actx.clearRect(0, 0, atlasWidth, atlasHeight);

      const glyphs: CharGlyph[] = [];
      let cx = padding;   // cursor x
      let cy = padding;   // cursor y (top of current row)

      // Each row is tall enough to hold the tallest glyph + padding on both sides
      const rowH = lineHeight + padding * 2;

      for (const { char, id, render, xadvance } of entries) {
        if (!render) {
          // Invisible char (space, zero-width, etc.) — emit with zero size
          glyphs.push({ id, char, x: 0, y: 0, width: 0, height: 0, xoffset: 0, yoffset: 0, xadvance });
          continue;
        }

        const gw = render.imageData.width;
        const gh = render.imageData.height;

        // Cell width = glyph pixels + padding on each side
        const cellW = gw + padding * 2;

        // Wrap to next row if needed
        if (cx + cellW > atlasWidth - padding) {
          cx = padding;
          cy += rowH + spacing;
        }

        if (cy + rowH > atlasHeight) {
          console.warn(`[FontForge] atlas full — '${char}' skipped`);
          // Still push the glyph with 0 coords so the FNT char count is accurate
          glyphs.push({ id, char, x: 0, y: 0, width: 0, height: 0, xoffset: 0, yoffset: 0, xadvance });
          continue;
        }

        // Where this glyph's pixels land in the atlas
        const atlasX = cx + padding;
        // Vertically align glyphs to a shared baseline:
        // top of cell + padding + (globalAscent - this glyph's ascent)
        const atlasY = cy + padding + (globalAscent - render.ascent);

        actx.putImageData(render.imageData, atlasX, atlasY);

        glyphs.push({
          id,
          char,
          x: atlasX,
          y: atlasY,
          width:  gw,
          height: gh,
          // xoffset: shift applied by the renderer when drawing from cursor
          // If the glyph pixels start to the right of the draw point, xoffset > 0
          xoffset: render.xoffset,
          // yoffset: distance from the top of the line to the top of the glyph crop
          yoffset: globalAscent - render.ascent,
          xadvance,
        });

        cx += cellW + spacing;
      }

      // ── 3. Generate the .fnt text ─────────────────────────────────────────

      const lines: string[] = [];
      lines.push(
        `info face="${fontName}" size=${fontSize} bold=0 italic=0 charset="" unicode=1 stretchH=100 smooth=1 aa=1` +
        ` padding=${padding},${padding},${padding},${padding} spacing=${spacing},${spacing}`
      );
      lines.push(
        `common lineHeight=${lineHeight} base=${base} scaleW=${atlasWidth} scaleH=${atlasHeight} pages=1 packed=0`
      );
      lines.push(`page id=0 file="${fontName}_0.png"`);
      lines.push(`chars count=${glyphs.length}`);

      for (const g of glyphs) {
        lines.push(
          `char id=${g.id} ` +
          `x=${g.x} y=${g.y} ` +
          `width=${g.width} height=${g.height} ` +
          `xoffset=${g.xoffset} yoffset=${g.yoffset} ` +
          `xadvance=${g.xadvance} page=0 chnl=15`
        );
      }

      const fntContent = lines.join('\n');
      const atlasDataUrl = atlas.toDataURL('image/png');

      const packed = glyphs.filter(g => g.width > 0).length;
      console.log(`[FontForge] done — ${packed}/${glyphs.length} glyphs packed`);

      setResult({ fntContent, atlasDataUrl, glyphs, fontName, lineHeight, base });
    } catch (e) {
      console.error('[FontForge] convert error:', e);
      setError('Conversion failed — check the browser console for details.');
    } finally {
      setIsConverting(false);
    }
  }, [loadedFont]);

  // ── Downloads ─────────────────────────────────────────────────────────────

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

