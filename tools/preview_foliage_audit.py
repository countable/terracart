#!/usr/bin/env python3
"""Build a self-contained comparison of shipping foliage and rock appearances."""
import argparse
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    data = json.loads(subprocess.check_output(['node', str(ROOT/'tools/export_foliage_audit.js')], cwd=ROOT))
    template = (ROOT/'tools/foliage_audit.html').read_text()
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output/'index.html').write_text(template.replace('__AUDIT_DATA__', json.dumps(data).replace('</', '<\\/')))
    # Machine-readable inventory is useful when checking that a context was included.
    inventory = {**data, 'assets': {k:{a:b for a,b in v.items() if a != 'src'} for k,v in data['assets'].items()}}
    (args.output/'audit.json').write_text(json.dumps(inventory, indent=2)+'\n')
    print(f"Rendered {len(data['samples'])} appearances from {len(data['assets'])} shipping sheets: {args.output/'index.html'}")

if __name__ == '__main__':
    main()
