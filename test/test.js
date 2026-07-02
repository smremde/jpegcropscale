const fs = require('fs');
const path = require('path');
const { jpegtran, ready } = require('../index.js');

async function run() {
    try {
        const inputPath = path.join(__dirname, 'image.jpg');
        const outputPath = path.join(__dirname, 'output.jpg');

        console.log('Reading input image from:', inputPath);
        const inputBuffer = fs.readFileSync(inputPath);
        console.log('Input buffer size:', inputBuffer.length, 'bytes');

        // Wait for WebAssembly to load and initialize
        console.log('Waiting for WebAssembly runtime to be ready...');
        await ready;
        console.log('WebAssembly is ready!');

        // Run jpegtran: downscale = 2, crop at (16, 16) with width=128, height=128
        console.log('Running jpegtran (crop + downscale = 2)...');
        const outputBuffer = jpegtran(inputBuffer, 2, 16, 16, 128, 128);

        console.log('Successfully completed jpegtran!');
        console.log('Output buffer size:', outputBuffer.length, 'bytes');

        fs.writeFileSync(outputPath, outputBuffer);
        console.log('Wrote output image to:', outputPath);

        // Also let's test a simple crop without scaling (downscale = 1)
        const outputPathCropOnly = path.join(__dirname, 'output_crop.jpg');
        console.log('Running jpegtran (crop-only, downscale=1)...');
        const outputBufferCrop = jpegtran(inputBuffer, 1, 16, 16, 128, 128);
        fs.writeFileSync(outputPathCropOnly, outputBufferCrop);
        console.log('Wrote crop-only output image to:', outputPathCropOnly);

    } catch (err) {
        console.error('Test failed with error:', err);
        process.exit(1);
    }
}

run();
