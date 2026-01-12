#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck disable=SC1090
source "${ROOT_DIR}/wasm/scripts/env.sh"

${ROOT_DIR}/wasm/scripts/generate_wasm_pri.sh

if [[ -n "${KONCLUDE_WASM_PTHREAD_POOL:-}" ]]; then
	export EMCC_CFLAGS="${EMCC_CFLAGS:-} -s PTHREAD_POOL_SIZE=${KONCLUDE_WASM_PTHREAD_POOL}"
	export EMCC_CXXFLAGS="${EMCC_CXXFLAGS:-} -s PTHREAD_POOL_SIZE=${KONCLUDE_WASM_PTHREAD_POOL}"
	export EMCC_LDFLAGS="${EMCC_LDFLAGS:-} -s PTHREAD_POOL_SIZE=${KONCLUDE_WASM_PTHREAD_POOL}"
fi

JOBS="${JOBS:-}"
if [[ -z "${JOBS}" ]]; then
	if command -v nproc >/dev/null 2>&1; then
		JOBS="$(nproc)"
	else
		JOBS="$(sysctl -n hw.ncpu 2>/dev/null || echo 2)"
	fi
fi

BUILD_DIR="${ROOT_DIR}/wasm/build/mt"
DEST_DIR="${ROOT_DIR}/wasm/dist/mt"

mkdir -p "${BUILD_DIR}" "${DEST_DIR}"
pushd "${BUILD_DIR}" >/dev/null

"${QMAKE}" "${ROOT_DIR}/KoncludeWasm.pro" \
	KONCLUDE_WASM_THREADS=1 \
	KONCLUDE_WASM_TARGET=konclude_mt \
	KONCLUDE_WASM_DESTDIR="${DEST_DIR}" \
	KONCLUDE_WASM_TOTAL_MEMORY="${KONCLUDE_WASM_TOTAL_MEMORY}" \
	KONCLUDE_WASM_PTHREAD_POOL="${KONCLUDE_WASM_PTHREAD_POOL:-}"

make -j"${JOBS}"

popd >/dev/null
