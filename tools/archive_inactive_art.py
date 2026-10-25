#!/usr/bin/env python3
"""Archive an explicitly reviewed art plan, preserving paths and SHA-256 evidence.

Dry-run by default. Plans are JSON lists of paths (or {"paths": [...]}); inventory
JSON with a candidates array is also accepted. --rewrite updates exact paths in
repository text files, including wholly moved directory literals. Composed
paths still require review before --apply.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = Path('extra_assets/inactive')
ARCHIVABLE_ROOTS = {'assets', 'tools', 'test'}
TEXT = {'.js', '.cjs', '.mjs', '.py', '.json', '.md', '.txt', '.html', '.css', '.svg', '.yaml', '.yml'}
SKIP_DIRS = {'.git', 'node_modules', 'extra_assets', '.claude', '.codex', '.agents', '.artifacts', 'tiles_cache'}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_paths(plan):
    value = json.loads(plan.read_text())
    if isinstance(value, dict):
        value = value.get('paths', value.get('candidates'))
    if not isinstance(value, list):
        raise ValueError('Plan must contain a list of paths or candidates')
    return sorted(set(row['path'] if isinstance(row, dict) else row for row in value))


def repo_texts():
    for directory, dirs, files in os.walk(ROOT):
        dirs[:] = [name for name in dirs if name not in SKIP_DIRS]
        for name in files:
            path = Path(directory) / name
            if path.suffix.lower() in TEXT and path.name != 'sw.js' and not path.is_symlink():
                yield path


def archive(plan, manifest, runtime_inventory=None, rewrite=False, apply=False):
    paths = read_paths(plan)
    runtime = set()
    if runtime_inventory:
        inventory = json.loads(runtime_inventory.read_text())
        runtime = {row['path'] for row in inventory.get('references', inventory.get('used', []))}
    # Explicit tooling/test plans may retire a standalone study, but never a
    # module referenced directly by a live entry point or the headless harness.
    entrypoints = [(ROOT / name).read_text() for name in ['index.html', 'test/node/run.js']]
    entries, mapping = [], {}
    for relative in paths:
        source = Path(relative)
        if source.is_absolute() or '..' in source.parts or not source.parts or source.parts[0] not in ARCHIVABLE_ROOTS:
            raise ValueError(f'Expected a file beneath assets/, tools/ or test/: {relative}')
        actual = ROOT / source
        if any(parent.is_symlink() for parent in actual.parents if parent != ROOT.parent):
            raise ValueError(f'Symlinked source ancestry: {relative}')
        if not actual.is_file() or actual.is_symlink():
            raise ValueError(f'Not a regular source file: {relative}')
        if relative in runtime:
            raise ValueError(f'Runtime reference cannot be archived: {relative}')
        if source.parts[0] != 'assets' and any(relative in text for text in entrypoints):
            raise ValueError(f'Entry point still references an archive candidate: {relative}')
        destination = ROOT / ARCHIVE / source
        if any(parent.is_symlink() for parent in destination.parents if parent != ROOT.parent):
            raise ValueError(f'Symlinked archive ancestry: {relative}')
        checksum = digest(actual)
        if destination.exists() and (not destination.is_file() or digest(destination) != checksum):
            raise ValueError(f'Archive collision: {destination.relative_to(ROOT)}')
        target = (ARCHIVE / source).as_posix()
        mapping[relative] = target
        entries.append({'path': relative, 'archive': target, 'bytes': actual.stat().st_size, 'sha256': checksum})
    # Directory literals are valid only if every descendant moves, including
    # provenance files. This catches composed builder paths without redirecting
    # a mixed runtime/source directory into the archive.
    plan_set = set(paths)
    directories = {parent for name in paths for parent in Path(name).parents
                   if parent != Path('.') and parent.as_posix() not in ARCHIVABLE_ROOTS}
    for directory in sorted(directories, key=lambda item: len(item.parts), reverse=True):
        descendants = list((ROOT / directory).rglob('*'))
        if any(item.is_symlink() for item in descendants):
            continue
        files = {item.relative_to(ROOT).as_posix() for item in descendants if item.is_file()}
        if files and files <= plan_set:
            mapping[directory.as_posix()] = (ARCHIVE / directory).as_posix()
    # Avoid matching assets/... inside an already archived path. All source
    # changes are prepared before mutations; runtime paths may never be rewritten.
    replacements = []
    # A relative prefix (`../assets/...` from css/) is still a reference.
    pattern = re.compile(r'(?:(?<=\.\./)|(?<![A-Za-z0-9_./-]))(?:' +
                         '|'.join(re.escape(name) for name in sorted(mapping, key=len, reverse=True)) +
                         r')(?![A-Za-z0-9_.-])') if mapping else None
    if pattern:
        excluded = {plan.resolve(), manifest.resolve()}
        for file in repo_texts():
            if file.resolve() in excluded:
                continue
            try:
                before = file.read_text()
            except UnicodeDecodeError:
                continue
            after = pattern.sub(lambda match: mapping[match.group()], before)
            if before != after:
                relative = file.relative_to(ROOT)
                if relative.parts[0] in {'src', 'css'} or relative.as_posix() == 'index.html':
                    raise ValueError(f'Runtime text still references an archive candidate: {relative}')
                if rewrite:
                    target = ROOT / ARCHIVE / relative if relative.as_posix() in plan_set else file
                    replacements.append((target, after))
    report = {'files': len(entries), 'bytes': sum(row['bytes'] for row in entries),
              'rewritten': [file.relative_to(ROOT).as_posix() for file, _ in replacements],
              'manifest': str(manifest), 'applied': apply, 'entries': entries}
    if not apply:
        return report
    previous = json.loads(manifest.read_text()) if manifest.exists() else {'version': 1, 'entries': []}
    prior = {row['path']: row for row in previous['entries']}
    for entry in entries:
        if entry['path'] in prior and prior[entry['path']] != entry:
            raise ValueError(f'Existing manifest record differs: {entry["path"]}')
    for entry in entries:
        source, target = ROOT / entry['path'], ROOT / entry['archive']
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            source.unlink()  # Identical archive content was verified above.
        else:
            source.rename(target)
        if digest(target) != entry['sha256']:
            raise ValueError(f'Post-move checksum failed: {target}')
        prior[entry['path']] = entry
    for file, content in replacements:
        file.write_text(content)
    # Text provenance may itself contain input paths. Preserve the original hash
    # and record the updated archive hash after those paths have been rewritten.
    for entry in entries:
        archived_hash = digest(ROOT / entry['archive'])
        if archived_hash != entry['sha256']:
            entry['archivedSha256'] = archived_hash
            prior[entry['path']] = entry
    previous['entries'] = [prior[key] for key in sorted(prior)]
    manifest.parent.mkdir(parents=True, exist_ok=True)
    manifest.write_text(json.dumps(previous, indent=2) + '\n')
    # Remove only directories made empty by the reviewed moves.
    for entry in entries:
        parent = (ROOT / entry['path']).parent
        while parent != ROOT / Path(entry['path']).parts[0]:
            try:
                parent.rmdir()
            except OSError:
                break
            parent = parent.parent
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('plan', type=Path)
    parser.add_argument('--manifest', type=Path, default=ROOT / 'docs/art/inactive-art-manifest.json')
    parser.add_argument('--runtime-inventory', type=Path, help='Reject any plan path listed in inventory.references')
    parser.add_argument('--rewrite', action='store_true', help='Update exact literal paths in repository text')
    parser.add_argument('--apply', action='store_true', help='Move the reviewed files and write the manifest')
    parser.add_argument('--json', action='store_true', help='Print full dry-run evidence')
    args = parser.parse_args()
    report = archive(args.plan, args.manifest, args.runtime_inventory, args.rewrite, args.apply)
    print(json.dumps(report if args.json else {key: value for key, value in report.items() if key != 'entries'}, indent=2))


if __name__ == '__main__':
    main()
