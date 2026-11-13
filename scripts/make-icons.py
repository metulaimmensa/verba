"""Иконка приложения из assets/icon/source.png → наборы для Android (обычная, круглая, адаптивная)."""
import pathlib
from PIL import Image, ImageDraw
ROOT = pathlib.Path(__file__).resolve().parent.parent
src = Image.open(ROOT / 'assets/icon/source.png').convert('RGBA')
L, T, R, B = 59, 60, 1189, 1195
side = max(R - L, B - T)
art = src.crop((L, T, L + side, T + side))
S = 1024
art = art.resize((S, S), Image.LANCZOS)
# убираем чёрные углы за пределами скругления
mask = Image.new('L', (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, S - 1, S - 1), radius=int(S * 0.255), fill=255)
art.putalpha(mask)
BG = (24, 17, 56, 255)   # индиго фона иконки
out = ROOT / 'assets/icon/android'
dens = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
for d, k in dens.items():
    folder = out / f'mipmap-{d}'; folder.mkdir(parents=True, exist_ok=True)
    n = int(48 * k)
    # обычная: квадрат со скруглением
    art.resize((n, n), Image.LANCZOS).save(folder / 'ic_launcher.png')
    # круглая: заливаем фон и режем кругом
    full = Image.new('RGBA', (S, S), BG); full.alpha_composite(art)
    c = Image.new('L', (S, S), 0); ImageDraw.Draw(c).ellipse((0, 0, S - 1, S - 1), fill=255)
    rnd = Image.new('RGBA', (S, S), (0, 0, 0, 0)); rnd.paste(full, (0, 0), c)
    rnd.resize((n, n), Image.LANCZOS).save(folder / 'ic_launcher_round.png')
    # адаптивная: карточка должна уместиться в безопасную зону 72 из 108 dp
    f = int(108 * k)
    fg = Image.new('RGBA', (f, f), (0, 0, 0, 0))
    a = int(f * 0.68)
    fg.alpha_composite(art.resize((a, a), Image.LANCZOS), ((f - a) // 2, (f - a) // 2))
    fg.save(folder / 'ic_launcher_foreground.png')
(out / 'values').mkdir(exist_ok=True)
(out / 'values/ic_launcher_background.xml').write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#%02X%02X%02X</color>\n</resources>\n' % BG[:3])
# иконка для самого приложения (настройки, вкладка браузера)
art.resize((192, 192), Image.LANCZOS).save(ROOT / 'www/icon.png')
print('ok')
