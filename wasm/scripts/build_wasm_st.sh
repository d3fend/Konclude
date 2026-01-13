#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck disable=SC1090
source "${ROOT_DIR}/wasm/scripts/env.sh"

${ROOT_DIR}/wasm/scripts/generate_wasm_pri.sh

JOBS="${JOBS:-}"
if [[ -z "${JOBS}" ]]; then
	if command -v nproc >/dev/null 2>&1; then
		JOBS="$(nproc)"
	else
		JOBS="$(sysctl -n hw.ncpu 2>/dev/null || echo 2)"
	fi
fi

BUILD_DIR="${ROOT_DIR}/wasm/build/st"
DEST_DIR="${ROOT_DIR}/wasm/dist/st"

mkdir -p "${BUILD_DIR}" "${DEST_DIR}"
pushd "${BUILD_DIR}" >/dev/null

"${QMAKE}" "${ROOT_DIR}/KoncludeWasm.pro" \
	KONCLUDE_WASM_TARGET=konclude_st \
	KONCLUDE_WASM_DESTDIR="${DEST_DIR}" \
	KONCLUDE_WASM_TOTAL_MEMORY="${KONCLUDE_WASM_TOTAL_MEMORY}" \
	KONCLUDE_WASM_PROCESSOR_COUNT="${KONCLUDE_WASM_PROCESSOR_COUNT:-}"

make -j"${JOBS}"

popd >/dev/null
