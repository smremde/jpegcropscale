#!/bin/bash
set -e

# Clone libjpeg-turbo if it doesn't exist
if [ ! -d "libjpeg-turbo" ]; then
    git clone --depth 1 --branch 3.0.2 https://github.com/libjpeg-turbo/libjpeg-turbo.git
fi

# Build libjpeg-turbo to WASM static library
cd libjpeg-turbo
mkdir -p build-wasm && cd build-wasm

emcmake cmake -G"Unix Makefiles" \
  -DCMAKE_C_FLAGS="-O3 -msimd128 -DSIZE_T=4" \
  -DSIZE_T=4 \
  -DENABLE_SHARED=0 \
  -DWITH_SIMD=0 \
  ..
emmake make turbojpeg-static -j$(nproc)
cd ../..

# Common Emscripten compilation flags as a bash array to handle quotes properly
COMMON_FLAGS=(
  -I./libjpeg-turbo
  -I./libjpeg-turbo/src
  -I./libjpeg-turbo/build-wasm
  -s ALLOW_MEMORY_GROWTH=1
  -s WASM=1
  -s SINGLE_FILE=1
  -msimd128
  -O3
  -s EXPORTED_RUNTIME_METHODS='["ccall", "cwrap", "getValue"]'
  -s EXPORTED_FUNCTIONS='["_process_jpeg", "_free_buffer", "_malloc", "_free"]'
)

# Create output directories
mkdir -p dist/node dist/web dist/worker

echo "Compiling Node.js target..."
emcc jpeg_worker.c libjpeg-turbo/build-wasm/libturbojpeg.a -o dist/node/jpeg_worker.js \
  "${COMMON_FLAGS[@]}" \
  -s ENVIRONMENT=node

echo "Compiling Web target..."
emcc jpeg_worker.c libjpeg-turbo/build-wasm/libturbojpeg.a -o dist/web/jpeg_worker.mjs \
  "${COMMON_FLAGS[@]}" \
  -s ENVIRONMENT=web \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1

echo "Compiling Worker target..."
emcc jpeg_worker.c libjpeg-turbo/build-wasm/libturbojpeg.a -o dist/worker/jpeg_worker.mjs \
  "${COMMON_FLAGS[@]}" \
  -s ENVIRONMENT=worker \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1

echo "WASM Build complete! Artifacts generated in dist/"
