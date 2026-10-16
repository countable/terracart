# Re-skin the opening slide's compass (story_compass, story_compass_frame2) in
# the HUD's living-silver dragonscale (assets/ui/compass/reference-carving-tile)
# and pull the world behind it out of focus, so the discovery shows the compass
# the player will carry and not a readable ruin.
#
# Input is the PRE-reskin paintings — assets/art/story_compass*.webp as of
# commit fb8bd6c (git show fb8bd6c:assets/art/story_compass.webp > …) — not the
# shipped ones, which already carry the reskin. The device geometry below is
# measured on those paintings.
#
# Usage: python3 tools/art/reskin_story_compass.py <dir with originals> <outdir>
# then save each <outdir>/<name>.png as assets/art/<name>.webp at quality 85.
import sys
import numpy as np
from PIL import Image, ImageFilter

REPO, OUT = sys.argv[1], sys.argv[2]
FRAMES = {
    'story_compass': dict(c=(341.9, 414.9), ang=57.3, lng=(-217, 194), sht=(-114, 112),
                          dial=((355, 400), 91), btns=[((218, 310), 38), ((480, 500), 39)]),
    'story_compass_frame2': dict(c=(402.6, 362.0), ang=66.0, lng=(-215, 194), sht=(-112, 118),
                                 dial=((402, 356), 90), btns=[((282, 252), 38), ((518, 466), 39)]),
}
tile = np.asarray(Image.open(__import__('os').path.join(__import__('os').path.dirname(__file__), '..', '..', 'assets/ui/compass/reference-carving-tile.webp')).convert('L')).astype(float) / 255
TH, TW = tile.shape

def sample(u, v):
    # mirrored tiling, bilinear-free (pixel art wants hard samples)
    x = np.abs(np.mod(u, 2 * TW) - TW).astype(int).clip(0, TW - 1)
    y = np.abs(np.mod(v, 2 * TH) - TH).astype(int).clip(0, TH - 1)
    return tile[y, x]

def smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)

for name, P in FRAMES.items():
    src = Image.open(f'{REPO}/{name}.webp').convert('RGB')
    img = np.asarray(src).astype(float)
    H, W, _ = img.shape
    yy, xx = np.mgrid[0:H, 0:W].astype(float)
    a = np.radians(P['ang'])
    ax = np.array([np.cos(a), np.sin(a)]); pr = np.array([-ax[1], ax[0]])
    dx, dy = xx - P['c'][0], yy - P['c'][1]
    la = dx * ax[0] + dy * ax[1]          # along the long side
    lp = dx * pr[0] + dy * pr[1]          # across
    lmid = (P['lng'][0] + P['lng'][1]) / 2; hl = (P['lng'][1] - P['lng'][0]) / 2
    pmid = (P['sht'][0] + P['sht'][1]) / 2; hp = (P['sht'][1] - P['sht'][0]) / 2
    qa, qp = la - lmid, lp - pmid
    R = 30.0
    ox = np.maximum(np.abs(qa) - (hl - R), 0); oy = np.maximum(np.abs(qp) - (hp - R), 0)
    sd = np.hypot(ox, oy) - R + np.minimum(np.maximum(np.abs(qa) - (hl - R), np.abs(qp) - (hp - R)), 0)  # rounded-rect SDF
    inside = np.clip(0.5 - sd, 0, 1)

    hsv = np.asarray(src.convert('HSV')).astype(int)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    hand = (h >= 3) & (h <= 32) & (s > 95) & (v < 165)
    hand = np.asarray(Image.fromarray((hand * 255).astype('uint8')).filter(ImageFilter.MinFilter(9)).filter(ImageFilter.MaxFilter(13))) > 0

    keep = np.zeros((H, W), bool)
    rings = []
    (dcx, dcy), dr = P['dial']
    dd = np.hypot(xx - dcx, yy - dcy)
    keep |= dd < dr; rings.append((dd, dr))
    for (bx, by), br in P['btns']:
        bd = np.hypot(xx - bx, yy - by)
        keep |= bd < br; rings.append((bd, br))

    # ── living silver: dragonscale carving, rippled like a liquid surface ──
    u = qa * 2.6 + 7 * np.sin(qp / 17 + 0.7) + 5 * np.sin(qa / 23)
    w = qp * 2.6 + 7 * np.sin(qa / 21 + 1.9)
    L = sample(u, w)
    L = (L - L.mean()) / (L.std() + 1e-6)
    base = 0.55 + 0.33 * np.tanh(L * 1.1)
    # flowing sheen: two soft bands that wander across the plate
    t1 = (qa * 0.55 + qp * 0.85 + 26 * np.sin(qa / 48)) / 34
    t2 = (qa * 0.45 - qp * 0.9 - 120 + 20 * np.sin(qp / 40)) / 22
    sheen = 0.42 * np.exp(-t1 ** 2) + 0.22 * np.exp(-t2 ** 2)
    # liquid chrome: banded reflections that flow over the scales
    field = qa / 62 + 0.9 * np.sin(qp / 41 + qa / 95) + 0.4 * np.sin(qa / 29 - qp / 57)
    sheen = sheen + 0.38 * (0.5 + 0.5 * np.cos(field * 2.3)) ** 4 - 0.12
    # bevel: lit along the upper-left rim, shaded along the lower-right
    edge = smooth((8 - (-sd)) / 8)
    bevel = edge * (0.28 * np.sign(-(qa + qp) / (hl + hp) + 0.0001) * -1)
    # keep the painting's own light on the object (warm key from the right)
    lum = np.asarray(src.convert('L').filter(ImageFilter.GaussianBlur(28))).astype(float) / 255
    light = 0.75 + 0.5 * (lum - lum[inside > 0.5].mean())
    shade = np.clip((base + sheen + bevel) * light, 0, 1.4)
    silver = np.array([196, 202, 199]) / 255
    warm = np.array([255, 214, 150]) / 255
    col = shade[..., None] * silver * 255
    col = col * 0.86 + (shade[..., None] ** 2) * warm * 255 * 0.14 * 1.2
    # ring the dial and buttons in polished silver, as the HUD seats its glass
    for d, r in rings:
        band = (d >= r) & (d < r + 7)
        col[band] = np.clip(col[band] * 1.25 + 30, 0, 255)
        line = (d >= r + 7) & (d < r + 9)
        col[line] *= 0.45
    # pixel-art clusters: 3px blocks, matching the painting's grain
    blk = 3
    small = Image.fromarray(np.clip(col, 0, 255).astype('uint8')).resize((W // blk, H // blk), Image.BOX)
    col = np.asarray(small.resize((W // blk * blk, H // blk * blk), Image.NEAREST)).astype(float)
    col = np.pad(col, ((0, H - col.shape[0]), (0, W - col.shape[1]), (0, 0)), mode='edge')

    # only where the painting drew the device: its metal is low-saturation
    # against the orange ground; close the engraving gaps, then trust it
    dev = (s < 115) | ((v > 170) & (s < 150))
    dev = np.asarray(Image.fromarray((dev * 255).astype('uint8')).filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.MinFilter(9)).filter(ImageFilter.MaxFilter(3))) > 0
    m = inside * dev * (~keep) * (~hand)
    m = m[..., None]
    out = img * (1 - m) + col * m

    # ── out of focus: the world past the compass is a blur, not a place ──
    dist = np.maximum(sd, 0)
    f = 1 - smooth((dist - 4) / 85)
    bg = np.asarray(Image.fromarray(out.astype('uint8')).filter(ImageFilter.GaussianBlur(16))).astype(float)
    grey = bg.mean(2, keepdims=True)
    bg = bg * 0.3 + grey * 0.7
    bg = bg * 0.55 + np.array([26, 30, 36]) * 0.45
    near = out * (0.78 + 0.22 * f[..., None])
    out = near * f[..., None] + bg * (1 - f[..., None])
    # vignette
    vy = (yy / H - 0.42) / 0.75; vx = (xx / W - 0.5) / 0.8
    out *= (1 - 0.55 * smooth(np.hypot(vx, vy)))[..., None]
    Image.fromarray(np.clip(out, 0, 255).astype('uint8')).save(f'{OUT}/{name}.png')
    print('wrote', name)
