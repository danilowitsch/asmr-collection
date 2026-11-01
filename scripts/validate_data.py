#!/usr/bin/env python3
"""
Validate asmr_data.json structure and consistency.

Stdlib only, so it can run in CI without installing dependencies.

Checks:
- file exists and is valid JSON
- top level is an object with a "videos" list
- every video has non-empty string "id", "url" and "title"
- ids and urls are unique
- urls are http(s) URLs

Suspicious URLs (e.g. leftover embedly widget wrappers) are reported as
warnings but do not fail the build.

Usage:
    python3 scripts/validate_data.py [path/to/asmr_data.json]

Exit code: 0 if valid, 1 if any errors were found.
"""

import json
import re
import sys
from urllib.parse import urlparse

DEFAULT_PATH = 'asmr_data.json'
REQUIRED_FIELDS = ('id', 'url', 'title')

# URL patterns that indicate a bad extraction rather than a playable video
SUSPICIOUS_URL_PATTERNS = [
    (r'embedly\.com', 'embedly widget wrapper instead of a direct video URL'),
    (r'^https?://[^/]*//', 'double-slash in host (mangled relative URL)'),
    (r'\.m3u8($|\?)', 'playlist URL, not a page'),
]


def validate(path):
    errors = []
    warnings = []

    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except FileNotFoundError:
        return [f'{path}: file not found'], []
    except json.JSONDecodeError as e:
        return [f'{path}: invalid JSON: {e}'], []

    if not isinstance(data, dict):
        return [f'{path}: top level must be a JSON object'], []

    videos = data.get('videos')
    if not isinstance(videos, list):
        return [f'{path}: "videos" must be a list'], []

    seen_ids = {}
    seen_urls = {}

    for i, video in enumerate(videos):
        where = f'videos[{i}]'
        if not isinstance(video, dict):
            errors.append(f'{where}: entry must be an object')
            continue

        for field in REQUIRED_FIELDS:
            value = video.get(field)
            if not isinstance(value, str) or not value.strip():
                errors.append(f'{where}: missing or empty "{field}"')

        vid = video.get('id')
        if isinstance(vid, str) and vid.strip():
            if vid in seen_ids:
                errors.append(f'{where}: duplicate id "{vid}" (also at videos[{seen_ids[vid]}])')
            else:
                seen_ids[vid] = i

        url = video.get('url')
        if isinstance(url, str) and url.strip():
            parsed = urlparse(url)
            if parsed.scheme not in ('http', 'https') or not parsed.netloc:
                errors.append(f'{where}: url is not a valid http(s) URL: {url!r}')
            if url in seen_urls:
                errors.append(f'{where}: duplicate url "{url}" (also at videos[{seen_urls[url]}])')
            else:
                seen_urls[url] = i
            for pattern, reason in SUSPICIOUS_URL_PATTERNS:
                if re.search(pattern, url):
                    warnings.append(f'{where} ({video.get("title", "?")!r}): suspicious url {url!r} - {reason}')

    return errors, warnings


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_PATH
    errors, warnings = validate(path)

    for w in warnings:
        print(f'WARNING: {w}')
    for e in errors:
        print(f'ERROR: {e}')

    if errors:
        print(f'\n{path}: FAILED - {len(errors)} error(s), {len(warnings)} warning(s)')
        return 1
    print(f'{path}: OK - valid, {len(warnings)} warning(s)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
