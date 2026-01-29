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

declare -A expected
if [[ -f "$EXPECTED_FILE" ]]; then
  while IFS= read -r line; do
    line="${line%%#*}"
    line="${line//$'\r'/}"
    line="${line//$'\n'/}"
    line="${line## }"
    line="${line%% }"
    [[ -z "$line" ]] && continue
    expected["$line"]=1
  done < "$EXPECTED_FILE"
fi

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
    if [[ -n "${expected[$case_id]:-}" ]]; then
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
    if [[ -n "${expected[$case_id]:-}" ]]; then
      echo "XFAIL $case_id: expected $expect got $got"
      ((xfail+=1))
      continue
    fi
    echo "FAIL $case_id: expected $expect got $got"
    fail=1
  else
    if [[ -n "${expected[$case_id]:-}" ]]; then
      echo "XPASS $case_id"
      ((xpass+=1))
      fail=1
    fi
  fi
done < "$CASES_FILE"

echo "Ran $count cases (XFAIL=$xfail XPASS=$xpass)"
exit $fail
