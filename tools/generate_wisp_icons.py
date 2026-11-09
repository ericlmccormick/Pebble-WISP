#!/usr/bin/env python3
"""Build WISP assets from the user-approved transparent 144/80/25 px PNGs.

The committed files in branding/WISP_icon_*.png are the source of truth.
Do not draw or regenerate the artwork from the obsolete WISP_source_144.png.
The 25px icon is copied byte-for-byte to the Pebble launcher menu resource.
"""
from pathlib import Path
from shutil import copyfile
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
BRANDING = ROOT / "branding"
RESOURCES = ROOT / "resources" / "images"
BLACK, WHITE = (0, 0, 0), (255, 255, 255)
PEBBLE_LEVELS = (0, 85, 170, 255)


def display_mono(image):
    """Preserve the black signal bars and the white/blue speech silhouette."""
    rgba = image.convert("RGBA")
    out = Image.new("RGBA", rgba.size)
    pixels = []
    for r, g, b, a in rgba.getdata():
        # Transparent pixels must never become a colored rectangular backdrop.
        if a < 128:
            pixels.append((0, 0, 0, 0))
        elif max(r, g, b) < 105:
            pixels.append((0, 0, 0, 255))
        else:
            pixels.append((255, 255, 255, 255))
    out.putdata(pixels)
    return out


def pebble_64(image):
    """Convert the tiny in-app logo to Pebble's 2 bits/channel color palette."""
    rgba = image.convert("RGBA")
    pixels = []
    for r, g, b, a in rgba.getdata():
        rr, gg, bb = (PEBBLE_LEVELS[min(3, (v + 42) // 85)] for v in (r, g, b))
        aa = PEBBLE_LEVELS[min(3, (a + 42) // 85)]
        pixels.append((rr, gg, bb, aa))
    out = Image.new("RGBA", rgba.size)
    out.putdata(pixels)
    return out


def main():
    RESOURCES.mkdir(parents=True, exist_ok=True)
    for size in (144, 80, 25):
        input_path = BRANDING / f"WISP_icon_{size}.png"
        with Image.open(input_path) as im:
            im.verify()
        with Image.open(input_path) as im:
            assert im.size == (size, size), (input_path, im.size)
            assert im.convert("RGBA").getpixel((0, 0))[3] == 0, input_path

    # Store artwork: use the exact supplied PNG pixel data without changing
    # colors or stretching the smaller supplied version from the larger one.
    for size in (144, 80):
        with Image.open(BRANDING / f"WISP_icon_{size}.png") as im:
            image = im.convert("RGBA")
        copyfile(BRANDING / f"WISP_icon_{size}.png", BRANDING / f"WISP_color_{size}.png")
        display_mono(image).save(BRANDING / f"WISP_mono_{size}.png", optimize=True)

    with Image.open(BRANDING / "WISP_icon_144.png") as im:
        reduced = im.convert("RGBA").resize((48, 48), Image.Resampling.LANCZOS)
    pebble_64(reduced).save(RESOURCES / "WISP_color_48.png", optimize=True)
    display_mono(reduced).save(RESOURCES / "WISP_mono_48.png", optimize=True)

    # Crucial: the launcher must use the user's EXACT 25px gray/black artwork.
    copyfile(BRANDING / "WISP_icon_25.png", RESOURCES / "WISP_menu_25.png")
    print("WISP supplied icons: original 144/80 preserved; native 25px menu; 48px watch logos")


if __name__ == "__main__":
    main()
