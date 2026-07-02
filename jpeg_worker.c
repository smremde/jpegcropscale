#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <turbojpeg.h>
#include <emscripten.h>
#include <stdio.h>

// Exported function to be called from JS
EMSCRIPTEN_KEEPALIVE
uint8_t* process_jpeg(uint8_t* jpegBuf, unsigned long jpegSize, int downscale, int cx, int cy, int cw, int ch, unsigned long* outSize) {
    tjhandle tjInst = tjInitTransform();
    
    tjtransform transform;
    memset(&transform, 0, sizeof(tjtransform));
    transform.r.x = cx;
    transform.r.y = cy;
    transform.r.w = cw;
    transform.r.h = ch;
    transform.op = TJXOP_NONE;
    transform.options = TJXOPT_CROP;
    
    uint8_t* croppedBuf = NULL;
    unsigned long croppedSize = 0;
    
    // Perform the lossless crop
    tjTransform(tjInst, jpegBuf, jpegSize, 1, &croppedBuf, &croppedSize, &transform, 0);
    tjDestroy(tjInst);
.
    if (downscale <= 1) {
        *outSize = croppedSize;
        return croppedBuf; // Return the lossless JPEG directly! JS will still free it via free_buffer.
    }

    // 2. Shrink-on-load Decompression (Only runs if downscale > 1)
    tjhandle tjDec = tjInitDecompress();
    int width, height, subsamp, colorspace;
    tjDecompressHeader3(tjDec, croppedBuf, croppedSize, &width, &height, &subsamp, &colorspace);
    
    int scaledW = width / downscale;
    int scaledH = height / downscale;
    uint8_t* imgPixels = (uint8_t*)malloc(scaledW * scaledH * 3);
    
    tjDecompress2(tjDec, croppedBuf, croppedSize, imgPixels, scaledW, 0, scaledH, TJPF_RGB, TJFLAG_FASTUPSAMPLE);
    tjDestroy(tjDec);
    tjFree(croppedBuf); // Clean up the intermediate crop buffer since we extracted the raw pixels

    // 3. Fast Re-compression
    tjhandle tjComp = tjInitCompress();
    uint8_t* finalBuf = NULL;
    
    tjCompress2(tjComp, imgPixels, scaledW, 0, scaledH, TJPF_RGB, &finalBuf, outSize, subsamp, 85, TJFLAG_FASTDCT);
    
    tjDestroy(tjComp);
    free(imgPixels);
    
    return finalBuf;
}

// Helper to free memory from JS
EMSCRIPTEN_KEEPALIVE
void free_buffer(uint8_t* buf) {
    // Both croppedBuf (from tjTransform) and finalBuf (from tjCompress2) 
    // are allocated internally by TurboJPEG, so tjFree cleans both up correctly.
    if (buf) {
        tjFree(buf);
    }
}