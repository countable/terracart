"""Locations of source art kept outside the checkout."""
import os
from pathlib import Path

ART_ROOT = Path(os.environ.get('TERRACART_ART_ROOT', Path.home() / '.artifacts' / 'terracart-art')).expanduser()
RESERVE_ROOT = ART_ROOT / 'unused_art'
