use rustybuzz::{Face as RbFace, UnicodeBuffer};
use serde::Serialize;
use swash::scale::{image::Content, Render, ScaleContext, Source, StrikeWith};
use swash::zeno::Format;
use ttf_parser::{Face, GlyphId, OutlineBuilder};
use wasm_bindgen::prelude::*;

#[derive(Serialize)]
struct TableInventory {
    has_svg: bool,
    has_gpos: bool,
    has_gsub: bool,
    has_os2: bool,
    has_cff: bool,
    has_cff2: bool,
    has_colr: bool,
    has_cpal: bool,
    has_cbdt: bool,
    has_cblc: bool,
    has_sbix: bool,
    raw_tables: Vec<String>,
}

#[derive(Serialize)]
struct FontMetrics {
    units_per_em: u16,
    ascent: f32,
    descent: f32,
    line_gap: f32,
}

#[derive(Serialize)]
struct GlyphMetrics {
    glyph_id: u16,
    advance_width: f32,
    left_side_bearing: f32,
    right_side_bearing: f32,
}

#[derive(Serialize)]
struct ShapedGlyph {
    glyph_id: u16,
    cluster: u32,
    x_advance: f32,
    y_advance: f32,
    x_offset: f32,
    y_offset: f32,
}

#[derive(Serialize)]
struct GlyphBitmap {
    width: u32,
    height: u32,
    left: i32,
    top: i32,
    advance_width: f32,
    renderer: RendererKind,
    rgba: Vec<u8>,
}

#[derive(Copy, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
enum RendererKind {
    ColrCpal,
    Svg,
    EmbeddedBitmap,
    Outline,
}

#[derive(Copy, Clone)]
struct RenderPlan {
    kind: RendererKind,
    sources: &'static [Source],
    color_output: bool,
}

#[wasm_bindgen]
pub struct NativeFontEngine {
    data: Vec<u8>,
}

#[wasm_bindgen]
impl NativeFontEngine {
    #[wasm_bindgen(constructor)]
    pub fn new(data: Vec<u8>) -> Result<NativeFontEngine, JsValue> {
        Face::parse(&data, 0).map_err(|e| JsValue::from_str(&format!("Invalid font: {e:?}")))?;
        Ok(Self { data })
    }

    pub fn table_inventory(&self) -> Result<JsValue, JsValue> {
        let face = self.face()?;
        let raw_tables = face
            .tables()
            .into_iter()
            .map(|t| t.tag().to_string())
            .collect::<Vec<_>>();

        let inv = TableInventory {
            has_svg: face.tables().svg.is_some(),
            has_gpos: face.tables().gpos.is_some(),
            has_gsub: face.tables().gsub.is_some(),
            has_os2: face.tables().os2.is_some(),
            has_cff: face.tables().cff.is_some(),
            has_cff2: face.tables().cff2.is_some(),
            has_colr: face.tables().colr.is_some(),
            has_cpal: face.tables().cpal.is_some(),
            has_cbdt: face.tables().cbdt.is_some(),
            has_cblc: face.tables().cblc.is_some(),
            has_sbix: face.tables().sbix.is_some(),
            raw_tables,
        };

        serde_wasm_bindgen::to_value(&inv).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    pub fn resolve_glyph_indices(&self, codepoints: Vec<u32>) -> Result<Vec<u16>, JsValue> {
        let face = self.face()?;
        Ok(codepoints
            .into_iter()
            .map(|cp| {
                char::from_u32(cp)
                    .and_then(|ch| face.glyph_index(ch))
                    .map(|g| g.0)
                    .unwrap_or(0)
            })
            .collect())
    }

    pub fn metrics(&self, px_size: f32) -> Result<JsValue, JsValue> {
        let face = self.face()?;
        let scale = px_size / face.units_per_em() as f32;
        let metrics = FontMetrics {
            units_per_em: face.units_per_em(),
            ascent: face.ascender() as f32 * scale,
            descent: face.descender() as f32 * scale,
            line_gap: face.line_gap() as f32 * scale,
        };
        serde_wasm_bindgen::to_value(&metrics).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    pub fn glyph_metrics(&self, glyph_id: u16, px_size: f32) -> Result<JsValue, JsValue> {
        let face = self.face()?;
        let gid = GlyphId(glyph_id);
        let scale = px_size / face.units_per_em() as f32;
        let advance = face.glyph_hor_advance(gid).unwrap_or(0) as f32 * scale;
        let lsb = face.glyph_hor_side_bearing(gid).unwrap_or(0) as f32 * scale;

        let mut bounds = BoundsBuilder::default();
        let rsb = if face.outline_glyph(gid, &mut bounds) {
            let xmax = bounds.max_x;
            (advance / scale - lsb / scale - xmax as f32) * scale
        } else {
            0.0
        };

        let metrics = GlyphMetrics {
            glyph_id,
            advance_width: advance,
            left_side_bearing: lsb,
            right_side_bearing: rsb,
        };

        serde_wasm_bindgen::to_value(&metrics).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    pub fn shape(&self, text: &str, px_size: f32) -> Result<JsValue, JsValue> {
        let rb_face = RbFace::from_slice(&self.data, 0)
            .ok_or_else(|| JsValue::from_str("Could not load rustybuzz face"))?;
        let units_per_em = rb_face.units_per_em();
        let scale = px_size / units_per_em as f32;

        let mut buffer = UnicodeBuffer::new();
        buffer.push_str(text);
        let glyph_buffer = rustybuzz::shape(&rb_face, &[], buffer);

        let glyphs = glyph_buffer
            .glyph_infos()
            .iter()
            .zip(glyph_buffer.glyph_positions().iter())
            .map(|(info, pos)| ShapedGlyph {
                glyph_id: info.glyph_id as u16,
                cluster: info.cluster,
                x_advance: pos.x_advance as f32 * scale,
                y_advance: pos.y_advance as f32 * scale,
                x_offset: pos.x_offset as f32 * scale,
                y_offset: pos.y_offset as f32 * scale,
            })
            .collect::<Vec<_>>();

        serde_wasm_bindgen::to_value(&glyphs).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    pub fn rasterize_glyph(
        &self,
        glyph_id: u16,
        px_size: f32,
        color_rgba: u32,
    ) -> Result<JsValue, JsValue> {
        let face = self.face()?;
        let gid = GlyphId(glyph_id);
        let plan = render_plan(&face);

        if matches!(plan.kind, RendererKind::Svg) {
            return Err(JsValue::from_str(
                "SVG color glyph rasterization requires a linked SVG backend (Skia, resvg, or librsvg)",
            ));
        }

        let font = swash::FontRef::from_index(&self.data, 0)
            .ok_or_else(|| JsValue::from_str("Invalid font index"))?;
        let mut scaler_ctx = ScaleContext::new();
        let mut scaler = scaler_ctx.builder(font).size(px_size).build();

        let mut renderer = Render::new(plan.sources);
        renderer.format(Format::Alpha);
        renderer.default_color(unpack_rgba(color_rgba));

        let image = renderer
            .render(&mut scaler, swash::GlyphId(glyph_id))
            .ok_or_else(|| JsValue::from_str("Glyph render failed"))?;
        let rgba = image_to_rgba(&image.data, image.content, color_rgba)?;

        let scale = px_size / face.units_per_em() as f32;
        let advance_width = face.glyph_hor_advance(gid).unwrap_or(0) as f32 * scale;

        let payload = GlyphBitmap {
            width: image.placement.width,
            height: image.placement.height,
            left: image.placement.left,
            top: image.placement.top,
            advance_width,
            renderer: if matches!(image.content, Content::Color) || plan.color_output {
                plan.kind
            } else {
                RendererKind::Outline
            },
            rgba,
        };

        serde_wasm_bindgen::to_value(&payload).map_err(|e| JsValue::from_str(&e.to_string()))
    }
}

impl NativeFontEngine {
    fn face(&self) -> Result<Face<'_>, JsValue> {
        Face::parse(&self.data, 0)
            .map_err(|e| JsValue::from_str(&format!("Face parse error: {e:?}")))
    }
}

#[derive(Default)]
struct BoundsBuilder {
    max_x: i16,
}

impl OutlineBuilder for BoundsBuilder {
    fn move_to(&mut self, x: f32, _y: f32) {
        self.max_x = self.max_x.max(x as i16);
    }

    fn line_to(&mut self, x: f32, _y: f32) {
        self.max_x = self.max_x.max(x as i16);
    }

    fn quad_to(&mut self, x1: f32, _y1: f32, x: f32, _y: f32) {
        self.max_x = self.max_x.max(x1 as i16).max(x as i16);
    }

    fn curve_to(&mut self, x1: f32, _y1: f32, x2: f32, _y2: f32, x: f32, _y: f32) {
        self.max_x = self.max_x.max(x1 as i16).max(x2 as i16).max(x as i16);
    }

    fn close(&mut self) {}
}

fn render_plan(face: &Face<'_>) -> RenderPlan {
    const COLR_SOURCES: &[Source] = &[Source::ColorOutline(0), Source::Outline];
    const BITMAP_SOURCES: &[Source] = &[Source::ColorBitmap(StrikeWith::BestFit), Source::Outline];
    const OUTLINE_SOURCES: &[Source] = &[Source::Outline];

    let tables = face.tables();
    if tables.colr.is_some() && tables.cpal.is_some() {
        RenderPlan {
            kind: RendererKind::ColrCpal,
            sources: COLR_SOURCES,
            color_output: true,
        }
    } else if tables.svg.is_some() {
        RenderPlan {
            kind: RendererKind::Svg,
            sources: OUTLINE_SOURCES,
            color_output: true,
        }
    } else if tables.cbdt.is_some() || tables.cblc.is_some() || tables.sbix.is_some() {
        RenderPlan {
            kind: RendererKind::EmbeddedBitmap,
            sources: BITMAP_SOURCES,
            color_output: true,
        }
    } else {
        RenderPlan {
            kind: RendererKind::Outline,
            sources: OUTLINE_SOURCES,
            color_output: false,
        }
    }
}

fn image_to_rgba(data: &[u8], content: Content, color_rgba: u32) -> Result<Vec<u8>, JsValue> {
    match content {
        Content::Color => Ok(data.to_vec()),
        Content::Mask => Ok(expand_to_rgba(data, color_rgba)),
        Content::SubpixelMask => {
            let [_, _, _, alpha] = unpack_rgba(color_rgba);
            let mut out = Vec::with_capacity(data.len());
            for px in data.chunks_exact(4) {
                let a = ((px[3] as u16 * alpha as u16) / 255) as u8;
                out.extend_from_slice(&[px[0], px[1], px[2], a]);
            }
            Ok(out)
        }
    }
}

fn unpack_rgba(color_rgba: u32) -> [u8; 4] {
    [
        ((color_rgba >> 24) & 0xFF) as u8,
        ((color_rgba >> 16) & 0xFF) as u8,
        ((color_rgba >> 8) & 0xFF) as u8,
        (color_rgba & 0xFF) as u8,
    ]
}

fn expand_to_rgba(alpha: &[u8], color_rgba: u32) -> Vec<u8> {
    let [r, g, b, a] = unpack_rgba(color_rgba);

    let mut out = Vec::with_capacity(alpha.len() * 4);
    for coverage in alpha {
        let alpha = ((*coverage as u16 * a as u16) / 255) as u8;
        out.extend_from_slice(&[r, g, b, alpha]);
    }
    out
}
