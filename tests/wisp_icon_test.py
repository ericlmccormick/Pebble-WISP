#!/usr/bin/env python3
"""Build-time checks for supplied WISP icons and generated watch resources."""
from pathlib import Path
from PIL import Image
import hashlib
import json

root = Path(__file__).resolve().parents[1]
branding = root / "branding"
resource = root / "resources" / "images"

for n in (144, 80):
    src = branding / f"WISP_icon_{n}.png"
    art = branding / f"WISP_color_{n}.png"
    assert src.read_bytes() == art.read_bytes(), "Supplied art was overwritten"
    with Image.open(art) as im:
        assert im.size == (n, n), im.size
        assert im.convert("RGBA").getpixel((0, 0))[3] == 0, "Lost transparent background"
    mono = Image.open(branding / f"WISP_mono_{n}.png").convert("RGBA")
    assert mono.size == (n, n)
    assert set(px[0] for px in mono.getdata()).issubset({0, 255})
    assert set(px[3] for px in mono.getdata()) == {0, 255}

with Image.open(resource / "WISP_color_48.png") as file:
    rgba = file.convert("RGBA")
    assert rgba.size == (48, 48)
    assert all(all(channel in (0, 85, 170, 255) for channel in px)
               for px in rgba.getdata()), "Not Pebble 64-color-safe"
    assert rgba.getpixel((0, 0))[3] == 0
    assert any(px[2] > px[0] and px[2] > px[1] and px[3] > 128
               for px in rgba.getdata()), "Blue wireless arcs missing"
with Image.open(resource / "WISP_mono_48.png") as file:
    rgba = file.convert("RGBA")
    assert rgba.size == (48, 48)
    assert rgba.getpixel((0, 0))[3] == 0
    assert all(px[:3] in ((0, 0, 0), (255, 255, 255)) for px in rgba.getdata())

menu = resource / "WISP_menu_25.png"
supplied = branding / "WISP_icon_25.png"
assert menu.read_bytes() == supplied.read_bytes(), "25px menu icon must be copied exactly"
with Image.open(menu) as im:
    assert im.size == (25, 25)
    alphas = [p[3] for p in im.convert("RGBA").getdata()]
    assert min(alphas) == 0 and max(alphas) == 255

with open(root / "package.json") as f:
    manifest = json.load(f)
assert manifest["version"] == "2.0.0" and manifest["pebble"]["version"] == "2.0.0"
menuentries = [m for m in manifest["pebble"]["resources"]["media"] if m.get("menuIcon")]
assert len(menuentries) == 1 and menuentries[0]["file"] == "images/WISP_menu_25.png"

# All agent logos remain transparent. The generic startup WISP logo should
# show the same speech-bubble + wifi artwork as the app-store icon.
for name in ("wisp", "gemini", "openai", "claude", "grok", "muse", "openrouter", "deepseek"):
    for mode in ("color", "mono"):
        p = resource / f"agent_{name}_{mode}.png"
        with Image.open(p) as im:
            rgba = im.convert("RGBA")
            assert rgba.size == (40, 40), p
            alpha = [px[3] for px in rgba.getdata()]
            assert min(alpha) == 0 and max(alpha) == 255, p
            assert rgba.getpixel((0, 0))[3] == 0, p
            assert sum(a > 0 for a in alpha) > 15, p

print("PASS: exact supplied 144/80/25 icons, transparent 64-color watch art, 2.0 menu icon")
