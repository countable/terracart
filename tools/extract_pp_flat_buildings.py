"""Export native Pixel Plains shop shells and their matching modular glass door."""
from pathlib import Path
import hashlib
import json
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'extra_assets/Pixel Plains/PP Interiors Pack/Exterior set.png'
OUT = ROOT / 'assets/Objects/AuthoredBuildings'
COLORS = ('red', 'brown', 'orange', 'blue', 'green', 'pink')


def main():
    sheet = Image.open(SOURCE).convert('RGBA')
    door_rect = (738, 164, 766, 192)
    door = sheet.crop(door_rect)
    records = []
    for row, color in enumerate(COLORS):
        rect = (592, 32 + row * 112, 688, 112 + row * 112)
        shell = sheet.crop(rect)
        # Native modular assembly: no scaling, recoloring or silhouette change.
        shell.alpha_composite(door, (34, 52))
        name = f'pp-flat-{color}.png'
        shell.save(OUT / name)
        records.append({'key': f'pp_flat_{color}', 'file': name,
                        'shellRect': list(rect), 'doorRect': list(door_rect),
                        'doorDestination': [34, 52],
                        'sha256': hashlib.sha256((OUT / name).read_bytes()).hexdigest()})
    manifest = {'source': str(SOURCE.relative_to(ROOT)),
                'sourceSha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
                'operation': 'Native crops and alpha-composited modular door; no repaint or resampling.',
                'variants': records}
    (OUT / 'pp-flat-provenance.json').write_text(json.dumps(manifest, indent=2) + '\n')


if __name__ == '__main__':
    main()
