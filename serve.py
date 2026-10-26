#!/usr/bin/env python3
"""Run Signal Lab locally. Audio and payloads remain in the browser."""
import argparse
import functools
import http.server
from pathlib import Path
import threading
import webbrowser

parser = argparse.ArgumentParser(description='Start the Signal Lab audio workbench.')
parser.add_argument('--port', type=int, default=5194)
parser.add_argument('--no-browser', action='store_true')
args = parser.parse_args()
root = Path(__file__).resolve().parent / 'dist'
handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(root))
try:
    server = http.server.ThreadingHTTPServer(('127.0.0.1', args.port), handler)
except OSError as exc:
    parser.exit(1, f'Could not open port {args.port}: {exc}\nTry: python3 serve.py --port 5195\n')
url = f'http://127.0.0.1:{server.server_port}/'
print(f'\nSignal Lab is running at {url}\nPress Control-C to stop.\n', flush=True)
if not args.no_browser:
    threading.Timer(0.2, lambda: webbrowser.open(url)).start()
try:
    server.serve_forever()
except KeyboardInterrupt:
    print('\nSignal Lab stopped.')
finally:
    server.server_close()
