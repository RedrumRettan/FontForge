# font-native WASM module

Build with wasm-pack:

```bash
cd src/native/font-native
wasm-pack build --target web --out-dir ../wasm/pkg
```

The generated `../wasm/pkg/font_native.js` module is loaded by `src/native/fontEngine.ts`.
