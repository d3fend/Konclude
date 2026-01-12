#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INPUT_PRI="${ROOT_DIR}/Konclude.pri"
OUTPUT_PRI="${ROOT_DIR}/wasm/Konclude_wasm.pri"

# Convert Windows-style path separators in Konclude.pri to forward slashes,
# while preserving the trailing line-continuation backslashes.
python - "$INPUT_PRI" "$OUTPUT_PRI" <<'PY'
import re
import sys
from pathlib import Path

input_pri = Path(sys.argv[1])
output_pri = Path(sys.argv[2])
data = input_pri.read_text()
data = re.sub(r'\\(?!\s*$)', '/', data, flags=re.MULTILINE)
output_pri.write_text(data)
PY
