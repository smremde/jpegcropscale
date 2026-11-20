#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <turbojpeg.h>
#include <emscripten.h>
#include <stdio.h>

// Last error message, read from JS via last_error() when a call returns failure.
static char lastError[512];

static void set_error(tjhandle handle, const char *context) {
    const char *msg = handle ? tj3GetErrorStr(handle) : "could not initialise TurboJPEG";
    snprintf(lastError, sizeof(lastError), "%s: %s", context, msg ? msg : "unknown error");
}

static void set_error_msg(const char *msg) {
    snprintf(lastError, sizeof(lastError), "%s", msg);
}

EMSCRIPTEN_KEEPALIVE
const char *last_error(void) {
    return lastError;
}

// Reads the JPEG header. info receives [width, height, subsampling, mcuWidth, mcuHeight].
// Returns 0 on success, -1 on failure (see last_error()).
EMSCRIPTEN_KEEPALIVE
int jpeg_info(const uint8_t *jpegBuf, size_t jpegSize, int *info) {
    tjhandle handle = tj3Init(TJINIT_DECOMPRESS);
    if (!handle) { set_error(NULL, "jpeg_info"); return -1; }

    int ret = 0;
    if (tj3DecompressHeader(handle, jpegBuf, jpegSize) < 0) {
        set_error(handle, "jpeg_info");
        ret = -1;
    } else {
        int subsamp = tj3Get(handle, TJPARAM_SUBSAMP);
        info[0] = tj3Get(handle, TJPARAM_JPEGWIDTH);
        info[1] = tj3Get(handle, TJPARAM_JPEGHEIGHT);
        info[2] = subsamp;
        // TJSAMP_UNKNOWN (-1) has no defined MCU size; libjpeg-turbo rejects unaligned crops itself.
        info[3] = subsamp >= 0 ? tjMCUWidth[subsamp] : 8;
        info[4] = subsamp >= 0 ? tjMCUHeight[subsamp] : 8;
    }
    tj3Destroy(handle);
    return ret;
}

// Losslessly crops n regions from one JPEG, decoding its DCT coefficients once.
// rects holds n * [x, y, w, h]. x and y must be multiples of the MCU size.
// On success dstBufs[i] / dstSizes[i] hold each output JPEG (free each with free_buffer) and 0 is
// returned. On failure every output is freed and -1 is returned (see last_error()).
// Warnings (e.g. a truncated or corrupt frame) are treated as errors.
EMSCRIPTEN_KEEPALIVE
int crop_tiles(const uint8_t *jpegBuf, size_t jpegSize, int n, const int *rects, int optimize,
               uint8_t **dstBufs, size_t *dstSizes) {
    if (n <= 0) { set_error_msg("crop_tiles: no regions requested"); return -1; }

    tjtransform *transforms = calloc((size_t)n, sizeof(tjtransform));
    if (!transforms) { set_error_msg("crop_tiles: out of memory"); return -1; }

    for (int i = 0; i < n; i++) {
        transforms[i].r.x = rects[i * 4 + 0];
        transforms[i].r.y = rects[i * 4 + 1];
        transforms[i].r.w = rects[i * 4 + 2];
        transforms[i].r.h = rects[i * 4 + 3];
        transforms[i].op = TJXOP_NONE;
        transforms[i].options = TJXOPT_CROP;
        dstBufs[i] = NULL;
        dstSizes[i] = 0;
    }

    int ret = 0;
    tjhandle handle = tj3Init(TJINIT_TRANSFORM);
    if (!handle) {
        set_error(NULL, "crop_tiles");
        ret = -1;
    } else {
        tj3Set(handle, TJPARAM_STOPONWARNING, 1);
        tj3Set(handle, TJPARAM_OPTIMIZE, optimize ? 1 : 0);
        if (tj3DecompressHeader(handle, jpegBuf, jpegSize) < 0) {
            set_error(handle, "crop_tiles");
            ret = -1;
        } else {
            // libjpeg-turbo pads a region that starts at 0 but extends past the image instead of
            // rejecting it, and gives no detail for others, so check bounds here.
            int width = tj3Get(handle, TJPARAM_JPEGWIDTH);
            int height = tj3Get(handle, TJPARAM_JPEGHEIGHT);
            for (int i = 0; i < n && ret == 0; i++) {
                tjregion r = transforms[i].r;
                if (r.x + r.w > width || r.y + r.h > height) {
                    snprintf(lastError, sizeof(lastError),
                             "crop_tiles: region %d (%d,%d %dx%d) exceeds the %dx%d image", i, r.x, r.y, r.w, r.h, width, height);
                    ret = -1;
                }
            }
        }
        if (ret == 0 && tj3Transform(handle, jpegBuf, jpegSize, n, dstBufs, dstSizes, transforms) < 0) {
            set_error(handle, "crop_tiles");
            ret = -1;
        }
        tj3Destroy(handle);
    }

    if (ret < 0) {
        for (int i = 0; i < n; i++) {
            tj3Free(dstBufs[i]);
            dstBufs[i] = NULL;
            dstSizes[i] = 0;
        }
    }
    free(transforms);
    return ret;
}

// Crops one region and optionally downscales it. Returns the output JPEG (free with free_buffer)
// or NULL on failure (see last_error()).
EMSCRIPTEN_KEEPALIVE
uint8_t *process_jpeg(uint8_t *jpegBuf, unsigned long jpegSize, int downscale, int cx, int cy, int cw, int ch, unsigned long *outSize) {
    int rect[4] = { cx, cy, cw, ch };
    uint8_t *croppedBuf = NULL;
    size_t croppedSize = 0;

    if (crop_tiles(jpegBuf, jpegSize, 1, rect, 0, &croppedBuf, &croppedSize) < 0)
        return NULL;

    if (downscale <= 1) {
        *outSize = croppedSize;
        return croppedBuf; // Lossless crop. JS frees it via free_buffer.
    }

    // Shrink-on-load decompression of the crop, then re-compression.
    uint8_t *finalBuf = NULL;
    uint8_t *imgPixels = NULL;
    size_t finalSize = 0;
    int subsamp, scaledW, scaledH;
    tjscalingfactor sf = { 1, downscale };
    tjhandle tjDec = tj3Init(TJINIT_DECOMPRESS);
    tjhandle tjComp = tj3Init(TJINIT_COMPRESS);
    if (!tjDec || !tjComp) { set_error(NULL, "process_jpeg"); goto done; }

    tj3Set(tjDec, TJPARAM_STOPONWARNING, 1);
    tj3Set(tjDec, TJPARAM_FASTUPSAMPLE, 1);
    if (tj3DecompressHeader(tjDec, croppedBuf, croppedSize) < 0) { set_error(tjDec, "process_jpeg"); goto done; }
    if (tj3SetScalingFactor(tjDec, sf) < 0) { set_error(tjDec, "process_jpeg"); goto done; }

    subsamp = tj3Get(tjDec, TJPARAM_SUBSAMP);
    scaledW = TJSCALED(tj3Get(tjDec, TJPARAM_JPEGWIDTH), sf);
    scaledH = TJSCALED(tj3Get(tjDec, TJPARAM_JPEGHEIGHT), sf);
    imgPixels = malloc((size_t)scaledW * scaledH * 3);
    if (!imgPixels) { set_error_msg("process_jpeg: out of memory"); goto done; }

    if (tj3Decompress8(tjDec, croppedBuf, croppedSize, imgPixels, 0, TJPF_RGB) < 0) { set_error(tjDec, "process_jpeg"); goto done; }

    tj3Set(tjComp, TJPARAM_SUBSAMP, subsamp < 0 ? TJSAMP_420 : subsamp);
    tj3Set(tjComp, TJPARAM_QUALITY, 85);
    tj3Set(tjComp, TJPARAM_FASTDCT, 1);
    if (tj3Compress8(tjComp, imgPixels, scaledW, 0, scaledH, TJPF_RGB, &finalBuf, &finalSize) < 0) {
        set_error(tjComp, "process_jpeg");
        tj3Free(finalBuf);
        finalBuf = NULL;
        goto done;
    }
    *outSize = finalSize;

done:
    free(imgPixels);
    tj3Free(croppedBuf);
    if (tjDec) tj3Destroy(tjDec);
    if (tjComp) tj3Destroy(tjComp);
    return finalBuf;
}

// Helper to free memory from JS. All output buffers are allocated by TurboJPEG.
EMSCRIPTEN_KEEPALIVE
void free_buffer(uint8_t *buf) {
    tj3Free(buf);
}
