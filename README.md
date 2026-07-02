# @smremde/jpegcropscale

High-performance JPEG crop and power-of-two downscale library powered by `libjpeg-turbo` compiled to WebAssembly. 

Because it contains a prebuilt `.wasm` binary, users do not need `emscripten`, `docker`, or native compilers to use this package.

## Features

- **Fast JPEG Crop**: Highly optimized lossless cropping using `libjpeg-turbo`'s transfrom capabilities.
- **Fast Power-of-Two Downscale**: Uses `libjpeg-turbo`'s hardware/SIMD-accelerated shrink-on-load decompression.
- **Extremely Lightweight**: Single-dependency-free library with optimized WASM payload.
- **Node.js Compatible**: Out-of-the-box CJS support.

## Installation

```bash
npm install @smremde/jpegcropscale
```

## Usage

Since WebAssembly compiles asynchronously, you must wait for the module to be `ready` before calling `jpegtran()`.

```javascript
const fs = require('fs');
const { jpegtran, ready } = require('@smremde/jpegcropscale');

async function main() {
    // 1. Wait for WebAssembly to load and compile
    await ready;

    // 2. Load your input JPEG image
    const inputBuffer = fs.readFileSync('input.jpg');

    // 3. Crop and downscale
    // Parameters:
    // - input: Buffer or Uint8Array
    // - downscale: 1 (no scaling), 2, 4, 8 (power of two scaling factor)
    // - crop_left: X coordinate (must be 8-pixel aligned)
    // - crop_top: Y coordinate (must be 8-pixel aligned)
    // - crop_height: Height of crop region (must be 8-pixel aligned)
    // - crop_width: Width of crop region (must be 8-pixel aligned)
    const outputBuffer = jpegtran(inputBuffer, 2, 16, 16, 128, 128);

    // 4. Write the resulting JPEG
    fs.writeFileSync('output.jpg', outputBuffer);
}

main().catch(console.error);
```

## API Reference

### `ready`
- **Type**: `Promise<void>`
- **Description**: Resolves once the WebAssembly module has successfully compiled and initialized. Always await this before calling `jpegtran()`.

### `jpegtran(input, downscale, crop_left, crop_top, crop_height, crop_width)`
- **Arguments**:
  - `input` (`Buffer` | `Uint8Array`): Input JPEG buffer.
  - `downscale` (`number`): Downscaling factor. Must be a positive integer power of two (`1`, `2`, `4`, or `8`). `1` performs crop-only without re-compression or resizing.
  - `crop_left` (`number`): X coordinate for the top-left of the crop region. Must be `8`-pixel aligned (multiple of 8).
  - `crop_top` (`number`): Y coordinate for the top-left of the crop region. Must be `8`-pixel aligned (multiple of 8).
  - `crop_width` (`number`): Width of the crop region. Must be `8`-pixel aligned (multiple of 8) and positive.
  - `crop_height` (`number`): Height of the crop region. Must be `8`-pixel aligned (multiple of 8) and positive.
- **Returns**: `Buffer` (Node.js Buffer containing the processed JPEG).

## Constraints and Validation

To maintain lossless transform guarantees and compatibility with JPEG MCU block structures, the library enforces:
- `crop_left` and `crop_top` must be non-negative multiples of 8.
- `crop_width` and `crop_height` must be positive multiples of 8.
- `downscale` must be positive.

If these constraints are violated, the function throws an explicit, helpful error message.

## Developing and Building

If you wish to build the WebAssembly binary from source yourself:

1. Ensure you have Docker or Emscripten installed.
2. Run the build script:
   ```bash
   ./build.sh
   ```
   This will clone `libjpeg-turbo`, build it to a WASM static library, and then compile the wrapper `jpeg_worker.c` with Emscripten to produce `jpeg_worker.js` and `jpeg_worker.wasm`.

To run the unit tests:
```bash
npm test
```

## License

This project is licensed under the [MIT License](LICENSE).

### Third-Party Attribution

This package bundles a prebuilt WebAssembly binary (`jpeg_worker.wasm`) compiled from **libjpeg-turbo**. 

- This software is based in part on the work of the Independent JPEG Group.
- The TurboJPEG API wrapper and build files are subject to the **Modified (3-Clause) BSD License**.

Full text of these upstream licenses can be found in the [LICENSE](LICENSE) file.
