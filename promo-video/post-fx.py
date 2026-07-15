#!/usr/bin/env python3
"""Deterministic transition FX over rendered frames (invoked by build.js).

Usage: python3 post-fx.py build/spec.gen.json — reads the resolved cut list
(time + effect) and treats a short window around each cut.

Ports the glitch / RGB-split / zoom-blur transition presentations from the
open-source claude-code-video-toolkit (digitalsamba, MIT-style Remotion
components) to a frame-level pass: intensity peaks at each cut midpoint
(triangle curve), slice offsets and artifact blocks are seeded per frame so
re-runs are reproducible. Requires: pip install pillow numpy
"""
import json
import random
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

SPEC = json.load(open(sys.argv[1]))
FPS = SPEC.get("fps", 30)
FRAMES_DIR = Path(sys.argv[1]).parent / "frames"
HALF = {"glitch": 4, "rgbsplit": 4, "zoomblur": 5}
CUTS = [(c["t"], c["fx"], HALF.get(c["fx"], 4)) for c in SPEC["cuts"]]


def tri(p):  # 0..1 -> peaks 1.0 at midpoint, like interpolate([0,.5,1],[0,1,0])
    return max(0.0, 1.0 - abs(2.0 * p - 1.0))


def rgb_split(arr, k, rng, displacement=34):
    d = max(1, int(round(displacement * k)))
    out = arr.copy()
    out[:, :, 0] = np.roll(arr[:, :, 0], -d, axis=1)  # red left
    out[:, :, 2] = np.roll(arr[:, :, 2], d, axis=1)   # blue/cyan right
    if k > 0.3:  # scan lines
        out[::4] = (out[::4] * 0.82).astype(np.uint8)
    return out


def glitch(arr, k, rng, slices=10):
    h, w, _ = arr.shape
    out = arr.copy()
    sh = h // slices
    for i in range(slices):  # slice displacement with occasional hard jumps
        off = (rng.random() - 0.5) * 170 * k
        if rng.random() > 0.55:
            off *= 2.5 if rng.random() > 0.5 else -2.5
        y0, y1 = i * sh, min(h, (i + 1) * sh)
        out[y0:y1] = np.roll(arr[y0:y1], int(off), axis=1)
    out = rgb_split(out, k * 0.8, rng, displacement=26)
    img = Image.fromarray(out)
    ov = Image.new("RGBA", (w, h), (0, 0, 0, 0))  # artifact blocks
    dr = ImageDraw.Draw(ov)
    for _ in range(8):
        if rng.random() < 0.4:
            continue
        x, y = rng.random() * w, rng.random() * h
        bw, bh = (0.05 + rng.random() * 0.4) * w, (0.01 + rng.random() * 0.12) * h
        c = rng.random()
        col = (255, 255, 255, int(110 * k)) if c > 0.7 else \
              (255, 0, 80, int(130 * k)) if c > 0.4 else (0, 255, 255, int(130 * k))
        dr.rectangle([x, y, x + bw, y + bh], fill=col)
    img = Image.alpha_composite(img.convert("RGBA"), ov).convert("RGB")
    if k > 0.7 and rng.random() > 0.6:  # white pop at peak
        img = Image.blend(img, Image.new("RGB", img.size, "white"), 0.12 * k)
    return np.asarray(img)


def zoom_blur(arr, k, rng, layers=6):
    img = Image.fromarray(arr)
    w, h = img.size
    base = img.resize((int(w * (1 + 0.10 * k)), int(h * (1 + 0.10 * k))), Image.BILINEAR)
    acc = base.crop(((base.width - w) // 2, (base.height - h) // 2,
                     (base.width - w) // 2 + w, (base.height - h) // 2 + h))
    for i in range(1, layers):  # radial streaks: echoes at increasing scale
        s = 1 + (0.10 + i * 0.045) * k
        lay = img.resize((int(w * s), int(h * s)), Image.BILINEAR)
        lay = lay.crop(((lay.width - w) // 2, (lay.height - h) // 2,
                        (lay.width - w) // 2 + w, (lay.height - h) // 2 + h))
        acc = Image.blend(acc, lay, 1.0 / (i + 2))
    return np.asarray(Image.blend(acc, Image.new("RGB", acc.size, "#bfefff"), 0.06 * k))


FX = {"rgbsplit": rgb_split, "glitch": glitch, "zoomblur": zoom_blur}

if __name__ == "__main__":
    touched = 0
    for cut_t, name, half in CUTS:
        c = round(cut_t * FPS)
        for f in range(c - half, c + half + 1):
            path = FRAMES_DIR / f"f{f:04d}.jpg"
            if not path.exists():
                continue
            k = tri((f - (c - half)) / (2 * half))
            if k <= 0.01:
                continue
            rng = random.Random(f"{name}-{f}")
            arr = np.asarray(Image.open(path).convert("RGB"))
            Image.fromarray(FX[name](arr, k, rng)).save(path, quality=92)
            touched += 1
    print(f"post-fx applied to {touched} frames")
