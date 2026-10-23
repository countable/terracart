"""Material transforms are independent of source pack availability."""
import sys
import unittest
from pathlib import Path
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from build_fdr_castle_assets import treatment


class CastleMaterials(unittest.TestCase):
    def setUp(self):
        self.tile = Image.new('RGBA', (3, 1))
        self.tile.putdata([(40, 60, 80, 255), (200, 180, 160, 255), (9, 8, 7, 0)])

    def test_masonry_keeps_mean_colour_and_alpha_with_less_contrast(self):
        pixels = list(treatment(self.tile, 3)[0].getdata())
        for channel in range(3):
            self.assertEqual((pixels[0][channel] + pixels[1][channel]) / 2, 120)
            self.assertLess(abs(pixels[1][channel] - pixels[0][channel]),
                            abs(list(self.tile.getdata())[1][channel] - list(self.tile.getdata())[0][channel]))
        self.assertEqual([p[3] for p in pixels], [255, 255, 0])
        self.assertEqual(pixels[2], (9, 8, 7, 0))

    def test_sky_materials_are_lighter_than_the_same_stone_side(self):
        top = list(treatment(self.tile, 8)[0].getdata())
        side = list(treatment(self.tile, 9)[0].getdata())
        for a, b in zip(top[:2], side[:2]):
            self.assertTrue(all(a[i] > b[i] for i in range(3)))

    def test_decals_are_unchanged(self):
        self.assertEqual(treatment(self.tile, 5)[0].tobytes(), self.tile.tobytes())


if __name__ == '__main__':
    unittest.main()
