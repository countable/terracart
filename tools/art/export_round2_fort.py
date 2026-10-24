#!/usr/bin/env python3
"""Export the approved inner fort at its reviewed 64-pixel source width.

Keep the canvas tight so the shared building renderer measures the building,
not transparent margins. The unclaimed variant uses the existing green wash
from textures.js; both variants retain identical geometry.
"""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools'))
from import_world_art_candidates import candidate_frame

SOURCE = ROOT / 'extra_assets/inactive/assets/Objects/Approved/Sources/FortGamingHall'


def main():
    fort = candidate_frame(SOURCE / 'fort.png', (64, 64), (0, 0, 64, 64))
    fort = fort.crop(fort.getbbox())
    unclaimed = fort.copy()
    wash, murk = (30, 59, 36), (5, 7, 12)
    unclaimed.putdata([
        tuple(int((value + (wash[k] - value) * .35) * .88 + murk[k] * .12 + .5)
              for k, value in enumerate(pixel[:3])) + (pixel[3],)
        for pixel in fort.getdata()
    ])
    for image, native, runtime in [
        (fort, 'fort-restored-native.png', 'house_fort.png'),
        (unclaimed, 'fort-unclaimed-native.png', 'house_fort_unclaimed.png'),
    ]:
        image.save(SOURCE / native)
        image.save(ROOT / 'assets/Objects/Approved' / runtime)


if __name__ == '__main__':
    main()
