export default async function init() {
  return undefined;
}

export class NativeFontEngine {
  constructor() {
    throw new Error('font_native WASM module is not built. Build it with: cd src/native/font-native && wasm-pack build --target web --out-dir ../wasm/pkg');
  }
}
