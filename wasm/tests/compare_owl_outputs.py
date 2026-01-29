#!/usr/bin/env python3
import json
import sys
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict, deque

NS = '{http://www.w3.org/2002/07/owl#}'


def canonicalize(elem):
    def canon(e):
        attrs = ''.join([f' {k}="{v}"' for k, v in sorted(e.attrib.items())])
        if len(e):
            child_strs = [canon(child) for child in e]
            child_strs.sort()
            inner = ''.join(child_strs)
            return f'<{e.tag}{attrs}>{inner}</{e.tag}>'
        text = (e.text or '').strip()
        if text:
            return f'<{e.tag}{attrs}>{text}</{e.tag}>'
        return f'<{e.tag}{attrs}/>'
    return canon(elem)


def load_axioms(path):
    root = ET.parse(path).getroot()
    axioms = [canonicalize(child) for child in list(root)]
    return Counter(axioms)


def parse_hierarchy(path):
    root = ET.parse(path).getroot()
    classes = set()
    subclass_edges = []
    equiv_groups = []

    for child in list(root):
        if child.tag == NS + 'SubClassOf':
            iris = [c.attrib.get('IRI') for c in list(child) if c.tag == NS + 'Class']
            if len(iris) == 2 and iris[0] and iris[1]:
                subclass_edges.append((iris[0], iris[1]))
                classes.update(iris)
        elif child.tag == NS + 'EquivalentClasses':
            iris = [c.attrib.get('IRI') for c in list(child) if c.tag == NS + 'Class']
            iris = [iri for iri in iris if iri]
            if len(iris) >= 2:
                equiv_groups.append(iris)
                classes.update(iris)
    return classes, subclass_edges, equiv_groups


def build_equivalence_reps(classes, equiv_groups):
    graph = defaultdict(set)
    for group in equiv_groups:
        for i in range(len(group)):
            for j in range(i + 1, len(group)):
                a, b = group[i], group[j]
                graph[a].add(b)
                graph[b].add(a)

    reps = {}
    visited = set()
    for cls in classes:
        if cls in visited:
            continue
        # BFS to find component
        stack = [cls]
        component = []
        visited.add(cls)
        while stack:
            cur = stack.pop()
            component.append(cur)
            for nxt in graph.get(cur, ()):
                if nxt not in visited:
                    visited.add(nxt)
                    stack.append(nxt)
        rep = min(component)
        for member in component:
            reps[member] = rep
    return reps


def build_closure(classes, subclass_edges, equiv_groups):
    reps = build_equivalence_reps(classes, equiv_groups)
    graph = defaultdict(set)
    for a, b in subclass_edges:
        ra, rb = reps[a], reps[b]
        if ra != rb:
            graph[ra].add(rb)

    closure = set()
    nodes = set(reps.values()) | set(graph.keys())
    for node in nodes:
        seen = set()
        dq = deque([node])
        while dq:
            cur = dq.popleft()
            for nxt in graph.get(cur, ()):  # direct edges
                if nxt not in seen:
                    seen.add(nxt)
                    dq.append(nxt)
        for tgt in seen:
            closure.add((node, tgt))
    return closure


def main():
    if len(sys.argv) != 3:
        print('usage: compare_owl_outputs.py <fileA> <fileB>', file=sys.stderr)
        sys.exit(2)

    path_a, path_b = sys.argv[1], sys.argv[2]

    axioms_a = load_axioms(path_a)
    axioms_b = load_axioms(path_b)

    canonical_match = axioms_a == axioms_b

    only_a_axioms = list((axioms_a - axioms_b).elements())
    only_b_axioms = list((axioms_b - axioms_a).elements())

    classes_a, edges_a, equiv_a = parse_hierarchy(path_a)
    classes_b, edges_b, equiv_b = parse_hierarchy(path_b)

    closure_a = build_closure(classes_a, edges_a, equiv_a)
    closure_b = build_closure(classes_b, edges_b, equiv_b)

    closure_match = closure_a == closure_b
    only_a_closure = list(closure_a - closure_b)
    only_b_closure = list(closure_b - closure_a)

    result = {
        'canonical_match': canonical_match,
        'closure_match': closure_match,
        'axiom_count_a': sum(axioms_a.values()),
        'axiom_count_b': sum(axioms_b.values()),
        'closure_count_a': len(closure_a),
        'closure_count_b': len(closure_b),
        'only_a_axioms': only_a_axioms[:5],
        'only_b_axioms': only_b_axioms[:5],
        'only_a_closure': only_a_closure[:5],
        'only_b_closure': only_b_closure[:5],
    }

    print(json.dumps(result))


if __name__ == '__main__':
    main()
