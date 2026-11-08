"""Genera Coinbase Wallet y Rainbow a tamaño de app si el CDN no da PNG oficial."""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[1] / "assets" / "wallets"


def save(img: Image.Image, name: str) -> None:
    img.resize((256, 256), Image.Resampling.LANCZOS).save(OUT / name, "PNG")
    print("saved", name, img.size)


def coinbase_wallet() -> Image.Image:
    size = 1024
    img = Image.new("RGBA", (size, size), (0, 82, 255, 255))
    draw = ImageDraw.Draw(img)
    pad = 152
    draw.ellipse((pad, pad, size - pad, size - pad), fill=(255, 255, 255, 255))
    inner = 396
    draw.rounded_rectangle(
        (inner, inner, size - inner, size - inner),
        radius=72,
        fill=(0, 82, 255, 255),
    )
    return img


def rainbow_mark() -> Image.Image:
    size = 1024
    img = Image.new("RGBA", (size, size), (10, 10, 14, 255))
    draw = ImageDraw.Draw(img)
    bands = [
        (155, 91, 255),
        (255, 69, 158),
        (255, 92, 61),
        (255, 184, 48),
        (80, 227, 194),
    ]
    cx, cy = size // 2 + 70, size // 2 + 110
    outer = 470
    thickness = 64
    for index, color in enumerate(bands):
        r = outer - index * thickness
        draw.pieslice((cx - r, cy - r, cx + r, cy + r), 200, 340, fill=color)
        inner_r = r - thickness + 2
        draw.pieslice(
            (cx - inner_r, cy - inner_r, cx + inner_r, cy + inner_r),
            198,
            342,
            fill=(10, 10, 14, 255),
        )
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    save(coinbase_wallet(), "coinbase.png")
    save(rainbow_mark(), "rainbow.png")


if __name__ == "__main__":
    main()
