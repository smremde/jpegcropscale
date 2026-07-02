#!/bin/bash
set -e

# Clone libjpeg-turbo if it doesn't exist
if [ ! -d "libjpeg-turbo" ]; then
    git clone --depth 1 https://github.com/libjpeg-turbo/libjpeg-turbo.git
fi

# Build libjpeg-turbo to WASM static library
cd libjpeg-turbo
mkdir -p build-wasm && cd build-wasm

emcmake cmake -G"Unix Makefiles" \
  -DCMAKE_C_FLAGS="-O3 -msimd128" \
  -DENABLE_SHARED=0 \
  -DWITH_SIMD=0 \
  ..
emmake make turbojpeg-static -j$(nproc)
cd ../..

# Compile the final JavaScript/WASM worker wrapper
emcc jpeg_worker.c libjpeg-turbo/build-wasm/libturbojpeg.a -o jpeg_worker.js \
  -I./libjpeg-turbo/src \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s WASM=1 \
  -msimd128 \
  -O3 \
  -s EXPORTED_RUNTIME_METHODS='["ccall", "cwrap", "getValue"]' \
  -s EXPORTED_FUNCTIONS='["_process_jpeg", "_free_buffer", "_malloc", "_free"]'

echo "WASM Build complete! Artifacts: jpeg_worker.js & jpeg_worker.wasm"