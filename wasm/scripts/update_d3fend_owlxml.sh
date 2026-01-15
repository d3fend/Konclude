#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/web/ontologies"
TMP_DIR="$(mktemp -d)"
ROBOT_BIN="${ROBOT_BIN:-robot}"
D3FEND_VERSION="${D3FEND_VERSION:-}"
VERSION_JSON=""

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

if ! command -v "$ROBOT_BIN" >/dev/null 2>&1; then
  echo "robot not found; set ROBOT_BIN or install robot" >&2
  exit 1
fi

if [ -z "$D3FEND_VERSION" ]; then
  VERSION_JSON="$(curl -fsSL https://d3fend.mitre.org/api/version.json)"
  D3FEND_VERSION="$(python -c "import json,sys; payload=json.load(sys.stdin); print(payload.get('ontology_version') or payload.get('version') or '')" <<<"$VERSION_JSON")"
fi

if [ -z "$D3FEND_VERSION" ]; then
  echo "Failed to resolve D3FEND version" >&2
  exit 1
fi

SOURCE_URL="https://d3fend.mitre.org/ontologies/d3fend/${D3FEND_VERSION}/d3fend.owl"

mkdir -p "$OUT_DIR"

curl -fsSL -o "$TMP_DIR/d3fend.owl" "$SOURCE_URL"
"$ROBOT_BIN" convert -i "$TMP_DIR/d3fend.owl" -f owx -o "$TMP_DIR/d3fend.owl.xml"
"$ROBOT_BIN" remove -i "$TMP_DIR/d3fend.owl" -s individuals -o "$TMP_DIR/d3fend.tbox.owl"
"$ROBOT_BIN" convert -i "$TMP_DIR/d3fend.tbox.owl" -f owx -o "$TMP_DIR/d3fend.tbox.owl.xml"

SOURCE_SHA256="$(sha256sum "$TMP_DIR/d3fend.owl" | awk '{print $1}')"
OWLXML_SHA256="$(sha256sum "$TMP_DIR/d3fend.owl.xml" | awk '{print $1}')"
TBOX_SHA256="$(sha256sum "$TMP_DIR/d3fend.tbox.owl.xml" | awk '{print $1}')"
RETRIEVED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

RELEASE_DATE=""
if [ -n "$VERSION_JSON" ]; then
  RELEASE_DATE="$(python -c "import json,sys; payload=json.load(sys.stdin); print(payload.get('release_date') or '')" <<<"$VERSION_JSON")"
fi

cp "$TMP_DIR/d3fend.owl.xml" "$OUT_DIR/d3fend.owl.xml"
cp "$TMP_DIR/d3fend.tbox.owl.xml" "$OUT_DIR/d3fend.tbox.owl.xml"
cat > "$OUT_DIR/d3fend.meta.json" <<META
{
  "version": "${D3FEND_VERSION}",
  "release_date": "${RELEASE_DATE}",
  "source_url": "${SOURCE_URL}",
  "retrieved_at": "${RETRIEVED_AT}",
  "source_sha256": "${SOURCE_SHA256}",
  "owlxml_sha256": "${OWLXML_SHA256}"
}
META
cat > "$OUT_DIR/d3fend.tbox.meta.json" <<META
{
  "version": "${D3FEND_VERSION}",
  "release_date": "${RELEASE_DATE}",
  "source_url": "${SOURCE_URL}",
  "derived_from": "d3fend.owl.xml",
  "retrieved_at": "${RETRIEVED_AT}",
  "individuals_removed": true,
  "owlxml_sha256": "${TBOX_SHA256}"
}
META

echo "Wrote $OUT_DIR/d3fend.owl.xml"
echo "Wrote $OUT_DIR/d3fend.tbox.owl.xml"
echo "Wrote $OUT_DIR/d3fend.meta.json"
echo "Wrote $OUT_DIR/d3fend.tbox.meta.json"
