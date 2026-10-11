#!/usr/bin/env python3
"""Render the supplied TiPlay SVG for Android and CarPlay (Inkscape + Pillow)."""

import os
from pathlib import Path
import subprocess
import tempfile
import xml.etree.ElementTree as ET

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets/branding/logo_centered.svg"
BACKGROUND = "#fdfcf7"
DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}


def generate():
    with tempfile.TemporaryDirectory(prefix="tiplay-icons-") as directory:
        temporary = Path(directory)
        environment = dict(os.environ, INKSCAPE_PROFILE_DIR=str(temporary / "profile"),
                           XDG_CACHE_HOME=str(temporary / "cache"))

        def render(source, name):
            output = temporary / name
            subprocess.run(["inkscape", str(source), "--export-type=png",
                            f"--export-filename={output}", "--export-width=1024",
                            "--export-height=1024"], check=True, env=environment)
            with Image.open(output) as image:
                return image.convert("RGBA")

        tile = render(SOURCE, "tile.png")
        tree = ET.parse(SOURCE)
        svg = tree.getroot()
        # The background is a separate adaptive-icon layer; keep every logo path intact.
        for child in list(svg):
            if child.tag == "{http://www.w3.org/2000/svg}rect":
                svg.remove(child)
        transparent = temporary / "foreground.svg"
        tree.write(transparent, encoding="utf-8", xml_declaration=True)
        logo = render(transparent, "logo.png")

        def resize(image, size):
            return image.resize((size, size), Image.Resampling.LANCZOS)

        for density, scale in DENSITIES.items():
            target = ROOT / f"shared/src/main/res/mipmap-{density}"
            legacy_size, layer_size = round(48 * scale), round(108 * scale)
            legacy = resize(tile, legacy_size)
            legacy.save(target / "ic_launcher.webp", lossless=True)
            mask = Image.new("L", legacy.size)
            ImageDraw.Draw(mask).ellipse((0, 0, legacy_size - 1, legacy_size - 1), fill=255)
            rounded = legacy.copy()
            rounded.putalpha(mask)
            rounded.save(target / "ic_launcher_round.webp", lossless=True)
            Image.new("RGB", (layer_size, layer_size), BACKGROUND).save(
                target / "ic_launcher_background.webp", lossless=True)
            foreground = Image.new("RGBA", (layer_size, layer_size))
            # 72/108 canvas inset keeps the actual artwork inside the 66 dp safe circle.
            artwork = resize(logo, round(72 * scale))
            inset = (layer_size - artwork.width) // 2
            foreground.alpha_composite(artwork, (inset, inset))
            foreground.save(target / "ic_launcher_foreground.webp", lossless=True)
            monochrome = Image.new("RGBA", foreground.size, "white")
            monochrome.putalpha(foreground.getchannel("A"))
            monochrome.save(target / "ic_launcher_monochrome.webp", lossless=True)

        resize(tile, 512).save(ROOT / "shared/src/main/ic_launcher-playstore.png")
        (ROOT / "site/play/icon.svg").write_bytes(SOURCE.read_bytes())
        resize(tile, 192).save(ROOT / "site/assets/icon.png")
        for resource in ("drawable/ic_carplay.png", "raw/ic_car_home.png"):
            resize(tile, 192).save(ROOT / f"common/src/main/res/{resource}")


if __name__ == "__main__":
    generate()
