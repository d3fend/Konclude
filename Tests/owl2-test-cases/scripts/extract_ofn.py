#!/usr/bin/env python3
"""
Extract OWL 2 Functional Syntax (OFN) premise/conclusion ontologies
from the W3C OWL 2 approved test manifests.
"""

import argparse
import html
import json
import os
import re
import sys
import xml.etree.ElementTree as ET

NS = {
    "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    "test": "http://www.w3.org/2007/OWL/testOntology#",
}


def local_name(uri: str) -> str:
    if uri is None:
        return ""
    if "#" in uri:
        return uri.rsplit("#", 1)[-1]
    return uri.rsplit("/", 1)[-1]


def safe_name(text: str) -> str:
    text = text.strip()
    if not text:
        return "unknown"
    text = re.sub(r"[^A-Za-z0-9._-]+", "-", text)
    return text.strip("-") or "unknown"


def parse_manifest(path: str):
    tree = ET.parse(path)
    root = tree.getroot()
    for tc in root.findall("test:TestCase", NS):
        uri = tc.get(f"{{{NS['rdf']}}}about", "")
        identifier_el = tc.find("test:identifier", NS)
        identifier = identifier_el.text.strip() if identifier_el is not None and identifier_el.text else ""

        types = [local_name(t.get(f"{{{NS['rdf']}}}resource", "")) for t in tc.findall("rdf:type", NS)]
        semantics = [local_name(t.get(f"{{{NS['rdf']}}}resource", "")) for t in tc.findall("test:semantics", NS)]
        species = [local_name(t.get(f"{{{NS['rdf']}}}resource", "")) for t in tc.findall("test:species", NS)]
        profiles = [local_name(t.get(f"{{{NS['rdf']}}}resource", "")) for t in tc.findall("test:profile", NS)]

        fs_premise_el = tc.find("test:fsPremiseOntology", NS)
        fs_concl_el = tc.find("test:fsConclusionOntology", NS)
        fs_premise = fs_premise_el.text if fs_premise_el is not None else None
        fs_concl = fs_concl_el.text if fs_concl_el is not None else None

        if fs_premise is not None:
            fs_premise = html.unescape(fs_premise).strip()
        if fs_concl is not None:
            fs_concl = html.unescape(fs_concl).strip()

        yield {
            "uri": uri,
            "identifier": identifier,
            "types": sorted(set([t for t in types if t])),
            "semantics": sorted(set([s for s in semantics if s])),
            "species": sorted(set([s for s in species if s])),
            "profiles": sorted(set([p for p in profiles if p])),
            "fs_premise": fs_premise,
            "fs_conclusion": fs_concl,
            "source": os.path.basename(path),
        }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifests", required=True, help="Directory with approved RDF manifests")
    ap.add_argument("--out", required=True, help="Output directory for OFN files")
    ap.add_argument("--manifest-json", required=True, help="Path to write JSON index")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)

    tests = {}
    for fname in sorted(os.listdir(args.manifests)):
        if not fname.endswith(".rdf"):
            continue
        if fname == "RL-RDF-rules-tests.rdf":
            continue
        path = os.path.join(args.manifests, fname)
        for tc in parse_manifest(path):
            key = tc["identifier"] or tc["uri"] or f"{fname}:{len(tests)}"
            entry = tests.get(key)
            if entry is not None:
                def differs(a, b):
                    return a and b and a.strip() != b.strip()

                if differs(tc.get("fs_premise"), entry.get("fs_premise")) or differs(tc.get("fs_conclusion"), entry.get("fs_conclusion")):
                    alt_key = tc["uri"] or f"{key}:{len(tests)}"
                    if alt_key != key:
                        key = alt_key
                        entry = tests.get(key)

            if entry is None:
                entry = tc
                entry["sources"] = [tc["source"]]
                tests[key] = entry
            else:
                # Merge metadata.
                entry["types"] = sorted(set(entry["types"]) | set(tc["types"]))
                entry["semantics"] = sorted(set(entry["semantics"]) | set(tc["semantics"]))
                entry["species"] = sorted(set(entry["species"]) | set(tc["species"]))
                entry["profiles"] = sorted(set(entry["profiles"]) | set(tc["profiles"]))
                if tc["fs_premise"] and not entry.get("fs_premise"):
                    entry["fs_premise"] = tc["fs_premise"]
                if tc["fs_conclusion"] and not entry.get("fs_conclusion"):
                    entry["fs_conclusion"] = tc["fs_conclusion"]
                if tc["source"] not in entry["sources"]:
                    entry["sources"].append(tc["source"])

    out_index = []
    used_bases = {}
    for key, tc in sorted(tests.items(), key=lambda kv: kv[0]):
        # Only output DL + DIRECT semantics for Konclude contract.
        if "DL" not in tc["species"]:
            continue
        if "DIRECT" not in tc["semantics"]:
            continue

        identifier = tc["identifier"] or local_name(tc["uri"]) or key
        base = safe_name(identifier)
        if base in used_bases:
            used_bases[base] += 1
            base = f"{base}-{used_bases[base]}"
        else:
            used_bases[base] = 1
        premise_path = None
        conclusion_path = None

        if tc.get("fs_premise"):
            premise_path = os.path.join(args.out, f"{base}-premise.ofn")
            with open(premise_path, "w", encoding="utf-8") as f:
                f.write(tc["fs_premise"])
                f.write("\n")
        if tc.get("fs_conclusion"):
            conclusion_path = os.path.join(args.out, f"{base}-conclusion.ofn")
            with open(conclusion_path, "w", encoding="utf-8") as f:
                f.write(tc["fs_conclusion"])
                f.write("\n")

        if not premise_path and not conclusion_path:
            # No functional syntax content to extract.
            continue

        out_index.append({
            "id": base,
            "identifier": tc["identifier"],
            "uri": tc["uri"],
            "types": tc["types"],
            "semantics": tc["semantics"],
            "species": tc["species"],
            "profiles": tc["profiles"],
            "premise_ofn": premise_path,
            "conclusion_ofn": conclusion_path,
            "sources": tc["sources"],
        })

    with open(args.manifest_json, "w", encoding="utf-8") as f:
        json.dump(out_index, f, indent=2, sort_keys=True)
        f.write("\n")

    print(f"Extracted {len(out_index)} DL/DIRECT tests with OFN payloads.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
