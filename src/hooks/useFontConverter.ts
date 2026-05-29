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

type NativeFontEngineHandle = Awaited<ReturnType<typeof createNativeFontEngine>>;

async function createOptionalNativeFontEngine(fontData: Uint8Array): Promise<NativeFontEngineHandle | null> {
  try {
    return await createNativeFontEngine(fontData);
  } catch (e) {
    console.warn('[FontForge] native rasterizer unavailable; falling back to browser canvas rendering:', e);
    return null;
  }
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

interface FontLineMetrics {
  ascent: number;
  descent: number;
  line_gap: number;
}

interface GlyphRender {
  imageData: ImageData;  // engine-measured glyph bitmap, preserving all RGBA channels
  left: number;          // bitmap left edge relative to the pen position
  top: number;           // bitmap top edge above the alphabetic baseline
}

interface NormalizedGlyph {
  imageData: ImageData;
  textureX: number;
  textureY: number;
  textureWidth: number;
  textureHeight: number;
  xoffset: number;
  yoffset: number;
}

interface SvgGlyphDocument {
  svg: string;
  glyphId: number;
}

function copyPixel(src: Uint8ClampedArray, dst: Uint8ClampedArray, srcIndex: number, dstIndex: number) {
  dst[dstIndex] = src[srcIndex];
  dst[dstIndex + 1] = src[srcIndex + 1];
  dst[dstIndex + 2] = src[srcIndex + 2];
  dst[dstIndex + 3] = src[srcIndex + 3];
}

function normalizeGlyphBitmap(render: GlyphRender, padding: number, extrude: number, base: number): NormalizedGlyph {
  const transparentPadding = Math.max(0, Math.floor(padding));
  const edge = Math.max(0, Math.min(2, Math.floor(extrude)));
  const border = transparentPadding + edge;
  const src = render.imageData;
  const dstWidth = src.width + border * 2;
  const dstHeight = src.height + border * 2;
  const dst = new Uint8ClampedArray(dstWidth * dstHeight * 4);

  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      copyPixel(src.data, dst, (y * src.width + x) * 4, ((y + border) * dstWidth + x + border) * 4);
    }
  }

  for (let amount = 1; amount <= edge; amount++) {
    const topY = border - amount;
    const bottomY = border + src.height - 1 + amount;
    for (let x = 0; x < src.width; x++) {
      copyPixel(dst, dst, (border * dstWidth + x + border) * 4, (topY * dstWidth + x + border) * 4);
      copyPixel(dst, dst, ((border + src.height - 1) * dstWidth + x + border) * 4, (bottomY * dstWidth + x + border) * 4);
    }
    for (let y = 0; y < src.height; y++) {
      const dy = y + border;
      copyPixel(dst, dst, (dy * dstWidth + border) * 4, (dy * dstWidth + border - amount) * 4);
      copyPixel(dst, dst, (dy * dstWidth + border + src.width - 1) * 4, (dy * dstWidth + border + src.width - 1 + amount) * 4);
    }
    copyPixel(dst, dst, (border * dstWidth + border) * 4, (topY * dstWidth + border - amount) * 4);
    copyPixel(dst, dst, (border * dstWidth + border + src.width - 1) * 4, (topY * dstWidth + border + src.width - 1 + amount) * 4);
    copyPixel(dst, dst, ((border + src.height - 1) * dstWidth + border) * 4, (bottomY * dstWidth + border - amount) * 4);
    copyPixel(dst, dst, ((border + src.height - 1) * dstWidth + border + src.width - 1) * 4, (bottomY * dstWidth + border + src.width - 1 + amount) * 4);
  }

  return {
    imageData: new ImageData(dst, dstWidth, dstHeight),
    textureX: border,
    textureY: border,
    textureWidth: src.width,
    textureHeight: src.height,
    xoffset: Math.round(render.left),
    yoffset: base - Math.round(render.top),
  };
}

function browserFontLineMetrics(ctx: CanvasRenderingContext2D, fontSize: number): FontLineMetrics {
  const metrics = ctx.measureText('Mg');
  return {
    ascent: Math.ceil(metrics.fontBoundingBoxAscent || metrics.actualBoundingBoxAscent || fontSize * 0.8),
    descent: Math.ceil(metrics.fontBoundingBoxDescent || metrics.actualBoundingBoxDescent || fontSize * 0.2),
    line_gap: 0,
  };
}

function readGlyphFromCmapFormat0(view: DataView, subtableStart: number, codepoint: number): number | null {
  if (codepoint < 0 || codepoint > 255 || subtableStart + 262 > view.byteLength) return null;
  return view.getUint8(subtableStart + 6 + codepoint);
}

function readGlyphFromCmapFormat4(view: DataView, subtableStart: number, codepoint: number): number | null {
  if (codepoint < 0 || codepoint > 0xffff || subtableStart + 16 > view.byteLength) return null;

  const length = view.getUint16(subtableStart + 2);
  const subtableEnd = subtableStart + length;
  if (subtableEnd > view.byteLength) return null;

  const segCount = view.getUint16(subtableStart + 6) / 2;
  const endCodeStart = subtableStart + 14;
  const startCodeStart = endCodeStart + segCount * 2 + 2;
  const idDeltaStart = startCodeStart + segCount * 2;
  const idRangeOffsetStart = idDeltaStart + segCount * 2;
  if (idRangeOffsetStart + segCount * 2 > subtableEnd) return null;

  for (let i = 0; i < segCount; i++) {
    const endCode = view.getUint16(endCodeStart + i * 2);
    const startCode = view.getUint16(startCodeStart + i * 2);
    if (codepoint < startCode || codepoint > endCode) continue;

    const idDelta = view.getInt16(idDeltaStart + i * 2);
    const idRangeOffsetAddress = idRangeOffsetStart + i * 2;
    const idRangeOffset = view.getUint16(idRangeOffsetAddress);
    if (idRangeOffset === 0) {
      return (codepoint + idDelta) & 0xffff;
    }

    const glyphIndexAddress = idRangeOffsetAddress + idRangeOffset + (codepoint - startCode) * 2;
    if (glyphIndexAddress + 2 > subtableEnd) return null;
    const glyphIndex = view.getUint16(glyphIndexAddress);
    return glyphIndex === 0 ? 0 : (glyphIndex + idDelta) & 0xffff;
  }

  return null;
}

function readGlyphFromCmapFormat12(view: DataView, subtableStart: number, codepoint: number): number | null {
  if (subtableStart + 16 > view.byteLength) return null;

  const length = view.getUint32(subtableStart + 4);
  const subtableEnd = subtableStart + length;
  if (subtableEnd > view.byteLength) return null;

  const groupCount = view.getUint32(subtableStart + 12);
  let lo = 0;
  let hi = groupCount - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const groupStart = subtableStart + 16 + mid * 12;
    if (groupStart + 12 > subtableEnd) return null;

    const startCharCode = view.getUint32(groupStart);
    const endCharCode = view.getUint32(groupStart + 4);
    if (codepoint < startCharCode) {
      hi = mid - 1;
    } else if (codepoint > endCharCode) {
      lo = mid + 1;
    } else {
      return view.getUint32(groupStart + 8) + codepoint - startCharCode;
    }
  }

  return null;
}

function resolveGlyphIdsFromCmap(fontData: Uint8Array, codepoints: number[]): number[] {
  const cmapTable = readTableRecords(fontData).get('cmap');
  if (!cmapTable) return codepoints.map(() => 0);

  const view = new DataView(fontData.buffer, fontData.byteOffset, fontData.byteLength);
  const cmapStart = cmapTable.offset;
  if (cmapStart + 4 > fontData.byteLength) return codepoints.map(() => 0);

  const numTables = view.getUint16(cmapStart + 2);
  const subtables: Array<{ offset: number; format: number; priority: number }> = [];
  for (let i = 0; i < numTables; i++) {
    const recordStart = cmapStart + 4 + i * 8;
    if (recordStart + 8 > fontData.byteLength) break;

    const platformId = view.getUint16(recordStart);
    const encodingId = view.getUint16(recordStart + 2);
    const offset = cmapStart + view.getUint32(recordStart + 4);
    if (offset + 2 > fontData.byteLength) continue;

    const format = view.getUint16(offset);
    const priority =
      platformId === 3 && encodingId === 10 ? 0 :
      platformId === 0 && format === 12 ? 1 :
      platformId === 3 && encodingId === 1 ? 2 :
      platformId === 0 ? 3 :
      platformId === 1 && encodingId === 0 ? 4 :
      5;
    subtables.push({ offset, format, priority });
  }

  subtables.sort((a, b) => a.priority - b.priority);

  return codepoints.map(codepoint => {
    for (const subtable of subtables) {
      let glyphId: number | null = null;
      if (subtable.format === 12) glyphId = readGlyphFromCmapFormat12(view, subtable.offset, codepoint);
      if (subtable.format === 4) glyphId = readGlyphFromCmapFormat4(view, subtable.offset, codepoint);
      if (subtable.format === 0) glyphId = readGlyphFromCmapFormat0(view, subtable.offset, codepoint);
      if (glyphId !== null) return glyphId;
    }
    return 0;
  });
}

async function extractSvgDocument(fontData: Uint8Array, glyphId: number): Promise<SvgGlyphDocument | null> {
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
      return { svg: await new Response(stream).text(), glyphId };
    }

    return { svg: decoder.decode(bytes), glyphId };
  }

  return null;
}

function getSvgNumericAttribute(root: SVGSVGElement, name: string): number | null {
  const value = root.getAttribute(name);
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseSvgViewBox(root: SVGSVGElement): DOMRectReadOnly | null {
  const viewBox = root.getAttribute('viewBox');
  if (!viewBox) return null;
  const values = viewBox.trim().split(/[\s,]+/).map(Number);
  if (values.length !== 4 || values.some(value => !Number.isFinite(value))) return null;
  const [x, y, width, height] = values;
  if (width <= 0 || height <= 0) return null;
  return new DOMRectReadOnly(x, y, width, height);
}

function isolateSvgGlyph(root: SVGSVGElement, glyphId: number) {
  const glyphIdAttribute = `glyph${glyphId}`;
  const glyphElement = Array.from(root.querySelectorAll('[id]')).find(element => element.id === glyphIdAttribute);
  if (!glyphElement) return;

  const wrapper = root.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'g');
  wrapper.appendChild(glyphElement.cloneNode(true));

  Array.from(root.children).forEach(child => {
    if (child.tagName.toLowerCase() !== 'defs') child.remove();
  });
  root.appendChild(wrapper);
}

function measureSvgArtwork(root: SVGSVGElement, fallbackSize: number): DOMRectReadOnly | null {
  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '-10000px';
  host.style.top = '-10000px';
  host.style.width = '0';
  host.style.height = '0';
  host.style.overflow = 'hidden';

  const probe = root.cloneNode(true) as SVGSVGElement;
  probe.setAttribute('width', String(getSvgNumericAttribute(root, 'width') ?? fallbackSize));
  probe.setAttribute('height', String(getSvgNumericAttribute(root, 'height') ?? fallbackSize));
  probe.style.overflow = 'visible';
  host.appendChild(probe);
  document.body.appendChild(host);

  try {
    const bbox = probe.getBBox();
    if (bbox.width > 0 && bbox.height > 0) return new DOMRectReadOnly(bbox.x, bbox.y, bbox.width, bbox.height);
  } catch (e) {
    console.warn('[FontForge] SVG glyph bounds measurement failed:', e);
  } finally {
    document.body.removeChild(host);
  }

  return parseSvgViewBox(root);
}

function cropTransparentPixels(imageData: ImageData, left = 0, top = 0): GlyphRender | null {
  const { data, width, height } = imageData;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) return null;

  const croppedWidth = maxX - minX + 1;
  const croppedHeight = maxY - minY + 1;
  const cropped = new Uint8ClampedArray(croppedWidth * croppedHeight * 4);
  for (let y = 0; y < croppedHeight; y++) {
    for (let x = 0; x < croppedWidth; x++) {
      copyPixel(data, cropped, ((y + minY) * width + x + minX) * 4, (y * croppedWidth + x) * 4);
    }
  }

  return {
    imageData: new ImageData(cropped, croppedWidth, croppedHeight),
    left: left + minX,
    top: top - minY,
  };
}

function rasterizeSvgDocument(documentData: SvgGlyphDocument, fontSize: number, base: number): Promise<GlyphRender | null> {
  return new Promise(resolve => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(documentData.svg, 'image/svg+xml');
    const root = doc.documentElement as SVGSVGElement | null;
    if (!root || root.nodeName.toLowerCase() !== 'svg') {
      resolve(null);
      return;
    }

    isolateSvgGlyph(root, documentData.glyphId);

    if (!root.getAttribute('xmlns')) {
      root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    }

    const measuredBox = measureSvgArtwork(root, fontSize);
    const sourceBox = measuredBox ?? parseSvgViewBox(root) ?? new DOMRectReadOnly(0, 0, fontSize, fontSize);
    const bleed = Math.max(sourceBox.width, sourceBox.height) * 0.05;
    const viewBox = new DOMRectReadOnly(
      sourceBox.x - bleed,
      sourceBox.y - bleed,
      sourceBox.width + bleed * 2,
      sourceBox.height + bleed * 2,
    );
    const scale = fontSize / Math.max(viewBox.width, viewBox.height);
    const renderWidth = Math.max(1, Math.ceil(viewBox.width * scale));
    const renderHeight = Math.max(1, Math.ceil(viewBox.height * scale));

    root.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`);
    root.setAttribute('width', String(renderWidth));
    root.setAttribute('height', String(renderHeight));
    root.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    root.style.overflow = 'visible';

    const serialized = new XMLSerializer().serializeToString(root);
    const url = URL.createObjectURL(new Blob([serialized], { type: 'image/svg+xml' }));
    const image = new Image();

    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = renderWidth;
      canvas.height = renderHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.clearRect(0, 0, renderWidth, renderHeight);
      ctx.drawImage(image, 0, 0, renderWidth, renderHeight);
      URL.revokeObjectURL(url);
      const cropped = cropTransparentPixels(ctx.getImageData(0, 0, renderWidth, renderHeight), 0, base);
      resolve(cropped);
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
    left: bitmap.left,
    top: bitmap.top,
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
  metrics?: TextMetrics,
): GlyphRender | null {
  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d')!;
  measureCtx.font = `${fontSize}px "${fontFamily}"`;
  measureCtx.textBaseline = 'alphabetic';
  const textMetrics = metrics ?? measureCtx.measureText(char);
  const leftBearing = Math.ceil(textMetrics.actualBoundingBoxLeft || 0);
  const rightBearing = Math.ceil(textMetrics.actualBoundingBoxRight || textMetrics.width || 0);
  const top = Math.ceil(textMetrics.actualBoundingBoxAscent || 0);
  const bottom = Math.ceil(textMetrics.actualBoundingBoxDescent || 0);

  if (leftBearing + rightBearing <= 0 || top + bottom <= 0) return null;

  const canvas = document.createElement('canvas');
  canvas.width = leftBearing + rightBearing;
  canvas.height = top + bottom;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = `${fontSize}px "${fontFamily}"`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = color;
  ctx.fillText(char, leftBearing, top);

  return {
    imageData: ctx.getImageData(0, 0, canvas.width, canvas.height),
    left: -leftBearing,
    top,
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
      const { fontSize, padding, extrude, spacing, atlasWidth, atlasHeight, color } = config;
      const useNativeColors = config.useNativeColors && !!loadedFont?.isColorFont;
      const chars = CHARSETS[config.charset] ?? config.charset;
      const charList = Array.from(chars);
      const nativeEngine = loadedFont?.data
        ? await createOptionalNativeFontEngine(loadedFont.data)
        : null;
      const codepoints = charList.map(char => char.codePointAt(0) ?? 0);
      const nativeGlyphIds = nativeEngine
        ? nativeEngine.resolveGlyphIndices(codepoints)
        : loadedFont?.data
          ? resolveGlyphIdsFromCmap(loadedFont.data, codepoints)
          : [];
      const nativeColor = colorToRgbaU32(color);

      const active = await ensureFontReady(fontFamily, fontSize);
      if (!active) {
        throw new Error(`Font "${fontFamily}" is not active for rendering`);
      }

      // ── 1. Render every glyph and normalize texture rectangles ──────────────

      const measureCanvas = document.createElement('canvas');
      const mCtx = measureCanvas.getContext('2d')!;
      mCtx.font = `${fontSize}px "${fontFamily}"`;
      mCtx.textBaseline = 'alphabetic';

      const fontMetrics = nativeEngine
        ? nativeEngine.metrics(fontSize)
        : browserFontLineMetrics(mCtx, fontSize);
      const base = Math.ceil(fontMetrics.ascent);
      const lineHeight = Math.ceil(fontMetrics.ascent + Math.abs(fontMetrics.descent) + fontMetrics.line_gap);
      const totalPadding = padding + Math.max(0, Math.min(2, Math.floor(extrude)));

      interface RenderEntry {
        char: string;
        id: number;
        normalized: NormalizedGlyph | null;
        xadvance: number;
      }

      const entries: RenderEntry[] = [];

      for (const [index, char] of charList.entries()) {
        const id = char.codePointAt(0) ?? 0;
        const glyphId = nativeGlyphIds[index] ?? 0;
        const textMetrics = mCtx.measureText(char);
        const svgDocument = useNativeColors && loadedFont?.tableInfo.hasSVG
          ? await extractSvgDocument(loadedFont.data, glyphId)
          : null;
        const bitmap = nativeEngine && useNativeColors && !svgDocument
          ? nativeEngine.rasterizeGlyph(glyphId, fontSize, nativeColor)
          : null;
        const render = svgDocument
          ? await rasterizeSvgDocument(svgDocument, fontSize, base)
          : bitmap
            ? glyphBitmapToRender(bitmap)
            : renderGlyph(char, fontFamily, fontSize, color, textMetrics);
        const xadvance = bitmap
          ? Math.round(bitmap.advance_width)
          : nativeEngine
            ? Math.round(nativeEngine.glyphMetrics(glyphId, fontSize).advance_width)
            : Math.round(textMetrics.width);

        entries.push({
          char,
          id,
          normalized: render ? normalizeGlyphBitmap(render, padding, extrude, base) : null,
          xadvance,
        });
      }

      console.log(`[FontForge] lineHeight=${lineHeight} base=${base} (ascent=${fontMetrics.ascent} descent=${fontMetrics.descent} gap=${fontMetrics.line_gap})`);

      // ── 2. Pack glyphs into the atlas canvas ──────────────────────────────

      const atlas = document.createElement('canvas');
      atlas.width  = atlasWidth;
      atlas.height = atlasHeight;
      const actx = atlas.getContext('2d')!;
      actx.clearRect(0, 0, atlasWidth, atlasHeight);

      const glyphs: CharGlyph[] = [];
      let cx = totalPadding;
      let cy = totalPadding;
      let rowH = lineHeight + totalPadding * 2;

      for (const { char, id, normalized, xadvance } of entries) {
        if (!normalized) {
          glyphs.push({ id, char, x: 0, y: 0, width: 0, height: 0, xoffset: 0, yoffset: 0, xadvance });
          continue;
        }

        const gw = normalized.imageData.width;
        const gh = normalized.imageData.height;

        if (cx + gw > atlasWidth - totalPadding) {
          cx = totalPadding;
          cy += rowH + spacing;
          rowH = lineHeight + totalPadding * 2;
        }

        if (cy + gh > atlasHeight) {
          console.warn(`[FontForge] atlas full — '${char}' skipped`);
          glyphs.push({ id, char, x: 0, y: 0, width: 0, height: 0, xoffset: 0, yoffset: 0, xadvance });
          continue;
        }

        actx.putImageData(normalized.imageData, cx, cy);

        glyphs.push({
          id,
          char,
          x: cx + normalized.textureX,
          y: cy + normalized.textureY,
          width: normalized.textureWidth,
          height: normalized.textureHeight,
          xoffset: normalized.xoffset,
          yoffset: normalized.yoffset,
          xadvance,
        });

        cx += gw + spacing;
        rowH = Math.max(rowH, gh);
      }

      // ── 3. Generate the .fnt text ─────────────────────────────────────────

      const lines: string[] = [];
      lines.push(
        `info face="${fontName}" size=${fontSize} bold=0 italic=0 charset="" unicode=1 stretchH=100 smooth=1 aa=1` +
        ` padding=${totalPadding},${totalPadding},${totalPadding},${totalPadding} spacing=${spacing},${spacing}`
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

