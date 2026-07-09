import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { jpegtran, ready } from '../dist/web/index.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
    try {
        const inputPath = path.join(__dirname, 'image.jpg');
        const outputPath = path.join(__dirname, 'output_web.jpg');

        console.log('[Web Test] Reading input image from:', inputPath);
        const inputBuffer = fs.readFileSync(inputPath);
        // Convert Node Buffer to a raw Uint8Array to simulate browser environment
        const inputUint8Array = new Uint8Array(inputBuffer);
        console.log('[Web Test] Input buffer size:', inputUint8Array.length, 'bytes');

        // Wait for WebAssembly to load and initialize
        console.log('[Web Test] Waiting for WebAssembly runtime to be ready...');
        await ready;
        console.log('[Web Test] WebAssembly is ready!');

        // Run jpegtran: downscale = 2, crop at (16, 16) with width=128, height=128
        console.log('[Web Test] Running jpegtran (crop + downscale = 2)...');
        const outputBuffer = jpegtran(inputUint8Array, 2, 16, 16, 128, 128);

        console.log('[Web Test] Successfully completed jpegtran!');
        console.log('[Web Test] Output type:', outputBuffer.constructor.name);
        console.log('[Web Test] Output buffer size:', outputBuffer.length, 'bytes');

        // Check that output is indeed a Uint8Array, but NOT a Buffer
        if (outputBuffer.constructor.name !== 'Uint8Array') {
            throw new Error(`Expected output type to be Uint8Array, but got ${outputBuffer.constructor.name}`);
        }

        fs.writeFileSync(outputPath, outputBuffer);
        console.log('[Web Test] Wrote output image to:', outputPath);

    } catch (err) {
        console.error('[Web Test] Test failed with error:', err);
        process.exit(1);
    }
}

run();
