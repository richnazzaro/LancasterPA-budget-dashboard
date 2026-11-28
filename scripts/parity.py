#!/usr/bin/env python3
"""Parity harness: prove a refactor left the generated data unchanged (docs/portable/PLAN.md step 0.6).

Two commands:

  snapshot <git-ref> <out-dir>
      Write every web/data/**/*.json and data/processed/**/*.csv as committed at <git-ref> (read with `git show`, so
      the working tree is not touched) into <out-dir>, keeping their paths. Keep <out-dir> outside the repository.

  compare <baseline-dir>
      Compare the working tree's files with a snapshot:
        web/data JSON   compared as parsed data, ignoring a top-level "generated" key (the build time). Parsed
                        comparison ignores key order, which covers changes.json's key order that follows
                        PYTHONHASHSEED.
        processed CSVs  same header, and the same rows once sorted (row order is not significant).
      Prints one line per file (equal / DIFFERENT / missing / new) with the first differences, and exits 1 on any
      difference.

Options: --root DIR (repository to read; default this one). Standard library only.
Example:
  python scripts/parity.py snapshot HEAD ../parity-baseline-HEAD
  python scripts/parity.py compare ../parity-baseline-HEAD
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
JSON_DIR, CSV_DIR = "web/data", "data/processed"
IGNORED_KEYS = {"generated"}
SHOW = 5          # differences shown per file


def tracked(path: str) -> bool:
    return (path.startswith(JSON_DIR + "/") and path.endswith(".json")) or \
           (path.startswith(CSV_DIR + "/") and path.endswith(".csv"))


def git(root: Path, *args: str) -> bytes:
    r = subprocess.run(["git", "-C", str(root), *args], capture_output=True)
    if r.returncode:
        sys.exit(f"git {' '.join(args)} failed: {r.stderr.decode(errors='replace').strip()}")
    return r.stdout


def snapshot(root: Path, ref: str, out: Path) -> int:
    sha = git(root, "rev-parse", "--verify", f"{ref}^{{commit}}").decode().strip()
    names = git(root, "ls-tree", "-r", "-z", "--name-only", sha, "--", JSON_DIR, CSV_DIR).decode().split("\0")
    names = sorted(n for n in names if n and tracked(n))
    if out.exists() and any(out.iterdir()):
        sys.exit(f"{out} is not empty; choose a new folder so an old snapshot is not mixed in")
    for n in names:
        dest = out / n
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(git(root, "show", f"{sha}:{n}"))
    (out / "SNAPSHOT.txt").write_text(f"ref {ref}\ncommit {sha}\nfiles {len(names)}\n", encoding="utf-8")
    print(f"Snapshot of {ref} ({sha[:7]}): {len(names)} files written to {out}")
    return 0


def files_under(base: Path) -> set[str]:
    out = set()
    for sub in (JSON_DIR, CSV_DIR):
        d = base / sub
        if d.exists():
            out |= {p.relative_to(base).as_posix() for p in d.rglob("*") if p.is_file() and tracked(p.relative_to(base).as_posix())}
    return out


def json_diffs(a, b, path="", out=None):
    """Up to SHOW differences between two parsed JSON values, as 'path: baseline -> now' strings."""
    out = [] if out is None else out
    if len(out) >= SHOW:
        return out
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b), key=str):
            p = f"{path}.{k}" if path else str(k)
            if k not in b:
                out.append(f"{p}: only in the baseline")
            elif k not in a:
                out.append(f"{p}: only in the working tree")
            elif a[k] != b[k]:
                json_diffs(a[k], b[k], p, out)
            if len(out) >= SHOW:
                break
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            out.append(f"{path or '(top)'}: {len(a)} items in the baseline, {len(b)} now")
        for i, (x, y) in enumerate(zip(a, b)):
            if x != y:
                json_diffs(x, y, f"{path}[{i}]", out)
            if len(out) >= SHOW:
                break
    else:
        short = lambda v: (s if len(s := json.dumps(v, ensure_ascii=False)) <= 80 else s[:77] + "...")
        out.append(f"{path or '(top)'}: {short(a)} -> {short(b)}")
    return out


def compare_json(base: Path, now: Path) -> list[str]:
    try:
        a, b = (json.loads(p.read_text(encoding="utf-8")) for p in (base, now))
    except json.JSONDecodeError as e:
        return [f"not valid JSON: {e}"]
    if isinstance(a, dict):
        a = {k: v for k, v in a.items() if k not in IGNORED_KEYS}
    if isinstance(b, dict):
        b = {k: v for k, v in b.items() if k not in IGNORED_KEYS}
    return [] if a == b else json_diffs(a, b)


def compare_csv(base: Path, now: Path) -> list[str]:
    read = lambda p: list(csv.reader(io.StringIO(p.read_text(encoding="utf-8"), newline="")))
    a, b = read(base), read(now)
    if not a or not b:
        return [] if a == b else ["one of the two files is empty"]
    if a[0] != b[0]:
        return [f"header differs: {','.join(a[0])} -> {','.join(b[0])}"]
    ra, rb = sorted(map(tuple, a[1:])), sorted(map(tuple, b[1:]))
    if ra == rb:
        return []
    out = [f"{len(ra)} rows in the baseline, {len(rb)} now"] if len(ra) != len(rb) else []
    sa, sb = set(ra), set(rb)
    only_a = [r for r in ra if r not in sb][:SHOW]
    only_b = [r for r in rb if r not in sa][:SHOW]
    out += [f"only in the baseline: {','.join(r)[:160]}" for r in only_a]
    out += [f"only in the working tree: {','.join(r)[:160]}" for r in only_b]
    if not only_a and not only_b:
        out.append("same rows but a different number of duplicates")
    return out


def compare(root: Path, baseline: Path) -> int:
    if not baseline.is_dir():
        sys.exit(f"{baseline}: no such snapshot folder (make one with: parity.py snapshot <git-ref> {baseline})")
    want, have = files_under(baseline), files_under(root)
    if not want:
        sys.exit(f"{baseline}: holds no {JSON_DIR}/*.json or {CSV_DIR}/*.csv files")
    bad = 0
    for name in sorted(want | have):
        if name not in have:
            print(f"missing    {name} (in the baseline, not in the working tree)")
            bad += 1
            continue
        if name not in want:
            print(f"new        {name} (not in the baseline)")
            bad += 1
            continue
        diffs = (compare_json if name.endswith(".json") else compare_csv)(baseline / name, root / name)
        if diffs:
            bad += 1
            print(f"DIFFERENT  {name}")
            for d in diffs:
                print(f"             {d}")
        else:
            print(f"equal      {name}")
    info = (baseline / "SNAPSHOT.txt").read_text(encoding="utf-8").split("\n")[0:2] if (baseline / "SNAPSHOT.txt").exists() else []
    print(f"\n{len(want | have)} files compared with {baseline} ({'; '.join(info)}): "
          + ("all equal" if not bad else f"{bad} differ"))
    return 1 if bad else 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Snapshot and compare generated data (web/data JSON, data/processed CSVs).")
    ap.add_argument("--root", type=Path, default=ROOT, help="repository to read (default: this one)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("snapshot", help="write the files at a git ref into a folder")
    s.add_argument("ref")
    s.add_argument("out", type=Path)
    c = sub.add_parser("compare", help="compare the working tree with a snapshot folder")
    c.add_argument("baseline", type=Path)
    a = ap.parse_args()
    root = a.root.resolve()
    if a.cmd == "snapshot":
        return snapshot(root, a.ref, a.out.resolve())
    return compare(root, a.baseline.resolve())


if __name__ == "__main__":
    sys.exit(main())
