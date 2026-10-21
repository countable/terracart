"""Regression checks for portraits painted outside their nominal source grid."""
import importlib.util
from pathlib import Path
import unittest

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    'build_dialog_item_art', ROOT / 'tools/build_dialog_item_art.py')
ART = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ART)


class DialogItemArtTest(unittest.TestCase):
    def test_shifted_paintings_keep_their_whole_object_and_no_neighbour(self):
        master = Image.new('RGB', (800, 800))
        draw = ImageDraw.Draw(master)
        colours = []
        for row in range(8):
            for column in range(8):
                # The bottom rows and right columns drift away from nominal cells.
                x = column * 100 + 15 - (20 if column >= 4 else 0)
                y = row * 100 + 15 - (25 if row >= 4 else 0)
                colour = (50 + row * 25, 50 + column * 25, 100)
                colours.append(colour)
                draw.rectangle((x, y, x + 55, y + 55), fill=colour)
        atlas = ART.export_master(master)
        for frame, colour in enumerate(colours):
            x, y = frame % 8 * ART.CELL, frame // 8 * ART.CELL
            tile = atlas.crop((x, y, x + ART.CELL, y + ART.CELL))
            self.assertEqual(tile.getpixel((48, 48)), colour)
            bounds = ART.ink_mask(tile).getbbox()
            self.assertEqual((bounds[2] - bounds[0], bounds[3] - bounds[1]), (56, 56))
            self.assertLessEqual(abs(bounds[0] + bounds[2] - ART.CELL), 2)
            self.assertLessEqual(abs(bounds[1] + bounds[3] - ART.CELL), 2)
            self.assertEqual(set(tile.getdata()), {(0, 0, 0), colour})

    def test_exported_portraits_have_clear_padding_and_are_centered(self):
        for path in sorted((ROOT / 'assets/Icons/DialogItems').glob('items-*.png')):
            with Image.open(path) as atlas:
                self.assertEqual(atlas.size, (768, 768))
                for frame in range(64):
                    x, y = frame % 8 * ART.CELL, frame // 8 * ART.CELL
                    bounds = ART.ink_mask(atlas.crop((x, y, x + 96, y + 96))).getbbox()
                    if bounds is None:
                        continue
                    with self.subTest(sheet=path.name, frame=frame):
                        self.assertGreaterEqual(min(bounds[:2]), ART.PADDING)
                        self.assertLessEqual(max(bounds[2:]), ART.CELL - ART.PADDING)
                        self.assertLessEqual(abs(bounds[0] + bounds[2] - ART.CELL), 3)
                        self.assertLessEqual(abs(bounds[1] + bounds[3] - ART.CELL), 3)


if __name__ == '__main__':
    unittest.main()
