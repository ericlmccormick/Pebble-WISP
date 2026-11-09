#!/usr/bin/env python3
"""Generate provider icons, then apply the user-approved WISP default icon."""
from pathlib import Path
import runpy
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
runpy.run_path(str(ROOT / "branding" / "agent_icon_source.py"), run_name="__main__")

# The generic/unknown-provider screen displays RESOURCE_ID_AGENT_WISP,
# not RESOURCE_ID_IMAGE_WISP_LOGO. Keep them visually consistent.
with Image.open(ROOT / "branding" / "WISP_icon_144.png") as icon:
    source = icon.convert("RGBA").resize((40, 40), Image.Resampling.LANCZOS)
from_generator = runpy.run_path(str(ROOT / "tools" / "generate_wisp_icons.py"))
out = ROOT / "resources" / "images"
from_generator["pebble_64"](source).save(out / "agent_wisp_color.png", optimize=True)
from_generator["display_mono"](source).save(out / "agent_wisp_mono.png", optimize=True)
print("Updated unknown-provider WISP icon from approved new artwork")
