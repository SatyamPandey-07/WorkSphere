# ==============================================================================
# Multi-Stage Dockerfile: Emscripten Toolchain Compilation for WASM Modules
#
# Compiles src/wasm/hrtf_engine.cpp into optimized WebAssembly (.wasm) and JS glue.
#
# Stage 1: Build environment using official Emscripten SDK (emscripten/emsdk)
# Stage 2: Minimal runtime image exporting compiled artifacts to public/wasm/
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Emscripten Compiler Build Stage
# ------------------------------------------------------------------------------
FROM emscripten/emsdk:3.1.50 AS wasm-builder

# Set working directory inside container
WORKDIR /build

# Copy C++ source files
COPY src/wasm/hrtf_engine.cpp ./hrtf_engine.cpp

# Create output directory
RUN mkdir -p /build/output

# Compile C++ source file using emcc with SIMD vectorization & O3 optimization
RUN emcc hrtf_engine.cpp \
    -O3 \
    -msimd128 \
    -s WASM=1 \
    -s EXPORTED_FUNCTIONS='["_malloc_scratch_buffer", "_free_scratch_buffer", "_process_hrtf_block", "_set_hrtf_simd_enabled", "_malloc", "_free"]' \
    -s EXPORTED_RUNTIME_METHODS='["cwrap", "setValue", "getValue", "HEAPF32"]' \
    -s INITIAL_MEMORY=6553600 \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s ENVIRONMENT='web,worker' \
    -s MODULARIZE=1 \
    -s EXPORT_NAME='createHrtfEngineModule' \
    -o /build/output/hrtf_engine.js

# ------------------------------------------------------------------------------
# Stage 2: Final Artifact Export Stage
# ------------------------------------------------------------------------------
FROM alpine:3.19 AS artifact-exporter

WORKDIR /dist

# Copy compiled WebAssembly binary and JavaScript loader from builder
COPY --from=wasm-builder /build/output/hrtf_engine.wasm ./public/wasm/hrtf_engine.wasm
COPY --from=wasm-builder /build/output/hrtf_engine.js ./public/wasm/hrtf_engine.js

# Default command lists generated artifacts
CMD ["ls", "-la", "./public/wasm/"]
