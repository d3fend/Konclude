#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Optional defaults pinned in wasm/versions.env.
# shellcheck disable=SC1090
source "${ROOT_DIR}/wasm/versions.env"

: "${EMSDK_DIR:?Set EMSDK_DIR to your emsdk path (e.g., /opt/emsdk)}"
: "${QT_WASM_DIR:?Set QT_WASM_DIR to your Qt 5.15 wasm prefix (e.g., /opt/qt-wasm)}"

# Load emsdk environment (emcc, node, etc.).
# shellcheck disable=SC1090
source "${EMSDK_DIR}/emsdk_env.sh"

export PATH="${QT_WASM_DIR}/bin:${PATH}"
export QMAKE="${QT_WASM_DIR}/bin/qmake"

# Pass default memory sizing into qmake if set.
export KONCLUDE_WASM_TOTAL_MEMORY
export KONCLUDE_WASM_PTHREAD_POOL
