from PIL import Image, ImageDraw
import math

SZ = 512
img = Image.new("RGBA", (SZ, SZ), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

cx = cy = SZ / 2
R = SZ * 0.46

# Фон-круг (тёмный)
d.ellipse([cx-R, cy-R, cx+R, cy+R], fill=(23, 26, 33, 255))

# Кольцо сегментов (чередование красный/чёрный)
seg = 24
r_out = R
r_in = R * 0.66
RED = (161, 53, 68)
BLACK = (28, 31, 38)
GREEN = (32, 128, 141)
for i in range(seg):
    a0 = (360.0 / seg) * i
    a1 = (360.0 / seg) * (i + 1)
    col = GREEN if i == 0 else (RED if i % 2 else BLACK)
    d.pieslice([cx-r_out, cy-r_out, cx+r_out, cy+r_out], a0, a1, fill=col)

# Внутренний диск
d.ellipse([cx-r_in, cy-r_in, cx+r_in, cy+r_in], fill=(23, 26, 33, 255))

# Спицы
r_hub = R * 0.16
for i in range(8):
    a = math.radians((360/8)*i)
    x = cx + math.cos(a) * r_in
    y = cy + math.sin(a) * r_in
    d.line([cx, cy, x, y], fill=(139, 144, 156, 255), width=6)

# Ступица (акцент-тил)
d.ellipse([cx-r_hub, cy-r_hub, cx+r_hub, cy+r_hub], fill=GREEN)
d.ellipse([cx-r_hub*0.45, cy-r_hub*0.45, cx+r_hub*0.45, cy+r_hub*0.45], fill=(230, 232, 236, 255))

img.save("/home/user/workspace/roulette_desktop/build/icon_512.png")

# Мульти-размерный ICO
sizes = [(256,256),(128,128),(64,64),(48,48),(32,32),(16,16)]
img.save("/home/user/workspace/roulette_desktop/build/icon.ico", sizes=sizes)
print("icon.ico written")
