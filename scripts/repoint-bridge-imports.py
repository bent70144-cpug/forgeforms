#!/usr/bin/env python3
"""Codemod: repoint bridge imports to canonical modules (issue #30).

Handles:
  1. intra-core (packages/core/src/**): `... from "../bridge(.ts)?"` ->
     split per-symbol imports from ../shared/{errors,result,ctx,ids}.ts,
     ../logic/types.ts (types) / ../logic/index.ts (values), ./types (submissions Snapshot).
  2. cross-package (apps/**): `@formforge/core/bridge` -> `@formforge/core`
     when every imported symbol is exported from the core root.

Skips bridge files themselves. Prints every rewrite for review.
"""
import re
import sys
import os
import pathlib

ROOT = pathlib.Path("/home/z/my-project")
CORE_SRC = ROOT / "packages/core/src"

# symbol -> (module_dir_under_core_src, kind)  kind: 'types'|'values'
SYMBOL_MAP = {
    # shared/errors.ts
    "AppError": ("shared/errors.ts", "both"),
    "AppErrorCode": ("shared/errors.ts", "type"),
    "AppErrorDetail": ("shared/errors.ts", "type"),  # alias of ErrorDetail, see RENAMES
    "ErrorDetail": ("shared/errors.ts", "type"),
    "APP_ERROR_CODES": ("shared/errors.ts", "value"),
    "HTTP_STATUS_BY_CODE": ("shared/errors.ts", "value"),
    "toHttpStatus": ("shared/errors.ts", "value"),
    "errorBody": ("shared/errors.ts", "value"),
    "formatZodPath": ("shared/errors.ts", "value"),
    # shared/result.ts
    "ok": ("shared/result.ts", "value"),
    "err": ("shared/result.ts", "value"),
    "Result": ("shared/result.ts", "type"),
    # shared/ctx.ts
    "Ctx": ("shared/ctx.ts", "type"),
    "ActorType": ("shared/ctx.ts", "type"),
    "Actor": ("shared/ctx.ts", "type"),
    "systemCtx": ("shared/ctx.ts", "value"),
    "createCtx": ("shared/ctx.ts", "value"),
    # shared/ids.ts
    "uuidv7": ("shared/ids.ts", "value"),
    "shortId": ("shared/ids.ts", "value"),
    "parseShortId": ("shared/ids.ts", "value"),
    "parseDocumentId": ("shared/ids.ts", "value"),
    "isShortId": ("shared/ids.ts", "value"),
    "isUuidV7": ("shared/ids.ts", "value"),
    "PrefixedShortId": ("shared/ids.ts", "type"),
    "ShortIdPrefix": ("shared/ids.ts", "type"),
    # logic types (structural inputs + engine types)
    "Block": ("logic/types.ts", "type"),
    "Rule": ("logic/types.ts", "type"),
    "RuleAction": ("logic/types.ts", "type"),
    "RuleCondition": ("logic/types.ts", "type"),
    "RuleConditionOp": ("logic/types.ts", "type"),
    "LogicEvaluate": ("logic/types.ts", "type"),
    "EvaluateCtx": ("logic/types.ts", "type"),
    "EvaluateResult": ("logic/types.ts", "type"),
    "RouteMap": ("logic/types.ts", "type"),
    "Operand": ("logic/types.ts", "type"),
    "CompiledRule": ("logic/types.ts", "type"),
    "CompiledCondition": ("logic/types.ts", "type"),
    "CompiledAction": ("logic/types.ts", "type"),
    "Diagnostic": ("logic/types.ts", "type"),
    "DiagnosticCode": ("logic/types.ts", "type"),
}

RENAMES = {"AppErrorDetail": "ErrorDetail", "ErrorCode": "AppErrorCode"}

BRIDGE_RE = re.compile(
    r"""(import|export)\s+(type\s+)?\{([^}]*)\}\s+from\s+["']([^"']*\bbridge)(\.js|\.ts)?["']""",
    re.S,
)


def rel_target(importer: pathlib.Path, module: str) -> str:
    d = importer.parent
    t = (CORE_SRC / module).resolve()
    r = os.path.relpath(t, d).replace("\\", "/")
    if not r.startswith("."):
        r = "./" + r
    return r


def rewrite_intra(path: pathlib.Path, text: str, dry: bool):
    if CORE_SRC not in path.resolve().parents:
        return text, False
    changed = False
    out = text
    for m in reversed(list(BRIDGE_RE.finditer(text))):
        kw, type_kw, body, spec, _ext = m.groups()
        symbols = []
        for raw in body.split(","):
            raw = raw.strip()
            if not raw:
                continue
            is_type = raw.startswith("type ")
            name = raw[5:].strip() if is_type else raw
            symbols.append((name, is_type))
        # resolve targets
        buckets = {}  # module -> list[(display, name, is_type, type_kw)]
        unresolved = []
        for name, is_type in symbols:
            if name in SYMBOL_MAP:
                mod, kind = SYMBOL_MAP[name]
                shown = RENAMES.get(name, name)
                buckets.setdefault(mod, []).append((shown, name, is_type, type_kw or ""))
            else:
                unresolved.append(name)
        if unresolved:
            print(f"MANUAL {path}: unresolved {unresolved}")
            continue
        # build replacement statements
        stmts = []
        for mod, items in sorted(buckets.items()):
            target = rel_target(path, mod)
            parts = []
            for shown, name, is_type, tk in items:
                if shown == name:
                    parts.append(("type " if (is_type or tk.strip() == "type") else "") + name)
                else:
                    parts.append(
                        ("type " if (is_type or tk.strip() == "type") else "")
                        + f"{shown} as {name}" if shown != name else name
                    )
            # fix: alias direction — original name kept: import { Canonical as Original }
            parts = []
            for shown, name, is_type, tk in items:
                pre = "type " if (is_type or tk.strip() == "type") else ""
                parts.append(pre + name if shown == name else f"{pre}{shown} as {name}")
            stmts.append(f'{kw} {"type " if False else ""}{{ {", ".join(parts)} }} from "{target}";')
        new_stmt = "\n".join(stmts)
        out = out[: m.start()] + new_stmt + out[m.end():]
        changed = True
        print(f"REWRITE {path.relative_to(ROOT)}:\n    {new_stmt[:200]}")
    return (out if not dry and changed else text), changed


def rewrite_cross(path: pathlib.Path, text: str, dry: bool):
    changed = False
    out = text
    for m in reversed(list(BRIDGE_RE.finditer(text))):
        kw, type_kw, body, spec, _ext = m.groups()
        if spec != "@formforge/core/bridge":
            continue
        symbols = []
        for raw in body.split(","):
            raw = raw.strip()
            if not raw:
                continue
            is_type = raw.startswith("type ")
            name = raw[5:].strip() if is_type else raw
            symbols.append((name, is_type))
        bad = [n for n, _ in symbols if n not in SYMBOL_MAP and n not in ("Snapshot", "SubmissionRow", "Mailer", "SubmissionReader", "SubmissionStreamParams", "LogicEvaluate")]
        if bad:
            print(f"MANUAL-CROSS {path}: needs special home: {bad}")
            continue
        parts = []
        for name, is_type in symbols:
            pre = "type " if is_type else ""
            shown = RENAMES.get(name, name)
            parts.append(pre + name if shown == name else f"{pre}{shown} as {name}")
        new_stmt = f'{kw} {{ {", ".join(parts)} }} from "@formforge/core";'
        out = out[: m.start()] + new_stmt + out[m.end():]
        changed = True
        print(f"REWRITE-CROSS {path.relative_to(ROOT)}: -> @formforge/core")
    return (out if not dry and changed else text), changed


def main():
    dry = "--apply" not in sys.argv
    files = [
        p
        for p in list(ROOT.glob("packages/core/src/**/*.ts*")) + list(ROOT.glob("apps/**/*.ts*"))
        if p.is_file() and "node_modules" not in p.parts
    ]
    total = 0
    for p in sorted(files):
        s = str(p)
        if s.endswith("core/src/bridge.ts") or "results-bridge" in s or s.endswith("lib/bridge.ts") or "/mcp/src/bridge.ts" in s or "/renderer/src/bridge.ts" in s or "/db/src/bridge.ts" in s:
            continue
        try:
            text = p.read_text()
        except Exception:
            continue
        if "bridge" not in text:
            continue
        new_text, c1 = rewrite_intra(p, text, dry)
        new_text, c2 = rewrite_cross(p, new_text, dry)
        if (c1 or c2) and not dry:
            p.write_text(new_text)
        total += int(c1 or c2)
    print(f"{'DRY RUN — ' if dry else ''}files changed: {total}")


if __name__ == "__main__":
    main()
