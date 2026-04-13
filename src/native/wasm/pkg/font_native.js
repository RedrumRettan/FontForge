export class NativeFontEngine {
  constructor() {
    throw new Error('font_native WASM module is not built. Run: cd src/native/font-native && wasm-pack build --target web --out-dir ../wasm/pkg');
  }
}
