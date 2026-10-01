"""Seat the neighbour role art in the game's 48px NPC cells and bake the
citizen-palette recolour (tools/npc-recolour.js) into it.

Usage: python3 tools/art/import_npc_art.py [/path/to/unused_art]

Sources are the licensed packs kept outside the repo (unused_art/). Each row
of SHEETS is one role's look; the output is assets/NPC/<slug>_idle.png and
<slug>_walk.png, four 48px columns by four rows (front, back, left, right),
the layout SpriteLayout.NPC_SHEETS reads with `cols: 4`. Feet land on y=32
of each cell, where the citizens stand. The recolour runs the same script
the review page used, in headless Chromium, over idle and walk together so
both sheets share one transform. Needs Pillow and Playwright.
"""
from pathlib import Path
import base64, io, json, sys
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'unused_art'
OUT = ROOT / 'assets/NPC'
PS = 'RPG Top Down Character Asset Pack - FULL/RPG Top Down Characters - Full version'
SRW = 'SuperRetroWorld_CharacterPack_Full/sprite'
SRW_FILES = ['character_1-8', 'character_9-16', 'character_17-24', 'character_25-32']
FOXI_FEM = {'Lena', 'Rachel', 'Roxana', 'Flora', 'Elena'}

# slug: (pack, source). One sheet per role; a label used in several zones
# (Peddler, Lamplighter) is one role and one sheet.
SHEETS = {
    'wayfinder': ('ps', 'Blue Haired Woman'),
    'peddler': ('ps', 'Blonde Man'),
    'barterer': ('ps', 'Blonde Woman'),
    'storykeeper': ('srw', 4),
    'mason': ('ps', 'Viking Man'),
    'lamplighter': ('srw', 19),
    'fieldwalker': ('ps', 'Farmer'),
    'seed_seller': ('srw', 22),
    'harvest_trader': ('srw', 6),
    'barn_raiser': ('srw', 9),
    'market_trader': ('srw', 14),
    'town_guide': ('srw', 17),
    'stonemason': ('srw', 23),
    'ranger': ('ps', 'Viking Woman'),
    'forager': ('srw', 7),
    'lorekeeper': ('srw', 18),
    'shrine_warden': ('ps', 'Knight'),
    'shrine_lorekeeper': ('srw', 11),
    'shrine_trader': ('srw', 16),
    'shrine_keeper': ('srw', 26),
    'fox_tracker': ('foxi', 'Lucas'),
    'fox_storyteller': ('foxi', 'Flora'),
    'fox_trader': ('foxi', 'Marcos'),
    'den_keeper': ('foxi', 'Elena'),
}


def cells(pack, source):
    """Return (idle, walk): each a list of 4 rows (front, back, left, right)
    of 4 frames, plus the paste offset that puts the feet on y=32."""
    if pack == 'ps':
        im = Image.open(SRC / PS / source / (source.lower().replace(' ', '_') + '.png')).convert('RGBA')
        assert im.size == (128, 256), im.size
        frame = lambda r, c: im.crop((c * 32, r * 32, c * 32 + 32, r * 32 + 32))
        # Rows: idle front/left/right/back, then walking in the same order.
        idle = [[frame(r, c) for c in range(4)] for r in (0, 3, 1, 2)]
        walk = [[frame(r + 4, c) for c in range(4)] for r in (0, 3, 1, 2)]
        return idle, walk, (8, 1)        # feet end at y=31
    if pack == 'srw':
        k = (source - 1) % 8
        im = Image.open(SRC / SRW / (SRW_FILES[(source - 1) // 8] + '.png')).convert('RGBA')
        ox, oy = (k % 4) * 48, (k // 4) * 80
        frame = lambda r, c: im.crop((ox + c * 16, oy + r * 20, ox + c * 16 + 16, oy + r * 20 + 20))
        # Rows: front, left, right, back; column 1 stands, 0 and 2 step.
        idle = [[frame(r, 1)] * 4 for r in (0, 3, 1, 2)]
        walk = [[frame(r, c) for c in (0, 1, 2, 1)] for r in (0, 3, 1, 2)]
        return idle, walk, (16, 12)      # feet end at y=20
    if pack == 'foxi':
        folder = 'Fem_Characters' if source in FOXI_FEM else 'Masc_Characters'
        im = Image.open(SRC / 'Foxi_Characters' / folder / f'{source}.png').convert('RGBA')
        frame = lambda r, c: im.crop((c * 16, r * 16, c * 16 + 16, r * 16 + 16))
        # Rows: front, back, left, right; a walk only, so idle holds frame 0.
        idle = [[frame(r, 0)] * 4 for r in range(4)]
        walk = [[frame(r, c) for c in range(4)] for r in range(4)]
        return idle, walk, (16, 16)      # feet end at y=16
    raise ValueError(pack)


def seat(rows, offset):
    sheet = Image.new('RGBA', (192, 192))
    for r, frames in enumerate(rows):
        for c, f in enumerate(frames):
            sheet.paste(f, (c * 48 + offset[0], r * 48 + offset[1]))
    return sheet


def data_url(im):
    buf = io.BytesIO(); im.save(buf, 'PNG')
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()


def main():
    from playwright.sync_api import sync_playwright
    citizens = [data_url(Image.open(OUT / f'Citizen_woman0{i}_idle.png').convert('RGBA')) for i in (1, 2, 3)]
    jobs = {}
    for slug, (pack, source) in SHEETS.items():
        idle, walk, offset = cells(pack, source)
        both = Image.new('RGBA', (192, 384))
        both.paste(seat(idle, offset), (0, 0)); both.paste(seat(walk, offset), (0, 192))
        jobs[slug] = data_url(both)
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path='/usr/bin/chromium')
        page = browser.new_page()
        page.set_content('<!doctype html><body></body>')
        page.add_script_tag(path=str(ROOT / 'tools/art_preview_colour.js'))
        page.add_script_tag(path=str(ROOT / 'tools/npc-recolour.js'))
        baked = page.evaluate("""async ([citizens, jobs]) => {
          const img = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = src; });
          const ref = NpcRecolour.reference(await Promise.all(citizens.map(img)));
          const out = {};
          for (const [slug, src] of Object.entries(jobs)) {
            const i = await img(src), c = document.createElement('canvas');
            c.width = i.width; c.height = i.height; c.getContext('2d').drawImage(i, 0, 0);
            NpcRecolour.apply(c, ref);
            out[slug] = c.toDataURL('image/png');
          }
          return out;
        }""", [citizens, jobs])
        browser.close()
    for slug, url in baked.items():
        both = Image.open(io.BytesIO(base64.b64decode(url.split(',', 1)[1]))).convert('RGBA')
        both.crop((0, 0, 192, 192)).save(OUT / f'{slug}_idle.png', optimize=True)
        both.crop((0, 192, 192, 384)).save(OUT / f'{slug}_walk.png', optimize=True)
    print(json.dumps(sorted(baked)))


if __name__ == '__main__':
    main()
