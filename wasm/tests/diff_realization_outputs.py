#!/usr/bin/env python3
import argparse
import collections
import xml.etree.ElementTree as ET

NS = "{http://www.w3.org/2002/07/owl#}"


def extract_class_assertions(path):
    root = ET.parse(path).getroot()
    pairs = set()
    class_counts = collections.Counter()
    for child in list(root):
        if child.tag != NS + "ClassAssertion":
            continue
        cls = None
        ind = None
        for node in list(child):
            if node.tag == NS + "Class" and node.attrib.get("IRI"):
                cls = node.attrib["IRI"]
            elif node.tag == NS + "NamedIndividual" and node.attrib.get("IRI"):
                ind = node.attrib["IRI"]
        if cls and ind:
            pairs.add((cls, ind))
            class_counts[cls] += 1
    return pairs, class_counts


def summarize_counts(counts_a, counts_b, limit):
    all_classes = set(counts_a) | set(counts_b)
    diffs = []
    for cls in all_classes:
        a = counts_a.get(cls, 0)
        b = counts_b.get(cls, 0)
        if a != b:
            diffs.append((abs(a - b), cls, a, b))
    diffs.sort(reverse=True)
    if limit and limit > 0:
        diffs = diffs[:limit]
    return diffs


def main():
    parser = argparse.ArgumentParser(description="Diff realization OWL XML outputs by ClassAssertion pairs.")
    parser.add_argument("file_a", help="native output (A)")
    parser.add_argument("file_b", help="wasm output (B)")
    parser.add_argument("--class", dest="class_iri", help="class IRI to list individuals for")
    parser.add_argument("--limit", type=int, default=20, help="max class diffs to show (default 20)")
    parser.add_argument("--list-limit", type=int, default=50, help="max individuals to list (default 50)")
    args = parser.parse_args()

    pairs_a, counts_a = extract_class_assertions(args.file_a)
    pairs_b, counts_b = extract_class_assertions(args.file_b)

    only_a = pairs_a - pairs_b
    only_b = pairs_b - pairs_a

    print("ClassAssertion counts")
    print(f"  A: {len(pairs_a)}")
    print(f"  B: {len(pairs_b)}")
    print(f"  Only A: {len(only_a)}")
    print(f"  Only B: {len(only_b)}")

    diffs = summarize_counts(counts_a, counts_b, args.limit)
    if diffs:
        print("\nClasses with differing assertion counts:")
        for _, cls, a, b in diffs:
            print(f"  {cls}  A={a} B={b}")

    if args.class_iri:
        cls = args.class_iri
        inds_a = sorted(ind for c, ind in pairs_a if c == cls)
        inds_b = sorted(ind for c, ind in pairs_b if c == cls)
        only_a_inds = [ind for ind in inds_a if ind not in set(inds_b)]
        only_b_inds = [ind for ind in inds_b if ind not in set(inds_a)]

        print(f"\nIndividuals for class {cls}")
        print(f"  A: {len(inds_a)}")
        print(f"  B: {len(inds_b)}")
        if only_a_inds:
            print(f"  Only A ({len(only_a_inds)}):")
            for ind in only_a_inds[: args.list_limit]:
                print(f"    {ind}")
            if len(only_a_inds) > args.list_limit:
                print("    ...")
        if only_b_inds:
            print(f"  Only B ({len(only_b_inds)}):")
            for ind in only_b_inds[: args.list_limit]:
                print(f"    {ind}")
            if len(only_b_inds) > args.list_limit:
                print("    ...")


if __name__ == "__main__":
    main()
