"""Recorta el fondo negro del emblema y genera iconos de APK con placa profesional."""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
RANKS = ASSETS / "ranks"
SRC = ASSETS / "logo-source.png"
DST = ASSETS / "logo.png"
PLATE = (7, 21, 15, 255)
RANK_METALS = {
    1: ((122, 67, 24), (196, 121, 60), (240, 192, 144)),
    2: ((110, 58, 18), (184, 107, 46), (232, 176, 120)),
    3: ((94, 106, 116), (184, 192, 200), (244, 247, 250)),
    4: ((74, 86, 96), (154, 166, 178), (232, 238, 244)),
    5: ((138, 106, 18), (224, 180, 58), (255, 233, 160)),
    6: ((122, 90, 10), (212, 160, 23), (248, 213, 106)),
    7: ((47, 111, 140), (126, 200, 232), (216, 243, 255)),
    8: ((30, 90, 116), (90, 176, 214), (196, 236, 250)),
    9: ((21, 122, 154), (100, 212, 240), (232, 251, 255)),
    10: ((91, 33, 182), (167, 139, 250), (237, 233, 254)),
}


def luma(pixel: tuple[int, int, int, int]) -> float:
    r, g, b, _a = pixel
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def is_backdrop(pixel: tuple[int, int, int, int]) -> bool:
    r, g, b, a = pixel
    if a == 0:
        return True
    if luma(pixel) > 22:
        return False
    return g <= r + 8 and g <= 28


def flood_transparent(img: Image.Image) -> Image.Image:
    img = img.convert("RGBA")
    pixels = img.load()
    w, h = img.size
    seen = bytearray(w * h)
    stack: list[tuple[int, int]] = []

    def push(x: int, y: int) -> None:
        if 0 <= x < w and 0 <= y < h and not seen[y * w + x]:
            stack.append((x, y))

    for x in range(w):
        push(x, 0)
        push(x, h - 1)
    for y in range(h):
        push(0, y)
        push(w - 1, y)
    push(w // 2, h // 2)
    push(w // 2, h // 3)
    push(w // 2, (2 * h) // 3)

    while stack:
        x, y = stack.pop()
        idx = y * w + x
        if seen[idx]:
            continue
        seen[idx] = 1
        pixel = pixels[x, y]
        if not is_backdrop(pixel):
            continue
        pixels[x, y] = (0, 0, 0, 0)
        push(x + 1, y)
        push(x - 1, y)
        push(x, y + 1)
        push(x, y - 1)

    for _ in range(3):
        fringe = []
        for y in range(1, h - 1):
            for x in range(1, w - 1):
                r, g, b, a = pixels[x, y]
                if a == 0 or luma((r, g, b, a)) > 26:
                    continue
                neighbors = (
                    pixels[x + 1, y][3],
                    pixels[x - 1, y][3],
                    pixels[x, y + 1][3],
                    pixels[x, y - 1][3],
                )
                if min(neighbors) == 0:
                    fringe.append((x, y))
        for x, y in fringe:
            pixels[x, y] = (0, 0, 0, 0)

    for y in range(h):
        for x in range(w):
            if is_backdrop(pixels[x, y]):
                pixels[x, y] = (0, 0, 0, 0)
    return img


def crop_mark(img: Image.Image, pad_ratio: float = 0.06) -> Image.Image:
    alpha = img.split()[-1]
    bbox = alpha.getbbox()
    if not bbox:
        return img
    left, top, right, bottom = bbox
    width = right - left
    height = bottom - top
    pad = int(max(width, height) * pad_ratio)
    box = (
        max(0, left - pad),
        max(0, top - pad),
        min(img.width, right + pad),
        min(img.height, bottom + pad),
    )
    cropped = img.crop(box)
    side = max(cropped.size)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.alpha_composite(cropped, ((side - cropped.width) // 2, (side - cropped.height) // 2))
    return square


def color_transparent(img: Image.Image, rgb: tuple[int, int, int] = (28, 92, 54)) -> Image.Image:
    img = img.copy()
    pixels = img.load()
    r0, g0, b0 = rgb
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            if a == 0:
                pixels[x, y] = (r0, g0, b0, 0)
    return img


def punch_fringe(img: Image.Image) -> Image.Image:
    img = img.copy()
    pixels = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            if a < 18 or (a < 220 and luma((r, g, b, a)) < 18):
                pixels[x, y] = (r, g, b, 0)
    return img


def fit_mark(logo: Image.Image, inner: int) -> Image.Image:
    prepared = color_transparent(logo)
    ratio = min(inner / prepared.width, inner / prepared.height)
    size = (max(1, int(prepared.width * ratio)), max(1, int(prepared.height * ratio)))
    return punch_fringe(prepared.resize(size, Image.Resampling.LANCZOS))


def compose(logo: Image.Image, size: int, pad_ratio: float, rounded: bool, transparent: bool) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0) if transparent else PLATE)
    if not transparent:
        canvas.paste(PLATE, (0, 0, size, size))
    mark = fit_mark(logo, int(size * pad_ratio))
    canvas.alpha_composite(mark, ((size - mark.width) // 2, (size - mark.height) // 2))
    if rounded:
        mask = Image.new("L", (size, size), 0)
        draw = ImageDraw.Draw(mask)
        radius = int(size * 0.22)
        draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
        clipped = Image.new("L", (size, size), 0)
        clipped.paste(canvas.split()[-1], mask=mask)
        canvas.putalpha(clipped)
    return canvas


def lerp(a: float, b: float, t: float) -> int:
    return int(a + (b - a) * max(0.0, min(1.0, t)))


def colorize(logo: Image.Image, dark: tuple[int, int, int], metal: tuple[int, int, int], light: tuple[int, int, int]) -> Image.Image:
    img = logo.convert("RGBA")
    pixels = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            if a == 0:
                continue
            tone = luma((r, g, b, a)) / 255.0
            if tone < 0.42:
                t = tone / 0.42
                rgb = (
                    lerp(dark[0], metal[0], t),
                    lerp(dark[1], metal[1], t),
                    lerp(dark[2], metal[2], t),
                )
            else:
                t = (tone - 0.42) / 0.58
                rgb = (
                    lerp(metal[0], light[0], t),
                    lerp(metal[1], light[1], t),
                    lerp(metal[2], light[2], t),
                )
            pixels[x, y] = (*rgb, a)
    return img


def circle_mask(size: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((0, 0, size - 1, size - 1), fill=255)
    return mask


def write_android_icons(logo: Image.Image) -> None:
    res = ROOT / "android" / "app" / "src" / "main" / "res"
    if not res.exists():
        return
    densities = {
        "mdpi": 1.0,
        "hdpi": 1.5,
        "xhdpi": 2.0,
        "xxhdpi": 3.0,
        "xxxhdpi": 4.0,
    }
    for name, scale in densities.items():
        launcher = compose(logo, int(48 * scale), 0.78, rounded=False, transparent=False).convert("RGB")
        folder = res / f"mipmap-{name}"
        folder.mkdir(exist_ok=True)
        launcher.save(folder / "ic_launcher.png")
        round_icon = launcher.convert("RGBA")
        round_icon.putalpha(circle_mask(round_icon.width))
        round_icon.save(folder / "ic_launcher_round.png")
        compose(logo, int(108 * scale), 0.62, rounded=False, transparent=True).save(
            folder / "ic_launcher_foreground.png"
        )
        splash = compose(logo, int(160 * scale), 0.86, rounded=False, transparent=True)
        draw_folder = res / f"drawable-{name}"
        draw_folder.mkdir(exist_ok=True)
        splash.save(draw_folder / "splashscreen_logo.png")
    colors = res / "values" / "colors.xml"
    if colors.exists():
        text = colors.read_text(encoding="utf-8")
        text = text.replace("#000000", "#07150F")
        colors.write_text(text, encoding="utf-8")


def write_rank_icons(logo: Image.Image) -> None:
    RANKS.mkdir(exist_ok=True)
    mark = compose(logo, 512, 0.92, rounded=False, transparent=True)
    for level, colors in RANK_METALS.items():
        tinted = punch_fringe(colorize(mark, *colors))
        tinted.save(RANKS / f"{level}.png")


def main() -> None:
    source = SRC if SRC.exists() else DST
    if not SRC.exists():
        Image.open(source).save(SRC)
    raw = Image.open(SRC)
    logo = crop_mark(flood_transparent(raw))
    ui = punch_fringe(compose(logo, 1024, 0.92, rounded=False, transparent=True))
    ui.save(DST)
    icon = compose(logo, 1024, 0.78, rounded=False, transparent=False)
    icon.convert("RGB").save(ASSETS / "icon.png", quality=95)
    adaptive = compose(logo, 1024, 0.62, rounded=False, transparent=True)
    adaptive.save(ASSETS / "adaptive-icon.png")
    splash = Image.new("RGB", (1284, 2778), PLATE[:3])
    mark = fit_mark(logo, 760)
    layer = Image.new("RGBA", splash.size, (0, 0, 0, 0))
    layer.alpha_composite(mark, ((1284 - mark.width) // 2, (2778 - mark.height) // 2 - 80))
    Image.alpha_composite(splash.convert("RGBA"), layer).convert("RGB").save(
        ASSETS / "splash-icon.png", quality=95
    )
    fav = compose(logo, 192, 0.78, rounded=True, transparent=False)
    fav.save(ASSETS / "favicon.png")
    write_rank_icons(logo)
    write_android_icons(logo)
    print(f"logo prepared {logo.size}")


if __name__ == "__main__":
    main()
