"""Isolated browser-test server: real native PDFs, with the desktop opener stubbed."""
from pathlib import Path
import json
import secrets
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from native_pdf import make_server

folder = Path(sys.argv[1])
token = secrets.token_urlsafe(32)
with make_server(folder, token, opener=lambda filename: None) as server:
    print(json.dumps({"url": server.origin + "/#token=" + token}), flush=True)
    server.serve_forever()
