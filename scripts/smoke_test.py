#!/usr/bin/env python3
"""
Smoke test for server.py using Flask's test client (no network, no browser).

Exercises the local endpoints only:
- GET /                  -> serves index.html
- GET /api/ping          -> status ok
- GET /api/load          -> returns the videos from asmr_data.json (read-only)
- GET /api/export        -> returns the data file
- static files           -> /scripts/app.js, /styles/style.css
- missing ?url= param    -> /thumb, /proxy, /raw-proxy, /api/patreon-post-iframe return 400
- POST /api/save round-trip against a temporary DATA_FILE (never touches the real data)

Usage:
    python3 scripts/smoke_test.py

Exit code: 0 if all checks pass, 1 otherwise.
"""

import json
import os
import sys
import tempfile

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO_ROOT)
os.chdir(REPO_ROOT)

import server  # noqa: E402  (import after path setup; app.run is under __main__ guard)

failures = []


def check(name, condition, extra=''):
    status = 'PASS' if condition else 'FAIL'
    print(f'{status}: {name}' + (f' ({extra})' if extra and not condition else ''))
    if not condition:
        failures.append(name)


def main():
    client = server.app.test_client()

    r = client.get('/')
    check('GET / returns 200', r.status_code == 200, f'got {r.status_code}')
    check('GET / serves index.html', b'ASMR' in r.data)

    r = client.get('/api/ping')
    check('GET /api/ping returns 200', r.status_code == 200, f'got {r.status_code}')
    check('GET /api/ping reports ok', r.get_json(silent=True) == {'status': 'ok', 'message': 'ASMR Video Collection API is running'} or (r.get_json(silent=True) or {}).get('status') == 'ok')

    r = client.get('/api/load')
    body = r.get_json(silent=True) or {}
    check('GET /api/load returns 200', r.status_code == 200, f'got {r.status_code}')
    check('GET /api/load returns a videos list', isinstance(body.get('videos'), list), f'keys: {list(body)[:5]}')

    r = client.get('/api/export')
    check('GET /api/export returns 200', r.status_code == 200, f'got {r.status_code}')

    for path in ('/scripts/app.js', '/styles/style.css'):
        r = client.get(path)
        check(f'GET {path} returns 200', r.status_code == 200, f'got {r.status_code}')

    for path in ('/thumb', '/proxy', '/raw-proxy', '/api/patreon-post-iframe'):
        r = client.get(path)
        check(f'GET {path} without url returns 400', r.status_code == 400, f'got {r.status_code}')

    # Save/load round trip against a temp file so the real data is never modified
    original_data_file = server.DATA_FILE
    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            server.DATA_FILE = os.path.join(tmpdir, 'test_data.json')
            payload = {'videos': [{'id': 'smoketest1', 'url': 'https://example.com/video', 'title': 'Smoke Test Video', 'tags': ['test']}]}
            r = client.post('/api/save', json=payload)
            check('POST /api/save returns 200', r.status_code == 200, f'got {r.status_code}')

            r = client.get('/api/load')
            body = r.get_json(silent=True) or {}
            saved = body.get('videos', [])
            check('GET /api/load returns saved data', len(saved) == 1 and saved[0].get('id') == 'smoketest1', json.dumps(body)[:200])
            check('save stamps _savedAt/_version', '_savedAt' in body and body.get('_version') == '1.0')

            r = client.post('/api/save', json={'nope': True})
            check('POST /api/save with invalid body returns 400', r.status_code == 400, f'got {r.status_code}')
    finally:
        server.DATA_FILE = original_data_file

    print()
    if failures:
        print(f'SMOKE TEST FAILED: {len(failures)} check(s) failed: {", ".join(failures)}')
        return 1
    print('SMOKE TEST PASSED: all checks ok')
    return 0


if __name__ == '__main__':
    sys.exit(main())
