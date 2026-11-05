#!/usr/bin/env python3
"""Append unique top-level declarations from a conflicting bridge file to the
canonical packages/core/src/bridge.ts (lead integration helper).

Usage: merge_bridge.py <file-with-their-bridge-content>
Skips declarations whose exported names already exist in the current bridge.
"""
import re, sys

TARGET = "/home/z/my-project/packages/core/src/bridge.ts"

def exported_names(text: str) -> set[str]:
    names: set[str] = set()
    for m in re.finditer(r"export (?:declare )?(?:type|interface|class|function|const|let|var|enum) (\w+)", text):
        names.add(m.group(1))
    for m in re.finditer(r"export (?:type )?\{([^}]*)\}", text):
        for part in m.group(1).split(","):
            part = part.strip()
            if not part:
                continue
            part = re.sub(r"^(type|const) ", "", part)
            part = part.split(" as ")[-1].strip()
            if part:
                names.add(part)
    return names

def blocks(text: str) -> list[str]:
    lines = text.split("\n")
    out: list[str] = []
    cur: list[str] = []
    started = False
    depth = 0
    for ln in lines:
        stripped = ln.strip()
        if not started:
            if stripped.startswith("export ") or stripped.startswith("/**") or (
                stripped.startswith("//") and "export" not in stripped
            ):
                started = True
                cur = [ln]
                depth = ln.count("{") - ln.count("}")
            continue
        cur.append(ln)
        depth += ln.count("{") - ln.count("}")
        if depth <= 0 and (stripped.endswith(";") or stripped.endswith("}") or stripped.endswith("*/")):
            out.append("\n".join(cur).rstrip())
            cur = []
            started = False
            depth = 0
    if cur and any(l.strip() for l in cur):
        out.append("\n".join(cur).rstrip())
    return out

def main() -> None:
    theirs_path = sys.argv[1]
    theirs = open(theirs_path).read()
    current = open(TARGET).read()
    have = exported_names(current)
    added: list[str] = []
    skipped: list[str] = []
    for blk in blocks(theirs):
        names = exported_names(blk)
        if not names:
            continue
        if names & have:
            skipped.extend(sorted(names & have))
        else:
            added.append(blk)
            have |= names
    if added:
        with open(TARGET, "a") as f:
            f.write("\n\n// ---- merged from a ticket bridge (lead integration) ----\n")
            f.write("\n\n".join(added))
            f.write("\n")
    print(f"added blocks: {len(added)}; skipped names: {sorted(set(skipped))[:20]}")

if __name__ == "__main__":
    main()
