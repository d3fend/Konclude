#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck disable=SC1090
source "${ROOT_DIR}/wasm/versions.env"

IMAGE_TAG="${IMAGE_TAG:-konclude-wasm-build:qt5.15}"

docker build \
	-f "${ROOT_DIR}/wasm/docker/Dockerfile" \
	-t "${IMAGE_TAG}" \
	--build-arg EMSDK_VERSION="${EMSDK_VERSION}" \
	--build-arg QT_VERSION="${QT_VERSION}" \
	--build-arg QT_SRC_URL="${QT_SRC_URL}" \
	--build-arg QT_SRC_DIR="${QT_SRC_DIR}" \
	--build-arg KONCLUDE_WASM_TOTAL_MEMORY="${KONCLUDE_WASM_TOTAL_MEMORY}" \
	--build-arg KONCLUDE_WASM_PTHREAD_POOL="${KONCLUDE_WASM_PTHREAD_POOL}" \
	"${ROOT_DIR}"

CONTAINER_ID="$(docker create "${IMAGE_TAG}" /bin/true)"
rm -rf "${ROOT_DIR}/wasm/dist"
mkdir -p "${ROOT_DIR}/wasm/dist"
docker cp "${CONTAINER_ID}:/out/." "${ROOT_DIR}/wasm/dist"
docker rm "${CONTAINER_ID}"
