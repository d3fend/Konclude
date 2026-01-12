#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck disable=SC1090
source "${ROOT_DIR}/wasm/scripts/env.sh"

"${ROOT_DIR}/wasm/scripts/build_wasm_mt.sh"

if [[ "${KONCLUDE_WASM_BUILD_ST:-0}" == "1" ]]; then
	"${ROOT_DIR}/wasm/scripts/build_wasm_st.sh"
fi

GIT_REV="unknown"
if command -v git >/dev/null 2>&1; then
	GIT_REV="$(git -C "${ROOT_DIR}" rev-parse HEAD 2>/dev/null || echo unknown)"
fi

BUILD_DATE=""
if [[ -n "${SOURCE_DATE_EPOCH:-}" ]]; then
	BUILD_DATE="$(date -u -d "@${SOURCE_DATE_EPOCH}" +%Y-%m-%dT%H:%M:%SZ)"
fi

cat > "${ROOT_DIR}/wasm/dist/build-info.json" <<EOF
{
  "git_revision": "${GIT_REV}",
  "emsdk_version": "${EMSDK_VERSION}",
  "qt_version": "${QT_VERSION}",
  "qt_src_url": "${QT_SRC_URL}"$( [[ -n "${BUILD_DATE}" ]] && printf ',\n  "build_date_utc": "%s"' "${BUILD_DATE}" )
}
EOF
