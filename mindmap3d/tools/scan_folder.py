#!/usr/bin/env python3
"""Scannt Ordner bis zur letzten Datei und schreibt einen Mindmap-Baum (JSON).

Das Format entspricht dem der Zustandskarte: n=Name, s=Status (ordner|datei),
m=Meta, p=Pfad, c=Kinder. Die 3D-App haengt die Datei ueber
"Ordner-Scan anhaengen" an den gewaehlten Knoten an.

Beispiele:
  python3 tools/scan_folder.py ~/Konzeptordner -o data/konzeptordner-scan.json
  python3 tools/scan_folder.py ../repoA ../repoB -o data/repos-scan.json --name Repos
"""
import argparse
import json
import os

SKIP = {".git", "node_modules", ".venv", "__pycache__", ".idea", ".vscode"}
EXCLUDE = set()


def fmt_size(b):
    for unit in ("B", "KB", "MB", "GB"):
        if b < 1024 or unit == "GB":
            return f"{b:.0f} {unit}" if unit == "B" else f"{b:.1f} {unit}"
        b /= 1024


def scan(path, rel):
    node = {"n": os.path.basename(path) or path, "s": "ordner", "p": rel, "c": []}
    files = folders = size = 0
    try:
        entries = sorted(os.scandir(path), key=lambda e: (not e.is_dir(follow_symlinks=False), e.name.lower()))
    except OSError:
        return node, 0, 0, 0
    for e in entries:
        if e.is_dir(follow_symlinks=False):
            if e.name in SKIP or e.name in EXCLUDE:
                continue
            child, f, d, s = scan(e.path, f"{rel}/{e.name}")
            node["c"].append(child)
            files, folders, size = files + f, folders + d + 1, size + s
        elif e.is_file(follow_symlinks=False):
            sz = e.stat().st_size
            node["c"].append({"n": e.name, "s": "datei", "m": fmt_size(sz), "p": f"{rel}/{e.name}"})
            files, size = files + 1, size + sz
    node["m"] = f"{files} Dateien · {fmt_size(size)}"
    return node, files, folders, size


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("folders", nargs="+")
    ap.add_argument("-o", "--out", required=True)
    ap.add_argument("--name", help="Wurzelname, wenn mehrere Ordner zusammengefasst werden")
    ap.add_argument("--exclude", nargs="*", default=[], help="zusaetzlich ausgelassene Ordnernamen")
    a = ap.parse_args()
    EXCLUDE.update(a.exclude)

    trees = []
    for f in a.folders:
        f = os.path.abspath(f)
        trees.append(scan(f, os.path.basename(f))[0])
    root = trees[0] if len(trees) == 1 and not a.name else {
        "n": a.name or "Scan", "s": "ordner", "m": f"{len(trees)} Ordner", "c": trees}
    with open(a.out, "w", encoding="utf8") as fh:
        json.dump(root, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"{a.out}: {root['m']}")


if __name__ == "__main__":
    main()
