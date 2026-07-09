import create_jpeg_worker from './jpeg_worker.mjs';

let jpeg_worker;
let isInitialized = false;

const ready = create_jpeg_worker().then((module) => {
    jpeg_worker = module;
    isInitialized = true;
});

/**
 * Resizes and scales a JPEG using a WASM-compiled libjpeg-turbo.
 * Designed for worker environments (returns Uint8Array instead of Node Buffer).
 * @param {Uint8Array} input - The input JPEG buffer.
 * @param {number} downscale - Power of two (1, 2, 4, 8).
 * @param {number} crop_left - X coordinate for crop (8-pixel aligned).
 * @param {number} crop_top - Y coordinate for crop (8-pixel aligned).
 * @param {number} crop_height - Height of the crop region.
 * @param {number} crop_width - Width of the crop region.
 * @returns {Uint8Array} - The processed JPEG buffer.
 */
function jpegtran(input, downscale, crop_left, crop_top, crop_height, crop_width) {

    if (!isInitialized) {
        throw new Error("jpegcropscale is not initialized yet. Please await jpegcropscale.ready before calling jpegtran().");
    }

    // input validation
    if (!input || input.length === 0) {
        throw new Error("Invalid input buffer provided.");
    }
    if (downscale <= 0) {
        throw new Error("Downscale must be positive.");
    }
    if (crop_left < 0 || crop_top < 0 || crop_width <= 0 || crop_height <= 0) {
        throw new Error("Crop dimensions must be positive and non-zero.");
    }
    if (crop_width % 8 !== 0 || crop_height % 8 !== 0) {
        throw new Error("Crop width and height must be 8-pixel aligned.");
    }
    if (crop_left % 8 !== 0 || crop_top % 8 !== 0) {
        throw new Error("Crop coordinates must be 8-pixel aligned.");
    }

    // 1. Allocate memory in WASM for the input buffer
    const inputPtr = jpeg_worker._malloc(input.length);
    
    // 2. Copy the JS buffer into WASM memory space
    jpeg_worker.HEAPU8.set(input, inputPtr);

    // 3. Allocate a 4-byte pointer in WASM to hold the output size
    const outSizePtr = jpeg_worker._malloc(4);

    try {
        // 4. Call the C function via WebAssembly
        const outputPtr = jpeg_worker.ccall(
            'process_jpeg',       // C function name
            'number',             // Return type (pointer to final buffer)
            ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number'], // Arg types
            [
                inputPtr, 
                input.length, 
                downscale, 
                crop_left, 
                crop_top, 
                crop_width, 
                crop_height, 
                outSizePtr
            ]
        );

        if (outputPtr === 0) {
            throw new Error("WASM libjpeg processing failed.");
        }

        // 5. Read the output size from the pointer
        const outSize = jpeg_worker.getValue(outSizePtr, 'i32');

        // 6. Extract the processed JPEG bytes from WASM memory back to JS
        const resultView = new Uint8Array(jpeg_worker.HEAPU8.buffer, outputPtr, outSize);
        
        // Copy the data so we can free the WASM memory safely
        const finalBuffer = new Uint8Array(resultView);

        // 7. Free the output buffer allocated by TurboJPEG
        jpeg_worker.ccall('free_buffer', null, ['number'], [outputPtr]);

        return finalBuffer;

    } finally {
        // 8. Always clean up input and pointer memory to prevent memory leaks
        jpeg_worker._free(inputPtr);
        jpeg_worker._free(outSizePtr);
    }
}

export { jpegtran, ready };
