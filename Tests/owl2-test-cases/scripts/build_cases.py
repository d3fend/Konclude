#!/usr/bin/env python3
"""
Build runnable OWL2 DL conformance cases from extracted OFN manifests.
Generates:
  - cases.json (list of consistency checks)
  - generated/*.ofn (premise + negated conclusion axioms)
  - coverage.md summary
"""

import argparse
import json
import os
import re
from collections import Counter, defaultdict

AXIOMS = [
    "ClassAssertion",
    "ObjectPropertyAssertion",
    "DataPropertyAssertion",
    "SameIndividual",
    "DifferentIndividuals",
]


def split_top_level_args(text: str):
    args = []
    current = []
    depth = 0
    in_quote = False
    escape = False
    for ch in text:
        if in_quote:
            current.append(ch)
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_quote = False
            continue

        if ch == '"':
            in_quote = True
            current.append(ch)
            continue
        if ch == '(':
            depth += 1
            current.append(ch)
            continue
        if ch == ')':
            depth -= 1
            current.append(ch)
            continue
        if depth == 0 and ch.isspace():
            if current:
                args.append("".join(current).strip())
                current = []
            continue
        current.append(ch)

    if current:
        args.append("".join(current).strip())
    return [a for a in args if a]


def extract_axioms(text: str, keyword: str):
    results = []
    pattern = re.compile(r"\b" + re.escape(keyword) + r"\s*\(")
    for m in pattern.finditer(text):
        start = m.start()
        i = m.end()  # position after opening paren
        depth = 1
        in_quote = False
        escape = False
        while i < len(text) and depth > 0:
            ch = text[i]
            if in_quote:
                if escape:
                    escape = False
                elif ch == "\\":
                    escape = True
                elif ch == '"':
                    in_quote = False
            else:
                if ch == '"':
                    in_quote = True
                elif ch == '(':
                    depth += 1
                elif ch == ')':
                    depth -= 1
            i += 1
        if depth == 0:
            results.append(text[start:i].strip())
    return results


def negate_axiom(axiom: str):
    m = re.match(r"^(\w+)\s*\((.*)\)$", axiom.strip(), re.S)
    if not m:
        return None
    kind = m.group(1)
    inner = m.group(2).strip()
    args = split_top_level_args(inner)
    if kind == "ClassAssertion":
        if len(args) < 2:
            return None
        class_expr = args[0]
        indiv = args[1]
        return f"ClassAssertion(ObjectComplementOf({class_expr}) {indiv})"
    if kind == "ObjectPropertyAssertion":
        if len(args) < 3:
            return None
        return f"NegativeObjectPropertyAssertion({args[0]} {args[1]} {args[2]})"
    if kind == "DataPropertyAssertion":
        if len(args) < 3:
            return None
        return f"NegativeDataPropertyAssertion({args[0]} {args[1]} {args[2]})"
    if kind == "SameIndividual":
        if len(args) < 2:
            return None
        return f"DifferentIndividuals({args[0]} {args[1]})"
    if kind == "DifferentIndividuals":
        if len(args) < 2:
            return None
        return f"SameIndividual({args[0]} {args[1]})"
    return None


def is_blank_node(term: str) -> bool:
    return term.startswith("_:")


def extract_object_property_assertions(text: str):
    assertions = []
    for axiom in extract_axioms(text, "ObjectPropertyAssertion"):
        m = re.match(r"^ObjectPropertyAssertion\s*\((.*)\)$", axiom.strip(), re.S)
        if not m:
            continue
        args = split_top_level_args(m.group(1).strip())
        if len(args) >= 3:
            assertions.append((args[0], args[1], args[2]))
    return assertions


def extract_class_assertions(text: str):
    assertions = []
    for axiom in extract_axioms(text, "ClassAssertion"):
        m = re.match(r"^ClassAssertion\s*\((.*)\)$", axiom.strip(), re.S)
        if not m:
            continue
        args = split_top_level_args(m.group(1).strip())
        if len(args) >= 2:
            assertions.append((args[0], args[1]))
    return assertions


def build_bnode_negations(concl_text: str):
    obj_assertions = extract_object_property_assertions(concl_text)
    class_assertions = extract_class_assertions(concl_text)

    has_bnodes = any(is_blank_node(s) or is_blank_node(o) for _, s, o in obj_assertions) or any(
        is_blank_node(ind) for _, ind in class_assertions
    )
    if not has_bnodes:
        return []

    class_map = defaultdict(list)
    for class_expr, indiv in class_assertions:
        if class_expr != "owl:Thing":
            class_map[indiv].append(class_expr)

    obj_map = defaultdict(list)
    for prop, subj, obj in obj_assertions:
        obj_map[subj].append((prop, obj))

    roots = sorted({node for node in set(class_map.keys()) | set(obj_map.keys()) if not is_blank_node(node)})
    if not roots:
        return []

    memo = {}

    def build_expr(node, stack):
        if node in memo:
            return memo[node]
        if node in stack:
            return "owl:Thing"
        stack.add(node)
        parts = []
        for cls in class_map.get(node, []):
            if cls != "owl:Thing":
                parts.append(cls)
        for prop, obj in obj_map.get(node, []):
            filler = build_expr(obj, stack)
            parts.append(f"ObjectSomeValuesFrom({prop} {filler})")
        if not parts:
            expr = "owl:Thing"
        elif len(parts) == 1:
            expr = parts[0]
        else:
            expr = "ObjectIntersectionOf(" + " ".join(parts) + ")"
        memo[node] = expr
        stack.remove(node)
        return expr

    neg_axioms = []
    for root in roots:
        expr = build_expr(root, set())
        neg_axioms.append(f"ClassAssertion(ObjectComplementOf({expr}) {root})")
    return neg_axioms


def find_ontology_insertion(text: str):
    idx = text.find("Ontology(")
    if idx == -1:
        return None
    start = idx + len("Ontology(")
    depth = 1
    in_quote = False
    escape = False
    i = start
    while i < len(text) and depth > 0:
        ch = text[i]
        if in_quote:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_quote = False
        else:
            if ch == '"':
                in_quote = True
            elif ch == '(':
                depth += 1
            elif ch == ')':
                depth -= 1
        i += 1
    if depth != 0:
        return None
    end = i - 1
    return start, end


def inject_axioms(premise_text: str, axioms):
    span = find_ontology_insertion(premise_text)
    if not span:
        return None
    start, end = span
    insert = "\n  " + "\n  ".join(axioms) + "\n"
    return premise_text[:end] + insert + premise_text[end:]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--cases-json", required=True)
    ap.add_argument("--cases-txt", required=True)
    ap.add_argument("--coverage-md", required=True)
    ap.add_argument("--expected-failures", default=None)
    args = ap.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)

    with open(args.manifest) as f:
        tests = json.load(f)

    cases = []
    counts = Counter()
    skipped = []

    for t in tests:
        premise = t.get("premise_ofn")
        conclusion = t.get("conclusion_ofn")
        if not premise:
            skipped.append({"id": t["id"], "reason": "missing_premise"})
            continue

        # Consistency / Inconsistency tests
        if "ConsistencyTest" in t["types"]:
            cases.append({
                "id": f"{t['id']}-consistency",
                "source": t["id"],
                "expect": True,
                "input": premise,
                "type": "ConsistencyTest",
            })
            counts["ConsistencyTest"] += 1
        if "InconsistencyTest" in t["types"]:
            cases.append({
                "id": f"{t['id']}-inconsistency",
                "source": t["id"],
                "expect": False,
                "input": premise,
                "type": "InconsistencyTest",
            })
            counts["InconsistencyTest"] += 1

        # Positive entailment tests -> premise + negated conclusion
        if "PositiveEntailmentTest" in t["types"]:
            if not conclusion:
                skipped.append({"id": t["id"], "reason": "missing_conclusion"})
                continue
            concl_text = open(conclusion).read()
            neg_axioms = build_bnode_negations(concl_text)
            if not neg_axioms:
                for ax in AXIOMS:
                    for axiom in extract_axioms(concl_text, ax):
                        neg = negate_axiom(axiom)
                        if neg:
                            neg_axioms.append(neg)
            if not neg_axioms:
                skipped.append({"id": t["id"], "reason": "unsupported_conclusion"})
                continue

            premise_text = open(premise).read()
            # one case per negated axiom (stronger coverage)
            for idx, neg in enumerate(neg_axioms, start=1):
                combined = inject_axioms(premise_text, [neg])
                if combined is None:
                    skipped.append({"id": t["id"], "reason": "cannot_inject"})
                    break
                out_path = os.path.join(args.out_dir, f"{t['id']}-entailment-{idx}.ofn")
                with open(out_path, "w", encoding="utf-8") as f:
                    f.write(combined)
                    f.write("\n")
                cases.append({
                    "id": f"{t['id']}-entailment-{idx}",
                    "source": t["id"],
                    "expect": False,
                    "input": out_path,
                    "type": "PositiveEntailmentTest",
                })
                counts["PositiveEntailmentTest"] += 1

    with open(args.cases_json, "w", encoding="utf-8") as f:
        json.dump(cases, f, indent=2, sort_keys=True)
        f.write("\n")

    with open(args.cases_txt, "w", encoding="utf-8") as f:
        f.write("# expect\tinput\tid\n")
        for case in cases:
            expect = "true" if case["expect"] else "false"
            f.write(f"{expect}\t{case['input']}\t{case['id']}\n")

    expected_failures = []
    if args.expected_failures and os.path.exists(args.expected_failures):
        with open(args.expected_failures, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                expected_failures.append(line)

    # coverage summary
    total_tests = len(tests)
    total_cases = len(cases)
    with open(args.coverage_md, "w", encoding="utf-8") as f:
        f.write("# OWL 2 DL Conformance Coverage\n\n")
        f.write("Source: W3C OWL 2 Test Case Repository (approved).\n")
        f.write("Note: This suite includes tests with OWL 2 Functional Syntax (OFN),\n")
        f.write("including payloads converted from RDF/XML to OFN for Redland-free runs.\n\n")
        f.write(f"- Extracted DL/DIRECT tests with OFN payloads: {total_tests}\n")
        f.write(f"- Generated runnable cases: {total_cases}\n\n")
        f.write("## Case Breakdown\n")
        for key in ["ConsistencyTest", "InconsistencyTest", "PositiveEntailmentTest"]:
            f.write(f"- {key}: {counts.get(key, 0)}\n")
        f.write("\n## Skipped Tests\n")
        if skipped:
            reason_counts = Counter(s["reason"] for s in skipped)
            for reason, count in reason_counts.most_common():
                f.write(f"- {reason}: {count}\n")
        else:
            f.write("- none\n")
        if expected_failures:
            f.write("\n## Expected Failures\n")
            f.write(f"- listed in {args.expected_failures} ({len(expected_failures)} cases)\n")

    print(f"Generated {total_cases} cases ({dict(counts)}), skipped {len(skipped)} tests.")


if __name__ == "__main__":
    main()
