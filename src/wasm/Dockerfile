FROM emscripten/emsdk:3.1.51

# Install wget, make
RUN apt-get update && apt-get install -y wget build-essential python3

WORKDIR /src
# Download OpenSSL 3.1.4
RUN wget https://www.openssl.org/source/openssl-3.1.4.tar.gz && \
    tar -xf openssl-3.1.4.tar.gz

WORKDIR /src/openssl-3.1.4

# Configure OpenSSL for emscripten
RUN emconfigure ./Configure linux-generic32 \
    no-asm \
    no-shared \
    no-threads \
    no-hw \
    no-engine \
    no-dso \
    --prefix=/opt/openssl

# Build OpenSSL (only libcrypto to save time and space)
RUN emmake make build_generated -j4
RUN emmake make libcrypto.a -j4
RUN emmake make install_dev

# Copy our wrapper
COPY pdf_verify.cpp /src/
WORKDIR /src

# Compile to WASM
RUN emcc pdf_verify.cpp -o pdf-verify.js \
    -O3 \
    -s WASM=1 \
    -s MODULARIZE=1 \
    -s EXPORT_NAME="createPdfVerifyModule" \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s EXPORTED_RUNTIME_METHODS='["ccall", "cwrap"]' \
    -s EXPORTED_FUNCTIONS='["_verifySignature", "_malloc", "_free"]' \
    -I/opt/openssl/include \
    -L/opt/openssl/lib \
    -lcrypto
