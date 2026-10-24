#!/usr/bin/env python3
"""Connect the local artifact server to the repository's official design tools.

Run against the existing shared server, then recreate its Docker Compose service.
Existing configuration is backed up before changes. Historical artifacts stay
on disk; old road-review URLs redirect to current repository tools.
"""
import argparse
from pathlib import Path


def install(config, root):
    server = config / 'server.py'
    compose = config / 'compose.yaml'
    code = server.read_text()
    old = """        # Keep the shared map-review entry point on the tested public snapshot.
        if path in ('/tools/map-review.html', '/tools/map-distribution.html', '/tools/chest-report.html'):
            target = '/road-review' + path
"""
    new = """        # Official review tools follow the checkout; preserve old bookmarks.
        if path.startswith('/road-review/'):
            target = path[len('/road-review'):]
"""
    if old in code:
        code = code.replace(old, new)
    elif new not in code:
        raise RuntimeError('Unrecognized artifact server routing; inspect before changing it.')
    yaml = compose.read_text()
    mount = f'      - {root}/design:/artifacts/design:ro'
    if mount not in yaml:
        anchor = f'      - {root}/tools:/artifacts/tools:ro'
        if anchor not in yaml:
            raise RuntimeError('Artifact server must already mount this checkout tools directory.')
        yaml = yaml.replace(anchor, anchor + '\n' + mount)
    if (root / 'extra_assets').is_dir():
        # Docker cannot create nested mountpoints inside the read-only parent.
        (Path.home() / '.artifacts/extra_assets').mkdir(parents=True, exist_ok=True)
        extra_mount = f'      - {root}/extra_assets:/artifacts/extra_assets:ro'
        if extra_mount not in yaml:
            yaml = yaml.replace(mount, mount + '\n' + extra_mount)
    for path, content in [(server, code), (compose, yaml)]:
        if path.read_text() != content:
            backup = path.with_suffix(path.suffix + '.before-repo-design')
            if not backup.exists():
                backup.write_bytes(path.read_bytes())
            path.write_text(content)
    print('Repository design routing installed. Recreate the artifact server to apply mounts.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, default=Path.home() / '.config/artifact-server')
    args = parser.parse_args()
    install(args.config, Path(__file__).resolve().parents[1])
