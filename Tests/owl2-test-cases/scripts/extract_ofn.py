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
import shutil
import subprocess
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

        rdf_premise_el = tc.find("test:rdfXmlPremiseOntology", NS)
        rdf_concl_el = tc.find("test:rdfXmlConclusionOntology", NS)
        rdf_premise = rdf_premise_el.text if rdf_premise_el is not None else None
        rdf_concl = rdf_concl_el.text if rdf_concl_el is not None else None

        if fs_premise is not None:
            fs_premise = html.unescape(fs_premise).strip()
        if fs_concl is not None:
            fs_concl = html.unescape(fs_concl).strip()
        if rdf_premise is not None:
            rdf_premise = html.unescape(rdf_premise).strip()
        if rdf_concl is not None:
            rdf_concl = html.unescape(rdf_concl).strip()

        yield {
            "uri": uri,
            "identifier": identifier,
            "types": sorted(set([t for t in types if t])),
            "semantics": sorted(set([s for s in semantics if s])),
            "species": sorted(set([s for s in species if s])),
            "profiles": sorted(set([p for p in profiles if p])),
            "fs_premise": fs_premise,
            "fs_conclusion": fs_concl,
            "rdfxml_premise": rdf_premise,
            "rdfxml_conclusion": rdf_concl,
            "source": os.path.basename(path),
        }


def parse_imported_ontologies(path: str):
    tree = ET.parse(path)
    root = tree.getroot()
    for node in root.findall(".//test:importedOntologyIRI/..", NS):
        iri_el = node.find("test:importedOntologyIRI", NS)
        iri = ""
        if iri_el is not None:
            iri = iri_el.get(f"{{{NS['rdf']}}}resource", "") or ""
        fs_el = node.find("test:fsInputOntology", NS)
        rdf_el = node.find("test:rdfXmlInputOntology", NS)
        fs_text = fs_el.text if fs_el is not None else None
        rdf_text = rdf_el.text if rdf_el is not None else None
        if fs_text is not None:
            fs_text = html.unescape(fs_text).strip()
        if rdf_text is not None:
            rdf_text = html.unescape(rdf_text).strip()
        if iri:
            yield {
                "iri": iri,
                "fs_input": fs_text,
                "rdfxml_input": rdf_text,
                "source": os.path.basename(path),
            }


def convert_rdfxml_to_ofn(rdfxml_text: str, out_path: str, tmp_dir: str, robot_bin: str) -> bool:
    os.makedirs(tmp_dir, exist_ok=True)
    tmp_in = os.path.join(tmp_dir, os.path.basename(out_path) + ".rdfxml")
    with open(tmp_in, "w", encoding="utf-8") as f:
        f.write(normalize_rdfxml(rdfxml_text))
        f.write("\n")
    result = subprocess.run(
        [robot_bin, "convert", "-i", tmp_in, "-f", "ofn", "-o", out_path],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    if result.returncode != 0:
        sys.stderr.write(result.stdout)
        return False
    return True


def normalize_rdfxml(text: str) -> str:
    # Expand internal entity definitions to avoid DOCTYPE parsing issues.
    entity_map = {}
    doctype_match = re.search(r"<!DOCTYPE[\s\S]*?\[(.*?)\]>", text, re.S)
    if doctype_match:
        subset = doctype_match.group(1)
        for m in re.finditer(r"<!ENTITY\s+(\w+)\s+(\"[^\"]*\"|'[^']*')\s*>", subset):
            name = m.group(1)
            val = m.group(2)[1:-1]
            entity_map[name] = val
        text = text[:doctype_match.start()] + text[doctype_match.end():]
    if entity_map:
        for name, val in entity_map.items():
            text = text.replace(f"&{name};", val)
    # Fix unescaped angle brackets in label literals.
    def escape_label(match):
        start = match.group(1)
        content = match.group(2)
        end = match.group(3)
        content = content.replace("<", "&lt;").replace(">", "&gt;")
        return f"{start}{content}{end}"

    text = re.sub(r"(<rdfs:label\b[^>]*>)([\s\S]*?)(</rdfs:label>)", escape_label, text)
    return text


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifests", required=True, help="Directory with approved RDF manifests")
    ap.add_argument("--out", required=True, help="Output directory for OFN files")
    ap.add_argument("--manifest-json", required=True, help="Path to write JSON index")
    ap.add_argument("--imports-dir", default=None, help="Directory to write imported ontology OFN files")
    ap.add_argument("--imports-map", default=None, help="Path to write IRI mapping file for imports")
    ap.add_argument("--robot", default=os.environ.get("ROBOT_BIN", "robot"), help="Robot CLI binary")
    ap.add_argument("--tmp-dir", default=None, help="Temporary directory for RDF/XML conversion")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)

    tests = {}
    imports = {}
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
                if tc.get("rdfxml_premise") and not entry.get("rdfxml_premise"):
                    entry["rdfxml_premise"] = tc["rdfxml_premise"]
                if tc.get("rdfxml_conclusion") and not entry.get("rdfxml_conclusion"):
                    entry["rdfxml_conclusion"] = tc["rdfxml_conclusion"]
                if tc["source"] not in entry["sources"]:
                    entry["sources"].append(tc["source"])
        for imp in parse_imported_ontologies(path):
            iri = imp.get("iri")
            if not iri:
                continue
            entry = imports.get(iri)
            if entry is None:
                entry = imp
                entry["sources"] = [imp["source"]]
                imports[iri] = entry
            else:
                if imp["source"] not in entry["sources"]:
                    entry["sources"].append(imp["source"])

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

        tmp_dir = args.tmp_dir or os.path.join(args.out, "tmp")
        robot_bin = args.robot
        if tc.get("fs_premise"):
            premise_path = os.path.join(args.out, f"{base}-premise.ofn")
            with open(premise_path, "w", encoding="utf-8") as f:
                f.write(tc["fs_premise"])
                f.write("\n")
        elif tc.get("rdfxml_premise"):
            premise_path = os.path.join(args.out, f"{base}-premise.ofn")
            if not shutil.which(robot_bin):
                print(f"robot not found: {robot_bin}", file=sys.stderr)
                return 2
            if not convert_rdfxml_to_ofn(tc["rdfxml_premise"], premise_path, tmp_dir, robot_bin):
                continue

        if tc.get("fs_conclusion"):
            conclusion_path = os.path.join(args.out, f"{base}-conclusion.ofn")
            with open(conclusion_path, "w", encoding="utf-8") as f:
                f.write(tc["fs_conclusion"])
                f.write("\n")
        elif tc.get("rdfxml_conclusion"):
            conclusion_path = os.path.join(args.out, f"{base}-conclusion.ofn")
            if not shutil.which(robot_bin):
                print(f"robot not found: {robot_bin}", file=sys.stderr)
                return 2
            if not convert_rdfxml_to_ofn(tc["rdfxml_conclusion"], conclusion_path, tmp_dir, robot_bin):
                continue

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

    if args.imports_dir or args.imports_map:
        imports_dir = args.imports_dir or os.path.join(args.out, "imports")
        os.makedirs(imports_dir, exist_ok=True)
        mapping_lines = []
        used_import_names = {}
        tmp_dir = args.tmp_dir or os.path.join(args.out, "tmp")
        robot_bin = args.robot
        for iri, imp in sorted(imports.items()):
            base = safe_name(local_name(iri))
            if base in used_import_names:
                used_import_names[base] += 1
                base = f"{base}-{used_import_names[base]}"
            else:
                used_import_names[base] = 1
            out_path = os.path.join(imports_dir, f"{base}.ofn")
            if imp.get("fs_input"):
                with open(out_path, "w", encoding="utf-8") as f:
                    f.write(imp["fs_input"])
                    f.write("\n")
            elif imp.get("rdfxml_input"):
                if not shutil.which(robot_bin):
                    print(f"robot not found: {robot_bin}", file=sys.stderr)
                    return 2
                if not convert_rdfxml_to_ofn(imp["rdfxml_input"], out_path, tmp_dir, robot_bin):
                    continue
            else:
                continue
            rel_path = os.path.relpath(out_path)
            mapping_lines.append(f"{iri}={rel_path}")
        if args.imports_map:
            with open(args.imports_map, "w", encoding="utf-8") as f:
                for line in mapping_lines:
                    f.write(line)
                    f.write("\n")

    with open(args.manifest_json, "w", encoding="utf-8") as f:
        json.dump(out_index, f, indent=2, sort_keys=True)
        f.write("\n")

    print(f"Extracted {len(out_index)} DL/DIRECT tests with OFN payloads.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
