# Картинка превью для соцсетей (public/og-image.png, 1200×630). Шрифты сайта (OFL): Inter и JetBrains Mono —
# скачать в текущую папку как Inter.ttf и JBMono.ttf, затем: python3 scripts/og-image.py && mv og-image.png public/
from PIL import Image, ImageDraw, ImageFont
W, H = 1200, 630
BG, FG, ACC, MUTED, LINE = (250, 246, 243), (60, 56, 53), (188, 119, 63), (110, 103, 95), (222, 201, 184)
S = 2  # рисуем в 2× и уменьшаем — сглаженные края
img = Image.new('RGB', (W * S, H * S), BG)
d = ImageDraw.Draw(img)

def font(path, size, wght):
    f = ImageFont.truetype(path, size * S)
    try:
        f.set_variation_by_axes([wght] if 'JB' in path else [32, wght])
    except Exception:
        pass
    return f

# «атмосфера»: концентрические дуги справа
cx, cy = 1080 * S, 560 * S
for i, r in enumerate(range(140, 760, 85)):
    w = 3 if i % 2 == 0 else 2
    d.ellipse([cx - r * S, cy - r * S, cx + r * S, cy + r * S], outline=LINE, width=w * S)
# орбита с «аккаунтом» — точка на дуге
import math
for r, ang in ((395, 212), (565, 236)):
    x = cx + r * S * math.cos(math.radians(ang)); y = cy + r * S * math.sin(math.radians(ang))
    d.ellipse([x - 11 * S, y - 11 * S, x + 11 * S, y + 11 * S], fill=ACC)

X = 84 * S
mono = font('JBMono.ttf', 22, 700)
d.text((X, 92 * S), 'AT PROTOCOL · ATMOSPHERE', font=mono, fill=ACC)

big = font('Inter.ttf', 132, 800)
y = 150 * S
parts = [('we', FG), ('AT', ACC), ('.media', FG)]
x = X
for t, c in parts:
    d.text((x, y), t, font=big, fill=c)
    x += d.textlength(t, font=big)

tag = font('Inter.ttf', 58, 700)
d.text((X, 330 * S), 'Свободное медиа', font=tag, fill=FG)

sub = font('Inter.ttf', 27, 500)
d.text((X, 412 * S), 'Медиа на открытом протоколе: ваш аккаунт и тексты', font=sub, fill=MUTED)
d.text((X, 450 * S), 'принадлежат вам.', font=sub, fill=MUTED)

chip = font('JBMono.ttf', 20, 600)
cx0 = X
for label in ('открытый протокол', 'гибкая настройка', 'без рекламных алгоритмов'):
    tw = d.textlength(label, font=chip)
    pad = 18 * S
    d.rounded_rectangle([cx0, 528 * S, cx0 + tw + pad * 2, 572 * S], radius=22 * S, outline=LINE, width=2 * S, fill=BG)
    d.text((cx0 + pad, 539 * S), label, font=chip, fill=FG)
    cx0 += tw + pad * 2 + 14 * S

# акцентная полоса слева
d.rectangle([0, 0, 10 * S, H * S], fill=ACC)
img.resize((W, H), Image.LANCZOS).save('og-image.png', optimize=True)
print('ok')
