#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <konclude-binary> [cases.txt] [workdir] [expected-failures.txt]" >&2
  exit 2
fi

KONCLUDE="$1"
CASES_FILE="${2:-Tests/owl2-test-cases/approved/ofn/cases.txt}"
WORK_DIR="${3:-Tests/owl2-test-cases/approved/ofn/tmp}"
EXPECTED_FILE="${4:-Tests/owl2-test-cases/expected-failures.txt}"

mkdir -p "$WORK_DIR"

EXPECTED_LIST=""
if [[ -f "$EXPECTED_FILE" ]]; then
  EXPECTED_LIST="$(mktemp "$WORK_DIR/expected.XXXXXX")"
  sed -e 's/\r$//' -e 's/#.*$//' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e '/^$/d' \
    "$EXPECTED_FILE" > "$EXPECTED_LIST"
fi

is_expected() {
  [[ -z "$EXPECTED_LIST" ]] && return 1
  grep -Fxq "$1" "$EXPECTED_LIST"
}

fail=0
count=0
xfail=0
xpass=0
while IFS=$'\t' read -r expect path case_id; do
  [[ -z "$expect" ]] && continue
  [[ "$expect" == \#* ]] && continue
  ((count+=1))
  out="$WORK_DIR/$(basename "$path").out"
  "$KONCLUDE" consistency -i "$path" -o "$out" >/dev/null
  if [[ ! -f "$out" ]]; then
    if is_expected "$case_id"; then
      echo "XFAIL $case_id: missing output"
      ((xfail+=1))
      continue
    fi
    echo "FAIL $case_id: missing output"
    fail=1
    continue
  fi
  got=$(tr -d '\r\n' < "$out" | tr '[:upper:]' '[:lower:]')
  if [[ "$got" != "$expect" ]]; then
    if is_expected "$case_id"; then
      echo "XFAIL $case_id: expected $expect got $got"
      ((xfail+=1))
      continue
    fi
    echo "FAIL $case_id: expected $expect got $got"
    fail=1
  else
    if is_expected "$case_id"; then
      echo "XPASS $case_id"
      ((xpass+=1))
      fail=1
    fi
  fi
done < "$CASES_FILE"

echo "Ran $count cases (XFAIL=$xfail XPASS=$xpass)"
exit $fail
