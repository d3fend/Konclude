#!/usr/bin/env python3
"""Run OWL2 DL OFN conformance cases with Konclude CLI."""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path


def run_consistency(konclude, input_path, work_dir):
    output_path = os.path.join(work_dir, "out.txt")
    cmd = [konclude, "consistency", "-i", input_path, "-o", output_path]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        return None, result
    if not os.path.exists(output_path):
        return None, result
    with open(output_path, "r", encoding="utf-8") as f:
        val = f.read().strip().lower()
    if val == "true":
        return True, result
    if val == "false":
        return False, result
    return None, result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--konclude", required=True, help="Path to Konclude binary")
    ap.add_argument("--cases", default="Tests/owl2-test-cases/approved/ofn/cases.json")
    ap.add_argument("--workdir", default="Tests/owl2-test-cases/approved/ofn/tmp")
    ap.add_argument("--max-cases", type=int, default=0)
    ap.add_argument("--stop-on-fail", action="store_true")
    ap.add_argument(
        "--expected-failures",
        default="Tests/owl2-test-cases/expected-failures.txt",
        help="Path to expected failures list",
    )
    args = ap.parse_args()

    konclude = args.konclude
    if not os.path.exists(konclude):
        print(f"Konclude binary not found: {konclude}")
        return 2

    os.makedirs(args.workdir, exist_ok=True)

    with open(args.cases, "r", encoding="utf-8") as f:
        cases = json.load(f)

    expected_failures = set()
    if args.expected_failures and os.path.exists(args.expected_failures):
        with open(args.expected_failures, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                expected_failures.add(line)

    failures = []
    total = 0
    xfail = 0
    xpass = 0
    for case in cases:
        total += 1
        if args.max_cases and total > args.max_cases:
            break
        input_path = case["input"]
        expected = case["expect"]
        if not os.path.exists(input_path):
            if case["id"] in expected_failures:
                xfail += 1
            else:
                failures.append((case["id"], "missing_input"))
            if args.stop_on_fail:
                break
            continue
        ok, result = run_consistency(konclude, input_path, args.workdir)
        if ok is None or ok != expected:
            if case["id"] in expected_failures:
                xfail += 1
            else:
                failures.append((case["id"], f"expected {expected} got {ok}"))
                if args.stop_on_fail:
                    break
        elif case["id"] in expected_failures:
            xpass += 1
            failures.append((case["id"], "unexpected pass (expected failure)"))
            if args.stop_on_fail:
                break

    print(f"Ran {min(total, len(cases))} cases (XFAIL={xfail} XPASS={xpass}), failures: {len(failures)}")
    if failures:
        for cid, msg in failures[:20]:
            print(f"FAIL {cid}: {msg}")
        if len(failures) > 20:
            print(f"... {len(failures)-20} more failures")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
