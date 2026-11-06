#!/usr/bin/env python3
"""Stitch UI survey screenshots into 2x2 contact sheets for review."""
from PIL import Image, ImageDraw
from pathlib import Path
import sys

SRC = Path("/tmp/ui-survey")
CELL_W, CELL_H = 1100, 690
PAD = 8

def sheet(names, out):
    cols, rows = 2, (len(names) + 1) // 2
    W = cols * CELL_W + PAD * (cols + 1)
    H = rows * (CELL_H + 28) + PAD * (rows + 1)
    canvas = Image.new("RGB", (W, H), "#1a1a2e")
    draw = ImageDraw.Draw(canvas)
    for i, name in enumerate(names):
        p = SRC / f"{name}.png"
        col, row = i % 2, i // 2
        x = PAD + col * (CELL_W + PAD)
        y = PAD + row * (CELL_H + 28 + PAD)
        if p.exists():
            img = Image.open(p).convert("RGB")
            img.thumbnail((CELL_W, CELL_H))
            canvas.paste(img, (x, y))
        draw.text((x + 4, y + CELL_H + 6), name, fill="#ffffff")
    canvas.save(out, quality=80)
    print("saved", out, canvas.size)

groups = [
    ("app", ["app-dashboard", "app-results", "app-logic", "app-analytics"]),
    ("app2", ["app-ai", "app-billing", "app-domains", "app-tokens"]),
    ("pub", ["pub-login", "pub-register", "pub-forgot", "pub-reset"]),
    ("pub2", ["pub-templates", "pub-template-detail", "pub-dpa", "pub-abuse"]),
    ("pub3", ["pub-embed-demo", "pub-embed-index"]),
]
which = sys.argv[1] if len(sys.argv) > 1 else "all"
for gname, names in groups:
    if which in ("all", gname):
        sheet(names, str(SRC / f"sheet-{gname}.jpg"))
