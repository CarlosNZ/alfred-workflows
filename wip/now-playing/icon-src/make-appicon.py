#!/usr/bin/env python3
"""Builds nowplaying.alfredui/appicon.png, the panel's app icon (see README, "App icon and name").

Puts waveform.svg on a macOS-style squircle tile: a 1024px canvas with an 824px
tile, a top-to-bottom gradient, a faint top sheen and edge, and a drop shadow.
Needs rsvg-convert (Homebrew librsvg) at build time only.
"""
import math
import re
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / 'nowplaying.alfredui' / 'appicon.png'

TOP, BOTTOM = '#3a3d4f', '#15161e'  # tile gradient
CANVAS, TILE = 1024, 824
EXPONENT = 5  # superellipse exponent, close to Apple's continuous-corner squircle
GLYPH_WIDTH = 0.68  # waveform width as a fraction of the tile's
# The waveform's extent in its 24-unit viewBox, strokes included.
GX0, GX1, GY0, GY1 = 1.0, 22.4, 3.6, 20.4


def squircle_path():
    a = TILE / 2
    c0 = CANVAS / 2
    pts = []
    for i in range(720):
        t = 2 * math.pi * i / 720
        c, s = math.cos(t), math.sin(t)
        x = a * math.copysign(abs(c) ** (2 / EXPONENT), c)
        y = a * math.copysign(abs(s) ** (2 / EXPONENT), s)
        pts.append(f'{c0 + x:.2f},{c0 + y:.2f}')
    return 'M' + 'L'.join(pts) + 'Z'


def glyph_body():
    svg = (HERE / 'waveform.svg').read_text()
    body = re.search(r'<svg[^>]*>(.*)</svg>', svg, re.S).group(1)
    # The ground-shadow ellipses read as a smudge on the tile.
    return re.sub(r'<path[^>]*class="wm-shadow"/>', '', body)


def icon_svg():
    d = squircle_path()
    scale = TILE * GLYPH_WIDTH / (GX1 - GX0)
    tx = CANVAS / 2 - (GX0 + GX1) / 2 * scale
    ty = CANVAS / 2 - (GY0 + GY1) / 2 * scale
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {CANVAS} {CANVAS}" width="{CANVAS}" height="{CANVAS}">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{TOP}"/><stop offset="1" stop-color="{BOTTOM}"/></linearGradient>
  <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <filter id="drop" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="12" stdDeviation="12" flood-color="#000" flood-opacity=".28"/></filter>
  <clipPath id="clip"><path d="{d}"/></clipPath>
</defs>
<path d="{d}" fill="url(#bg)" filter="url(#drop)"/>
<path d="{d}" fill="url(#sheen)"/>
<path d="{d}" fill="none" stroke="#fff" stroke-opacity=".14" stroke-width="4" clip-path="url(#clip)"/>
<g transform="translate({tx:.2f} {ty:.2f}) scale({scale:.4f})">{glyph_body()}</g>
</svg>
'''


if __name__ == '__main__':
    subprocess.run(['rsvg-convert', '-w', str(CANVAS), '-h', str(CANVAS), '-o', str(OUT)],
                   input=icon_svg().encode(), check=True)
    print(f'Wrote {OUT}')
