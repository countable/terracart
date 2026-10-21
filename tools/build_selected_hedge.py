"""Extract the selected Fantasy Dreamland dome into the game's 24px prop cell."""
from pathlib import Path
import hashlib
import json
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path('extra_assets/16x16/Fantasy Dreamland World/Fantasy Dreamland/Tilesets/FD_Forest.png')
OUT = ROOT / 'assets/Objects/SelectedFlora/selected_clipped_hedge.png'
CROP = (128, 96, 32, 24)


def main():
    x, y, w, h = CROP
    crown = Image.open(ROOT / SOURCE).convert('RGBA').crop((x, y, x + w, y + h))
    crown = crown.resize((24, 18), Image.Resampling.NEAREST)
    cell = Image.new('RGBA', (24, 24))
    cell.paste(crown, (0, 6))
    cell.save(OUT)
    OUT.with_suffix('.source.json').write_text(json.dumps({
        'source': str(SOURCE), 'sha256': hashlib.sha256((ROOT / SOURCE).read_bytes()).hexdigest(),
        'crop': CROP, 'resize': [24, 18], 'resampling': 'nearest', 'offset': [0, 6],
        'note': 'Smooth crown above the trunk, used as a ground-level clipped dome.'
    }, indent=2) + '\n')


if __name__ == '__main__':
    main()
