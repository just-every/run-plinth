"""Rebuild the seamless tile and empty lobby slab with Python 3 + Pillow.

terrazzo-source.webp is the clear stone crop from 12ui's conversion of
Plinth's selected hero. Four mirrored edges make one seamless 1024px tile.
The crop contains material only; every product label is authored as HTML.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageOps

out = Path(__file__).resolve().parents[2] / 'public' / 'brand'
source = Image.open(Path(__file__).with_name('terrazzo-source.webp')).convert('RGB').resize((512, 512), Image.Resampling.LANCZOS)
stone = Image.new('RGB', (1024, 1024))
stone.paste(source, (0, 0))
stone.paste(ImageOps.mirror(source), (512, 0))
stone.paste(ImageOps.flip(source), (0, 512))
stone.paste(ImageOps.flip(ImageOps.mirror(source)), (512, 512))
stone.save(out / 'terrazzo.webp', quality=72, method=6)
# A low, empty slab for the installed Lobby: the only content is stone.
band = Image.new('RGBA', (2000, 360))
mask = Image.new('L', band.size)
m = ImageDraw.Draw(mask)
m.rounded_rectangle((22, 95, 1978, 310), radius=24, fill=255)
texture = Image.new('RGBA', band.size)
for x in range(0, 2000, 512):
    texture.paste(stone.resize((512, 512)), (x, 0))
texture.putalpha(mask)
shadow = Image.new('RGBA', band.size, (23, 24, 26, 0))
shadow.putalpha(mask.filter(ImageFilter.GaussianBlur(14)).point(lambda x: int(x * .18)))
band.alpha_composite(shadow, (0, 20))
band.alpha_composite(texture)
edge = Image.new('RGBA', band.size)
ImageDraw.Draw(edge).rounded_rectangle((22, 280, 1978, 311), radius=18, fill=(38, 33, 24, 28))
band.alpha_composite(edge)
band.save(out / 'band.webp', quality=82, method=6)
print('terrazzo.webp:', (out / 'terrazzo.webp').stat().st_size, 'bytes')
