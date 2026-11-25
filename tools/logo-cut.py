# Cut the Gemini splat out of its white background into transparent PNGs.
# Alpha comes from how far each pixel is from white on the blue channel
# (white B=255, the orange B~31), so edges stay anti-aliased; colour is set
# to one exact brand orange so the mark is perfectly flat.
import sys
from PIL import Image
src, out_dir = sys.argv[1], sys.argv[2]
ORANGE = (0xFF, 0x5A, 0x1F)
im = Image.open(src).convert("RGB")
w, h = im.size
px = im.load()
cut = Image.new("RGBA", (w, h))
cp = cut.load()
for y in range(h):
    for x in range(w):
        b = px[x, y][2]
        a = max(0, min(255, round((255 - b) * 255 / (255 - 40))))
        cp[x, y] = (*ORANGE, a if a > 8 else 0)
box = cut.getbbox()
cut = cut.crop(box)
side = max(cut.size)
pad = round(side * 0.06)
square = Image.new("RGBA", (side + 2 * pad, side + 2 * pad), (0, 0, 0, 0))
square.paste(cut, ((square.width - cut.width) // 2, (square.height - cut.height) // 2), cut)
square.save(f"{out_dir}/stash-splat-master.png")
for size in (512, 192, 64, 32):
    square.resize((size, size), Image.LANCZOS).save(f"{out_dir}/stash-splat-{size}.png")
print("bbox", box, "-> square", square.size)
