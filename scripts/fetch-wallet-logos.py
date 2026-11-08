"""Descarga iconos oficiales de las billeteras (CDN de cada marca, no avatares)."""
from io import BytesIO
from pathlib import Path
from urllib.request import Request, urlopen

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "wallets"

# URLs oficiales o de kits de marca / listados WalletConnect-TON de cada wallet.
SOURCES = {
    "metamask": [
        "https://raw.githubusercontent.com/MetaMask/metamask-extension/master/app/images/icon-512.png",
        "https://upload.wikimedia.org/wikipedia/commons/thumb/3/36/MetaMask_Fox.svg/512px-MetaMask_Fox.svg.png",
        "https://icons.llamao.fi/icons/wallets/metamask?w=256&h=256",
    ],
    "trust": [
        "https://icons.llamao.fi/icons/wallets/trust?w=256&h=256",
        "https://icons.llamao.fi/icons/wallets/trustwallet?w=256&h=256",
        "https://trustwallet.com/assets/images/favicon.png",
        "https://avatars.githubusercontent.com/u/32179889?s=512&v=4",
    ],
    "binance": [
        "https://public.bnbstatic.com/static/binance-w3w/ton-provider/binancew3w.png",
        "https://icons.llamao.fi/icons/wallets/binance-wallet?w=256&h=256",
        "https://icons.llamao.fi/icons/wallets/binance?w=256&h=256",
    ],
    "okx": [
        "https://static.okx.com/cdn/web3/assets/imgs/70d223c0-8527-40c1-8292-b3cc10b53d88.png",
        "https://static.okx.com/cdn/web3/assets/imgs/be493af9-09fe-4e93-af0d-d6c4b040cea9.png",
        "https://icons.llamao.fi/icons/wallets/okx?w=256&h=256",
    ],
    "safepal": [
        "https://s.pvcliping.com/web/public_image/SafePal_x288.png",
        "https://icons.llamao.fi/icons/wallets/safepal?w=256&h=256",
    ],
    "tokenpocket": [
        "https://hk.tpstatic.net/logo/tokenpocket.png",
        "https://icons.llamao.fi/icons/wallets/tokenpocket?w=256&h=256",
    ],
    "coinbase": [
        "https://icons.llamao.fi/icons/wallets/coinbase-wallet?w=256&h=256",
        "https://www.coinbase.com/img/favicon/favicon-256.png",
        "https://icons.llamao.fi/icons/wallets/coinbase?w=256&h=256",
    ],
    "bitget": [
        "https://raw.githubusercontent.com/bitgetwallet/download/refs/heads/main/logo/png/bitget_wallet_logo_288_mini.png",
        "https://icons.llamao.fi/icons/wallets/bitget?w=256&h=256",
    ],
    "rainbow": [
        "https://icons.llamao.fi/icons/wallets/rainbow?w=256&h=256",
        "https://rainbow.me/favicon.ico",
    ],
    "rabby": [
        "https://icons.llamao.fi/icons/wallets/rabby?w=256&h=256",
        "https://rabby.io/assets/images/logo-128.png",
        "https://download.rabby.io/logo.png",
    ],
}


def fetch(url: str) -> bytes | None:
    if not url.startswith("https://"):
        print("skip scheme", url)
        return None
    try:
        req = Request(url, headers={"User-Agent": "Mozilla/5.0 QuatriviumCredit/1.0"})
        # SOURCES es allowlist https del propio archivo, no input de usuario.
        with urlopen(req, timeout=25) as response:  # nosemgrep
            data = response.read()
            if len(data) < 80:
                return None
            return data
    except Exception as error:
        print("fail", url, type(error).__name__)
        return None


def to_png(data: bytes) -> Image.Image | None:
    try:
        return Image.open(BytesIO(data)).convert("RGBA")
    except Exception:
        return None


def is_github_identicon(img: Image.Image) -> bool:
    sample = img.resize((40, 40), Image.Resampling.NEAREST)
    pixels = list(sample.getdata())
    colors = {pixel[:3] for pixel in pixels if pixel[3] > 200}
    grayish = sum(
        1
        for red, green, blue, alpha in pixels
        if alpha > 200 and abs(red - green) < 10 and abs(green - blue) < 10 and 220 <= red <= 248
    )
    return grayish > 18 and len(colors) < 8


def save_square(img: Image.Image, dest: Path) -> None:
    image = img.convert("RGBA")
    box = image.getbbox()
    if box:
        image = image.crop(box)
    image.thumbnail((256, 256), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    canvas.alpha_composite(image, ((256 - image.width) // 2, (256 - image.height) // 2))
    canvas.save(dest, "PNG")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for wallet_id, urls in SOURCES.items():
        dest = OUT / f"{wallet_id}.png"
        saved = False
        for url in urls:
            raw = fetch(url)
            if not raw:
                continue
            image = to_png(raw)
            if not image or min(image.size) < 32 or is_github_identicon(image):
                print("skip", wallet_id, url)
                continue
            save_square(image, dest)
            print("ok", wallet_id, url, image.size)
            saved = True
            break
        if not saved:
            print("MISSING", wallet_id)


if __name__ == "__main__":
    main()
