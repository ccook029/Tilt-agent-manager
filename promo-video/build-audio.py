#!/usr/bin/env python3
"""Sparse sound-design bed for a cut spec (invoked by build.js).

Usage: python3 build-audio.py build/spec.gen.json — writes audio.wav next to
the spec. This is deliberately NOT music: no beat, no melody, no drone. Just
cinematic accents synced to the edit — a soft riser into each cut, a sub-boom
impact on it, airy whooshes on zoom cuts, a crash into the end card, and
thumps under type slams (spec.audio.hits). Deterministic (seeded noise);
nothing to license. Swap in a real licensed track via spec.audio.track.
"""
import json
import sys
import wave
from pathlib import Path

import numpy as np

SPEC = json.load(open(sys.argv[1]))
OUT = Path(sys.argv[1]).parent / "audio.wav"
SR = 48000
DUR = float(SPEC["duration"])
N = int(SR * DUR)
rng = np.random.RandomState(1313)

mono = np.zeros(N + SR)


def add(start_s, sig):
    i = int(start_s * SR)
    if i < 0:
        sig = sig[-i:]
        i = 0
    j = min(len(mono), i + len(sig))
    if j > i:
        mono[i:j] += sig[: j - i]


def boom(vel=1.0, dur=0.7, f0=52):
    n = int(SR * dur); tt = np.arange(n) / SR
    f = f0 * np.exp(-tt * 3.0) + 34
    ph = 2 * np.pi * np.cumsum(f) / SR
    return vel * np.sin(ph) * np.exp(-tt * 4.2)


def riser(vel=0.4, dur=0.5):
    n = int(SR * dur); tt = np.arange(n) / SR
    noise = rng.randn(n)
    k = 260
    noise = np.convolve(noise, np.ones(k) / k, mode="same") * 8.0  # airy sweep
    return vel * noise * (tt / dur) ** 2.2


def whoosh(vel=0.55, dur=0.8):
    n = int(SR * dur); tt = np.arange(n) / SR
    noise = rng.randn(n)
    k = 200
    noise = np.convolve(noise, np.ones(k) / k, mode="same")
    return vel * noise * np.sin(np.pi * tt / dur) ** 2 * 6.0


def crash(vel=0.7, dur=2.4):
    n = int(SR * dur); tt = np.arange(n) / SR
    noise = rng.randn(n) * np.exp(-tt * 2.2)
    shimmer = np.sin(2 * np.pi * 9000 * tt) * np.exp(-tt * 3) * 0.15
    return vel * (noise + shimmer)


cuts = SPEC.get("cuts", [])
last_cut = max((c["t"] for c in cuts), default=None)
for c in cuts:
    t, fx = c["t"], c["fx"]
    add(t - 0.5, riser(vel=0.38))
    if fx == "zoomblur":
        add(t - 0.3, whoosh())
        add(t, boom(vel=1.0, f0=54))
    else:
        add(t, boom(vel=0.85, f0=48))
    if t == last_cut:  # settle into the end card
        add(t, crash())

# thumps under type slams etc. — spec.audio.hits: [seconds]
for t in (SPEC.get("audio") or {}).get("hits", []):
    add(t, boom(vel=0.8, dur=0.5, f0=58))

mono = mono[:N]
peak = np.max(np.abs(mono)) or 1.0
mono = np.tanh(mono / peak * 1.25) * 0.9
d = 8  # gentle haas widening
stereo = np.stack([mono, np.concatenate([np.zeros(d), mono[:-d]])], axis=1)
pcm16 = (np.clip(stereo, -1, 1) * 32767).astype("<i2")
with wave.open(str(OUT), "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm16.tobytes())
print(f"wrote {OUT.name} ({DUR:.1f}s, {len(cuts)} cut accents, sparse/no-music)")
