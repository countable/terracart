"""Material transforms are independent of source pack availability."""
import sys
import json
import unittest
from pathlib import Path
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from build_fdr_castle_assets import treatment, baked_top_light


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

    def test_baked_light_keeps_alpha_and_softens_the_full_wall_height(self):
        stone = Image.new('RGBA', (2, 64), (240, 200, 160, 137))
        lit = baked_top_light(stone)
        self.assertEqual(lit.getchannel('A').getextrema(), (137, 137))
        self.assertEqual(lit.getpixel((0, 63)), (144, 120, 96, 137))
        self.assertEqual(lit.getpixel((0, 0)), (240, 200, 160, 137))
        values = [lit.getpixel((0, y))[0] for y in range(64)]
        self.assertTrue(all(a >= b for a, b in zip(values, values[1:])))
        self.assertGreater(len(set(values[-24:])), 18, 'lighting is a ramp, not a top/side colour step')

    def test_exported_masonry_bakes_light_at_runtime_heights_and_repeats_exactly(self):
        folder = Path(__file__).resolve().parents[1] / 'assets/Objects/Castle/FDR'
        atlas = Image.open(folder / 'atlas.png')
        materials = {m['slot']: m for m in json.loads((folder / 'sources.json').read_text())['materials']}
        for slot in [3, 9, 10, 4, 11, 12, 13, 14]:
            with self.subTest(slot=slot):
                x, y = slot % 4 * 128, slot // 4 * 128
                content = atlas.crop((x + 8, y + 8, x + 120, y + 120))
                self.assertEqual(content.getchannel('A').getextrema(), (255, 255))
                self.assertEqual(content.crop((0, 0, 48, 112)).tobytes(),
                                 content.crop((64, 0, 112, 112)).tobytes(),
                                 'the 128-world-unit motif repeats in exactly 64 atlas texels')
                # UV samples use z=0..64 with v=1-z/64. Average short
                # height bands so individual mortar courses cannot dominate.
                def brightness(z):
                    cy = min(111, round((1 - z / 64) * 112))
                    pixels = list(content.crop((0, max(0, cy-2), 112, min(112, cy+3))).getdata())
                    return sum(sum(p[:3]) / 3 for p in pixels) / len(pixels)
                foot, middle, top = [brightness(z) for z in [0, 12, 24]]
                self.assertGreater(middle, foot + 10)
                self.assertGreater(top, middle + 5)
                self.assertEqual(materials[slot]['gutterY'], 'clamp')
                self.assertEqual(atlas.crop((x+8,y+119,x+120,y+120)).tobytes(),
                                 atlas.crop((x+8,y+120,x+120,y+121)).tobytes(),
                                 'the ground sample must not wrap into bright upper stone')

    def test_archive_tower_tiles_are_opaque_for_canvas_seam_coverage(self):
        atlas = Image.open(Path(__file__).resolve().parents[1] / 'assets/Objects/Castle/FDR/atlas.png')
        for slot in [11, 12]:
            x, y = slot % 4 * 128, slot // 4 * 128
            self.assertEqual(atlas.crop((x, y, x + 128, y + 128)).getchannel('A').getextrema(),
                             (255, 255))

    def test_coping_patch_does_not_touch_banner_or_white_patch(self):
        atlas = Image.open(Path(__file__).resolve().parents[1] / 'assets/Objects/Castle/FDR/atlas.png')
        self.assertEqual(atlas.crop((392, 486, 412, 502)).getchannel('A').getextrema(), (255, 255))
        self.assertEqual(atlas.crop((416, 486, 436, 502)).getchannel('A').getextrema(), (255, 255))
        self.assertEqual(atlas.getpixel((448, 480))[3], 0, 'the forked banner hem stays transparent')
        self.assertEqual(atlas.crop((496, 496, 504, 504)).getextrema(), ((255,255),)*4)

    def test_keep_facades_keep_clear_gaps_between_banners_and_door(self):
        folder=Path(__file__).resolve().parents[1] / 'assets/Objects/Castle/FDR'
        atlas=Image.open(folder/'atlas.png')
        material=next(row for row in json.loads((folder/'sources.json').read_text())['materials'] if row['slot']==2)
        self.assertEqual(len(material['frames']),4)
        for record in material['frames']:
            x,y,w,h=record['rect'];frame=atlas.crop((x,y,x+w,y+h))
            self.assertTrue(set(frame.getchannel('A').getdata()).issubset({0,255}))
            self.assertEqual(frame.getpixel((24,46))[3],255,'the central entrance retains opaque backing')
            for p in [(13,20),(35,20),(24,2)]:
                self.assertEqual(frame.getpixel(p)[3],0,'banner art cannot cover the entrance or bridge its flanks')
            for p in [(5,13),(43,13)]:
                self.assertEqual(frame.getpixel(p)[3],255,'both flanking banners are present')


if __name__ == '__main__':
    unittest.main()
