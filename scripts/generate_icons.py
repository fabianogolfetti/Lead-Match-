"""Gera os ícones do PWA do LeadMatch: fundo escuro, "L" em âmbar com uma
linha de base representando terreno/fundação. Rode uma vez; os PNGs
resultantes ficam versionados em public/icons.

Requer Pillow: pip install pillow
"""

from PIL import Image, ImageDraw, ImageFont

BG = "#1c1c1c"
AMBER = "#FAC775"
FONT_PATH = "C:\\Windows\\Fonts\\arialbd.ttf"

OUT_DIR = "public/icons"


def make_icon(size, maskable=False):
    img = Image.new("RGB", (size, size), BG)
    draw = ImageDraw.Draw(img)

    shrink = 0.78 if maskable else 1.0

    font_size = int(size * 0.42 * shrink)
    font = ImageFont.truetype(FONT_PATH, font_size)

    text = "L"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]

    gap = size * 0.07 * shrink
    line_h = max(2, int(size * 0.045 * shrink))
    total_h = th + gap + line_h

    top = (size - total_h) / 2
    letter_x = (size - tw) / 2 - bbox[0]
    letter_y = top - bbox[1]
    draw.text((letter_x, letter_y), text, font=font, fill=AMBER)

    line_w = tw * 1.35
    line_x0 = (size - line_w) / 2
    line_y0 = top + th + gap
    draw.rounded_rectangle(
        [line_x0, line_y0, line_x0 + line_w, line_y0 + line_h],
        radius=line_h // 2,
        fill=AMBER,
    )

    return img


def main():
    import os

    os.makedirs(OUT_DIR, exist_ok=True)

    make_icon(192).save(f"{OUT_DIR}/icon-192.png")
    make_icon(512).save(f"{OUT_DIR}/icon-512.png")
    make_icon(192, maskable=True).save(f"{OUT_DIR}/icon-maskable-192.png")
    make_icon(512, maskable=True).save(f"{OUT_DIR}/icon-maskable-512.png")
    make_icon(180).save(f"{OUT_DIR}/apple-touch-icon.png")
    make_icon(32).save(f"{OUT_DIR}/favicon-32.png")

    print("Icones gerados em", OUT_DIR)


if __name__ == "__main__":
    main()
