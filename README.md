# @smremde/jpegcropscale

High-performance lossless JPEG crop, multi-tile crop and power-of-two downscale library powered by `libjpeg-turbo` compiled to WebAssembly.

Because it contains a prebuilt `.wasm` binary, users do not need `emscripten`, `docker`, or native compilers to use this package.

## Features

- **Lossless JPEG Crop**: Crops in the DCT domain using `libjpeg-turbo`'s transform capabilities, with no decode or re-compression, so the output keeps the source's quality.
- **Multi-Tile Crop**: `cropTiles()` decodes a JPEG's coefficients once and cuts any number of regions from them, so tiling a whole image costs little more than cutting one tile (e.g. all 128 512x512 tiles of an 8192x4096 frame in ~185ms).
- **Fast Power-of-Two Downscale**: Uses `libjpeg-turbo`'s shrink-on-load (scaled IDCT) decompression. Note that libjpeg-turbo's SIMD code is not available in WebAssembly, so decoding runs at scalar speed.
- **Safe on Bad Input**: Truncated or corrupt JPEGs throw an error with `libjpeg-turbo`'s message rather than returning a partial image.
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

### Tiling an image

```javascript
const { cropTiles, getInfo, ready } = require('@smremde/jpegcropscale');

await ready;
const { width, height } = getInfo(inputBuffer);

const regions = [];
for (let top = 0; top < height; top += 512)
    for (let left = 0; left < width; left += 512)
        regions.push({ left, top, width: Math.min(512, width - left), height: Math.min(512, height - top) });

const tiles = cropTiles(inputBuffer, regions); // one lossless JPEG per region, same order
```

## API Reference

### `ready`
- **Type**: `Promise<void>`
- **Description**: Resolves once the WebAssembly module has successfully compiled and initialized. Always await this before calling any other function.

### `getInfo(input)`
- **Arguments**:
  - `input` (`Buffer` | `Uint8Array`): Input JPEG buffer.
- **Returns**: `{ width, height, subsampling, mcuWidth, mcuHeight }`. `subsampling` is a TurboJPEG `TJSAMP` value (`-1` if unknown). Crop offsets must be multiples of `mcuWidth` / `mcuHeight` (16x16 for 4:2:0, 8x8 for 4:4:4 and greyscale).

### `cropTiles(input, regions, options?)`
- **Arguments**:
  - `input` (`Buffer` | `Uint8Array`): Input JPEG buffer.
  - `regions` (`Array<{ left, top, width, height }>`): Regions to crop. `left` and `top` must be multiples of the MCU size (see `getInfo`). Each region must lie inside the image; `width` and `height` need not be aligned, so edge tiles can be cropped exactly.
  - `options.optimize` (`boolean`, default `false`): Compute optimal Huffman tables for each output. About 5% smaller tiles for about 50% more time.
- **Returns**: An array of JPEGs (`Buffer` in Node.js, `Uint8Array` in the web and worker builds), one per region, in the same order.
- **Notes**: The crops are lossless. Truncated or corrupt input, misaligned offsets and out-of-bounds regions throw. Each call is synchronous and decodes the whole JPEG's coefficients into the WASM heap (about 100MB for an 8192x4096 4:2:0 image), so in a server run it off the main thread (e.g. a `worker_threads` Worker).

### `jpegtran(input, downscale, crop_left, crop_top, crop_height, crop_width)`
- **Arguments**:
  - `input` (`Buffer` | `Uint8Array`): Input JPEG buffer.
  - `downscale` (`number`): Downscaling factor. Must be a positive integer power of two (`1`, `2`, `4`, or `8`). `1` performs crop-only without re-compression or resizing.
  - `crop_left` (`number`): X coordinate for the top-left of the crop region. Must be a multiple of the MCU width (8, or 16 for 4:2:0 / 4:2:2; see `getInfo`).
  - `crop_top` (`number`): Y coordinate for the top-left of the crop region. Must be a multiple of the MCU height (8, or 16 for 4:2:0; see `getInfo`).
  - `crop_height` (`number`): Height of the crop region. Must be positive.
  - `crop_width` (`number`): Width of the crop region. Must be positive.

  Note the argument order: height comes before width.
- **Returns**: `Buffer` (Node.js Buffer containing the processed JPEG).

## Constraints and Validation

To maintain lossless transform guarantees and compatibility with JPEG MCU block structures, the library enforces:
- Crop offsets must be non-negative multiples of the MCU size (8, or 16 for chroma-subsampled axes).
- Crop width and height must be positive, and the crop must lie inside the image.
- `downscale` must be positive.
- Truncated or corrupt JPEGs are rejected (libjpeg-turbo warnings are treated as errors).

If these constraints are violated, the function throws an explicit, helpful error message.

## Developing and Building

If you wish to build the WebAssembly binary from source yourself:

1. Ensure you have Docker or Emscripten installed.
2. Run the build script, either directly with Emscripten or in the same image CI uses:
   ```bash
   ./build.sh
   # or
   docker run --rm -u $(id -u):$(id -g) -v "$PWD":/src emscripten/emsdk:3.1.64 bash build.sh
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
