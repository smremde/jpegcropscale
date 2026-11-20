import create_jpeg_worker from './jpeg_worker.mjs';

let jpeg_worker;
let isInitialized = false;

const ready = create_jpeg_worker().then((module) => {
    jpeg_worker = module;
    isInitialized = true;
});

// Output type for this environment (web/browser): a Uint8Array copy, not a Node Buffer.
const toOutput = (view) => new Uint8Array(view);

// ---- shared wrapper body (keep identical across dist/node, dist/web and dist/worker) ----

function assertReady(fn) {
    if (!isInitialized) {
        throw new Error(`jpegcropscale is not initialized yet. Please await jpegcropscale.ready before calling ${fn}().`);
    }
}

function assertInput(input) {
    if (!input || input.length === 0) {
        throw new Error("Invalid input buffer provided.");
    }
}

function lastError() {
    return jpeg_worker.UTF8ToString(jpeg_worker.ccall('last_error', 'number', [], []));
}

// Copies the input JPEG into the WASM heap. The caller must _free the returned pointer.
function copyIn(input) {
    const ptr = jpeg_worker._malloc(input.length);
    if (!ptr) throw new Error("Out of WASM memory.");
    jpeg_worker.HEAPU8.set(input, ptr);
    return ptr;
}

/**
 * Reads a JPEG's header.
 * @param {Buffer|Uint8Array} input - The input JPEG buffer.
 * @returns {{width: number, height: number, subsampling: number, mcuWidth: number, mcuHeight: number}}
 *   subsampling is a TurboJPEG TJSAMP value (-1 if unknown). Crop offsets must be multiples of
 *   mcuWidth / mcuHeight (16x16 for 4:2:0).
 */
function getInfo(input) {
    assertReady('getInfo');
    assertInput(input);

    const inputPtr = copyIn(input);
    const infoPtr = jpeg_worker._malloc(5 * 4);
    try {
        if (!infoPtr) throw new Error("Out of WASM memory.");
        if (jpeg_worker.ccall('jpeg_info', 'number', ['number', 'number', 'number'], [inputPtr, input.length, infoPtr]) < 0) {
            throw new Error(lastError());
        }
        const info = jpeg_worker.HEAP32.subarray(infoPtr >> 2, (infoPtr >> 2) + 5);
        return { width: info[0], height: info[1], subsampling: info[2], mcuWidth: info[3], mcuHeight: info[4] };
    } finally {
        jpeg_worker._free(inputPtr);
        jpeg_worker._free(infoPtr);
    }
}

/**
 * Losslessly crops several regions from one JPEG. The JPEG's DCT coefficients are decoded once and
 * shared by every crop, so cutting many tiles from a frame costs little more than cutting one.
 * No pixels are decoded or re-compressed: each output keeps the source's quality.
 * Truncated or corrupt input throws rather than returning a partial image.
 * @param {Buffer|Uint8Array} input - The input JPEG buffer.
 * @param {Array<{left: number, top: number, width: number, height: number}>} regions - Regions to
 *   crop. left/top must be multiples of the MCU size (see getInfo); regions must lie inside the image.
 * @param {{optimize?: boolean}} [options] - optimize: compute optimal Huffman tables per output
 *   (smaller outputs, slower).
 * @returns {Buffer[]} - One JPEG per region, in the same order.
 */
function cropTiles(input, regions, options = {}) {
    assertReady('cropTiles');
    assertInput(input);
    if (!Array.isArray(regions) || regions.length === 0) {
        throw new Error("regions must be a non-empty array.");
    }

    const n = regions.length;
    const rects = new Int32Array(n * 4);
    regions.forEach((r, i) => {
        const v = [r.left, r.top, r.width, r.height];
        if (!v.every(Number.isInteger) || r.left < 0 || r.top < 0 || r.width <= 0 || r.height <= 0) {
            throw new Error(`Invalid region at index ${i}: left/top must be non-negative integers and width/height positive integers.`);
        }
        rects.set(v, i * 4);
    });

    const inputPtr = copyIn(input);
    const rectsPtr = jpeg_worker._malloc(rects.byteLength);
    const bufsPtr = jpeg_worker._malloc(n * 4);
    const sizesPtr = jpeg_worker._malloc(n * 4);
    let ok = false;
    try {
        if (!rectsPtr || !bufsPtr || !sizesPtr) throw new Error("Out of WASM memory.");
        jpeg_worker.HEAP32.set(rects, rectsPtr >> 2);

        const ret = jpeg_worker.ccall('crop_tiles', 'number',
            ['number', 'number', 'number', 'number', 'number', 'number', 'number'],
            [inputPtr, input.length, n, rectsPtr, options.optimize ? 1 : 0, bufsPtr, sizesPtr]);
        if (ret < 0) {
            throw new Error(lastError());
        }
        ok = true;

        // Read the heap views after the call: memory growth replaces them.
        const bufs = jpeg_worker.HEAPU32.slice(bufsPtr >> 2, (bufsPtr >> 2) + n);
        const sizes = jpeg_worker.HEAPU32.slice(sizesPtr >> 2, (sizesPtr >> 2) + n);
        const out = new Array(n);
        for (let i = 0; i < n; i++) {
            out[i] = toOutput(jpeg_worker.HEAPU8.subarray(bufs[i], bufs[i] + sizes[i]));
        }
        return out;
    } finally {
        if (ok) {
            const bufs = jpeg_worker.HEAPU32.slice(bufsPtr >> 2, (bufsPtr >> 2) + n);
            for (let i = 0; i < n; i++) jpeg_worker._free_buffer(bufs[i]);
        }
        jpeg_worker._free(inputPtr);
        jpeg_worker._free(rectsPtr);
        jpeg_worker._free(bufsPtr);
        jpeg_worker._free(sizesPtr);
    }
}

/**
 * Crops a JPEG and optionally downscales it using a WASM-compiled libjpeg-turbo.
 * With downscale 1 the crop is lossless (no re-compression).
 * @param {Buffer|Uint8Array} input - The input JPEG buffer.
 * @param {number} downscale - Power of two (1, 2, 4, 8).
 * @param {number} crop_left - X coordinate for crop (multiple of the MCU width, see getInfo).
 * @param {number} crop_top - Y coordinate for crop (multiple of the MCU height, see getInfo).
 * @param {number} crop_height - Height of the crop region.
 * @param {number} crop_width - Width of the crop region.
 * @returns The processed JPEG.
 */
function jpegtran(input, downscale, crop_left, crop_top, crop_height, crop_width) {
    assertReady('jpegtran');
    assertInput(input);

    if (downscale <= 0) {
        throw new Error("Downscale must be positive.");
    }
    if (crop_left < 0 || crop_top < 0 || crop_width <= 0 || crop_height <= 0) {
        throw new Error("Crop dimensions must be positive and non-zero.");
    }
    if (crop_left % 8 !== 0 || crop_top % 8 !== 0) {
        throw new Error("Crop coordinates must be 8-pixel aligned.");
    }

    const inputPtr = copyIn(input);
    const outSizePtr = jpeg_worker._malloc(4);

    try {
        if (!outSizePtr) throw new Error("Out of WASM memory.");
        const outputPtr = jpeg_worker.ccall(
            'process_jpeg',
            'number',
            ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number'],
            [inputPtr, input.length, downscale, crop_left, crop_top, crop_width, crop_height, outSizePtr]
        );

        if (outputPtr === 0) {
            throw new Error(lastError());
        }

        try {
            const outSize = jpeg_worker.getValue(outSizePtr, 'i32');
            return toOutput(jpeg_worker.HEAPU8.subarray(outputPtr, outputPtr + outSize));
        } finally {
            jpeg_worker._free_buffer(outputPtr);
        }
    } finally {
        jpeg_worker._free(inputPtr);
        jpeg_worker._free(outSizePtr);
    }
}

// ---- end shared wrapper body ----

export { jpegtran, cropTiles, getInfo, ready };
