import { useState, useCallback, useRef } from 'react';
import { FontConversionConfig, ConversionResult, CharGlyph, CHARSETS, FontTableInfo } from '@/types/font';
import { createNativeFontEngine, NativeGlyphBitmap } from '@/native/fontEngine';

interface LoadedFont {
  name: string;
  file: File;
  objectUrl: string;
  data: Uint8Array;
  isColorFont: boolean;
  tableInfo: FontTableInfo;
}

interface FontTableRecord {
  offset: number;
}

function readTableRecords(buffer: ArrayBuffer | Uint8Array): Map<string, FontTableRecord> {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const records = new Map<string, FontTableRecord>();
  if (bytes.byteLength < 12) return records;

  const numTables = view.getUint16(4);
  for (let i = 0; i < numTables; i++) {
    const base = 12 + i * 16;
    if (base + 16 > bytes.byteLength) break;
    const tag = String.fromCharCode(
      view.getUint8(base),
      view.getUint8(base + 1),
      view.getUint8(base + 2),
      view.getUint8(base + 3),
    );
    records.set(tag, { offset: view.getUint32(base + 8) });
  }

  return records;
}

// ─── Binary table parser ──────────────────────────────────────────────────────

async function parseFontTables(file: File): Promise<FontTableInfo> {
  const empty: FontTableInfo = {
    hasSVG: false, hasGPOS: false, hasGSUB: false, hasOS2: false,
    hasCFF: false, hasCFF2: false, hasCOLR: false, hasCBDT: false, hasSBIX: false, rawTables: [],
  };
  try {
    const buffer = await file.arrayBuffer();
    const records = readTableRecords(buffer);
    const tableTags = new Set(records.keys());
    const rawTables = Array.from(records.keys(), tag => tag.trimEnd());

    console.log('[FontForge] tables:', rawTables.join(', '));

    return {
      hasSVG:  tableTags.has('SVG '),
      hasGPOS: tableTags.has('GPOS'),
      hasGSUB: tableTags.has('GSUB'),
      hasOS2:  tableTags.has('OS/2'),
      hasCFF:  tableTags.has('CFF '),
      hasCFF2: tableTags.has('CFF2'),
      hasCOLR: tableTags.has('COLR'),
      hasCBDT: tableTags.has('CBDT') || tableTags.has('CBLC'),
      hasSBIX: tableTags.has('sbix'),
      rawTables,
    };
  } catch (e) {
    console.warn('[FontForge] table parse failed:', e);
    return empty;
  }
}

// ─── Single-glyph renderer ────────────────────────────────────────────────────

interface GlyphRender {
  imageData: ImageData;  // tight crop of just the ink pixels
  ascent: number;        // pixels above baseline in the crop
  xoffset: number;       // pixels the crop starts to the right of the draw point (can be negative)
}

function cropGlyphFromCanvas(
  ctx: CanvasRenderingContext2D,
  cw: number,
  ch: number,
  drawX: number,
  drawY: number,
): GlyphRender | null {
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
  const cropped = ctx.getImageData(minX, minY, cropW, cropH);

  return {
    imageData: cropped,
    ascent: drawY - minY,
    xoffset: minX - drawX,
  };
}

async function extractSvgDocument(fontData: Uint8Array, glyphId: number): Promise<string | null> {
  const svgTable = readTableRecords(fontData).get('SVG ');
  if (!svgTable) return null;

  const view = new DataView(fontData.buffer, fontData.byteOffset, fontData.byteLength);
  const tableStart = svgTable.offset;
  if (tableStart + 10 > fontData.byteLength) return null;

  const docIndexOffset = view.getUint32(tableStart + 2);
  const indexStart = tableStart + docIndexOffset;
  if (indexStart + 2 > fontData.byteLength) return null;

  const count = view.getUint16(indexStart);
  const decoder = new TextDecoder('utf-8');

  for (let i = 0; i < count; i++) {
    const entry = indexStart + 2 + i * 12;
    if (entry + 12 > fontData.byteLength) break;

    const startGlyph = view.getUint16(entry);
    const endGlyph = view.getUint16(entry + 2);
    if (glyphId < startGlyph || glyphId > endGlyph) continue;

    const docOffset = view.getUint32(entry + 4);
    const docLength = view.getUint32(entry + 8);
    const docStart = indexStart + docOffset;
    const docEnd = docStart + docLength;
    if (docEnd > fontData.byteLength) return null;

    const bytes = fontData.subarray(docStart, docEnd);
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      if (!('DecompressionStream' in window)) return null;
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      return new Response(stream).text();
    }

    return decoder.decode(bytes);
  }

  return null;
}

function rasterizeSvgDocument(svg: string, fontSize: number): Promise<GlyphRender | null> {
  return new Promise(resolve => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svg, 'image/svg+xml');
    const root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== 'svg') {
      resolve(null);
      return;
    }

    root.setAttribute('width', String(fontSize));
    root.setAttribute('height', String(fontSize));
    if (!root.getAttribute('xmlns')) {
      root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    }

    const serialized = new XMLSerializer().serializeToString(root);
    const url = URL.createObjectURL(new Blob([serialized], { type: 'image/svg+xml' }));
    const image = new Image();

    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = fontSize;
      canvas.height = fontSize;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.clearRect(0, 0, fontSize, fontSize);
      ctx.drawImage(image, 0, 0, fontSize, fontSize);
      URL.revokeObjectURL(url);
      resolve(cropGlyphFromCanvas(ctx, fontSize, fontSize, 0, fontSize));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    image.src = url;
  });
}

function glyphBitmapToRender(bitmap: NativeGlyphBitmap): GlyphRender | null {
  if (bitmap.width === 0 || bitmap.height === 0) return null;

  const rgba = bitmap.rgba instanceof Uint8Array
    ? bitmap.rgba
    : Uint8Array.from(bitmap.rgba as unknown as ArrayLike<number>);
  const pixels = new Uint8ClampedArray(rgba);

  return {
    imageData: new ImageData(pixels, bitmap.width, bitmap.height),
    ascent: bitmap.top,
    xoffset: bitmap.left,
  };
}

function colorToRgbaU32(color: string): number {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return (((r << 24) | (g << 16) | (b << 8) | a) >>> 0);
}

function renderGlyph(
  char: string,
  fontFamily: string,
  fontSize: number,
  color: string,
): Promise<GlyphRender | null> {
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

  ctx.fillStyle = color;
  ctx.fillText(char, drawX, drawY);

  return cropGlyphFromCanvas(ctx, cw, ch, drawX, drawY);
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

  const ensureFontReady = useCallback(async (family: string, px: number) => {
    try {
      await document.fonts.load(`${px}px "${family}"`, 'Aa');
      await document.fonts.ready;
      return document.fonts.check(`${px}px "${family}"`, 'Aa');
    } catch {
      return false;
    }
  }, []);

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
      // Prefer ArrayBuffer source for broader browser reliability when loading
      // local user-selected fonts. Fall back to object URL if needed.
      let ff: FontFace;
      try {
        const fontData = await file.arrayBuffer();
        ff = new FontFace(fontFamily, fontData);
      } catch {
        ff = new FontFace(fontFamily, `url(${objectUrl})`);
      }
      await ff.load();
      document.fonts.add(ff);
      fontFaceRef.current = ff;
      fontFamilyRef.current = fontFamily;

      const active = await ensureFontReady(fontFamily, 32);
      if (!active) {
        throw new Error('FontFace loaded but browser did not activate it');
      }

      const cleanName = file.name.replace(/\.(ttf|otf)$/i, '');
      const fontData = new Uint8Array(await file.arrayBuffer());
      const tableInfo = await parseFontTables(file);
      const isColorFont = tableInfo.hasSVG || tableInfo.hasCOLR || tableInfo.hasCBDT || tableInfo.hasSBIX;
      console.log('[FontForge] loaded:', cleanName, 'color:', isColorFont, 'tables:', tableInfo.rawTables.join(', '));

      setLoadedFont({ name: cleanName, file, objectUrl, data: fontData, isColorFont, tableInfo });
      return { fontFamily, isColorFont, tableInfo };
    } catch (e) {
      console.error('[FontForge] load error:', e);
      setError('Failed to load font. Make sure it is a valid TTF/OTF file.');
      URL.revokeObjectURL(objectUrl);
      return false;
    }
  }, [loadedFont, ensureFontReady]);

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
      const { fontSize, padding, spacing, atlasWidth, atlasHeight, color } = config;
      const useNativeColors = config.useNativeColors && !!loadedFont?.isColorFont;
      const chars = CHARSETS[config.charset] ?? config.charset;
      let nativeEngine: Awaited<ReturnType<typeof createNativeFontEngine>> | null = null;
      if (useNativeColors && loadedFont?.data) {
        try {
          nativeEngine = await createNativeFontEngine(loadedFont.data);
        } catch {
          console.warn('[FontForge] native engine unavailable — using canvas fallback');
        }
      }
      const nativeGlyphIds = nativeEngine
        ? nativeEngine.resolveGlyphIndices(Array.from(chars, char => char.codePointAt(0) ?? 0))
        : [];
      const nativeColor = colorToRgbaU32(color);

      const active = await ensureFontReady(fontFamily, fontSize);
      if (!active) {
        throw new Error(`Font "${fontFamily}" is not active for rendering`);
      }

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

      for (const [index, char] of Array.from(chars).entries()) {
        const glyphId = nativeGlyphIds[index] ?? 0;
        const svgDocument = nativeEngine && useNativeColors && loadedFont?.tableInfo.hasSVG
          ? await extractSvgDocument(loadedFont.data, glyphId)
          : null;
        const bitmap = nativeEngine && useNativeColors && !svgDocument
          ? nativeEngine.rasterizeGlyph(glyphId, fontSize, nativeColor)
          : null;
        const render = svgDocument
          ? await rasterizeSvgDocument(svgDocument, fontSize)
          : bitmap
            ? glyphBitmapToRender(bitmap)
            : await renderGlyph(char, fontFamily, fontSize, color);
        const xadvance = bitmap
          ? Math.round(bitmap.advance_width)
          : nativeEngine
            ? Math.round(nativeEngine.glyphMetrics(glyphId, fontSize).advance_width)
            : Math.round(mCtx.measureText(char).width);

        if (render) {
          globalAscent  = Math.max(globalAscent,  render.ascent);
          // descent = crop height - ascent  (pixels below baseline in the crop)
          globalDescent = Math.max(globalDescent, render.imageData.height - render.ascent);
        }

        entries.push({ char, id: char.codePointAt(0) ?? 0, render, xadvance });
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
  }, [loadedFont, ensureFontReady]);

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

