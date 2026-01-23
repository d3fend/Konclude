ARG EMSDK_VERSION=1.39.8
ARG QT_VERSION=5.15.2
ARG QT_SRC_URL=https://download.qt.io/archive/qt/5.15/5.15.2/single/qt-everywhere-src-5.15.2.tar.xz
ARG QT_SRC_DIR=qt-everywhere-src-5.15.2
ARG QT_CONFIGURE_FLAGS="-xplatform wasm-emscripten -nomake examples -nomake tests -opensource -confirm-license -prefix /opt/qt-wasm -feature-thread"
ARG KONCLUDE_WASM_TOTAL_MEMORY=2147483648
ARG KONCLUDE_WASM_PTHREAD_POOL=
ARG KONCLUDE_WASM_PTHREAD_OVERHEAD=
ARG KONCLUDE_WASM_PROCESSOR_COUNT=
ARG KONCLUDE_WASM_PTHREAD_STRICT=
ARG KONCLUDE_WASM_DEBUG=0
ARG KONCLUDE_WASM_STACK_SIZE=
ARG KONCLUDE_WASM_PTHREAD_STACK_SIZE=16777216

FROM ubuntu:22.04 AS toolchain
ARG EMSDK_VERSION
ARG QT_VERSION
ARG QT_SRC_URL
ARG QT_SRC_DIR
ARG QT_CONFIGURE_FLAGS

RUN apt-get update && apt-get install -y \
    build-essential \
    ca-certificates \
    cmake \
    curl \
    flex \
    gperf \
    git \
    ninja-build \
    perl \
    pkg-config \
    python3 \
    python3-distutils \
    python-is-python3 \
    bison \
    unzip \
    xz-utils \
  && rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 --branch "${EMSDK_VERSION}" https://github.com/emscripten-core/emsdk.git /opt/emsdk
RUN /opt/emsdk/emsdk install "${EMSDK_VERSION}" && /opt/emsdk/emsdk activate "${EMSDK_VERSION}"

RUN mkdir -p /opt/qt-src
RUN curl -L "${QT_SRC_URL}" -o /opt/qt-src/qt-src.tar.xz
RUN tar -xJf /opt/qt-src/qt-src.tar.xz -C /opt/qt-src

# Patch Qt 5.15.2 for Emscripten: ensure <limits> is available
COPY wasm/patches/qt-5.15.2-emscripten-qfloat16.patch /opt/qt-src/qt-patch-qfloat16.patch
COPY wasm/patches/qt-5.15.2-emscripten-qglobal-limits.patch /opt/qt-src/qt-patch-qglobal.patch
RUN /bin/bash -lc "cd /opt/qt-src/${QT_SRC_DIR} && \
    patch -p1 < /opt/qt-src/qt-patch-qfloat16.patch && \
    patch -p1 < /opt/qt-src/qt-patch-qglobal.patch"

RUN /bin/bash -lc "source /opt/emsdk/emsdk_env.sh && \
    which em++ && em++ --version && python --version && \
    cd /opt/qt-src/${QT_SRC_DIR} && \
    ./configure ${QT_CONFIGURE_FLAGS} && \
    make -j\$(nproc) && \
    make install"

FROM toolchain AS build
ARG KONCLUDE_WASM_TOTAL_MEMORY
ARG KONCLUDE_WASM_PTHREAD_POOL
ARG KONCLUDE_WASM_PTHREAD_OVERHEAD
ARG KONCLUDE_WASM_PROCESSOR_COUNT
ARG KONCLUDE_WASM_DEBUG
ARG KONCLUDE_WASM_STACK_SIZE
ARG KONCLUDE_WASM_PTHREAD_STACK_SIZE

WORKDIR /src
COPY . /src

RUN /bin/bash -lc "export EMSDK_DIR=/opt/emsdk; \
    export QT_WASM_DIR=/opt/qt-wasm; \
    export KONCLUDE_WASM_TOTAL_MEMORY=${KONCLUDE_WASM_TOTAL_MEMORY}; \
    export KONCLUDE_WASM_PTHREAD_POOL=${KONCLUDE_WASM_PTHREAD_POOL}; \
    export KONCLUDE_WASM_PTHREAD_OVERHEAD=${KONCLUDE_WASM_PTHREAD_OVERHEAD}; \
    export KONCLUDE_WASM_PROCESSOR_COUNT=${KONCLUDE_WASM_PROCESSOR_COUNT}; \
    export KONCLUDE_WASM_PTHREAD_STRICT=${KONCLUDE_WASM_PTHREAD_STRICT}; \
    export KONCLUDE_WASM_DEBUG=${KONCLUDE_WASM_DEBUG}; \
    export KONCLUDE_WASM_STACK_SIZE=${KONCLUDE_WASM_STACK_SIZE}; \
    export KONCLUDE_WASM_PTHREAD_STACK_SIZE=${KONCLUDE_WASM_PTHREAD_STACK_SIZE}; \
    /src/wasm/scripts/build_wasm_all.sh"

RUN mkdir -p /out && cp -r /src/wasm/dist/* /out/

FROM scratch AS artifact
COPY --from=build /out /out
