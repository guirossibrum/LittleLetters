"""Local worksheet PDF helper using Omarchy's system Cairo/Pango/librsvg stack."""
import argparse
import ctypes
import ctypes.util
import fcntl
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import threading
import time
from urllib.error import URLError
from urllib.parse import unquote, urlsplit
from urllib.request import Request, urlopen
import uuid
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent
PAPER = {"letter": (215.9, 279.4), "a4": (210, 297)}
FAMILIES = {"PracticeBlock": "ABeeZee", "PracticeScript": "Allura",
            "PracticeItalianno": "Italianno", "PracticeSacramento": "Sacramento",
            "PracticeParisienne": "Parisienne", "PracticeDancing": "Dancing Script",
            "PracticeGreatVibes": "Great Vibes", "PracticePinyon": "Pinyon Script"}
SVG_NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVG_NS)
RENDER_LOCK = threading.Lock()
MAX_REQUEST = 8 * 1024 * 1024
IDLE_SECONDS = 600
_fonts_ready = False


def private_directory(path):
    path = Path(path)
    if path.is_symlink():
        raise ValueError("The private data directory must not be a symlink.")
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.stat().st_uid != os.getuid():
        raise ValueError("The private data directory has a different owner.")
    path.chmod(0o700)
    return path


def register_fonts():
    """Register bundled fonts only in this process, without installing system fonts."""
    global _fonts_ready
    if _fonts_ready:
        return
    library = ctypes.CDLL(ctypes.util.find_library("fontconfig"))
    library.FcConfigGetCurrent.restype = ctypes.c_void_p
    library.FcConfigAppFontAddFile.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
    library.FcConfigAppFontAddFile.restype = ctypes.c_int
    library.FcConfigBuildFonts.argtypes = [ctypes.c_void_p]
    library.FcConfigBuildFonts.restype = ctypes.c_int
    config = library.FcConfigGetCurrent()
    for font in (ROOT / "assets/fonts").glob("*.ttf"):
        if not library.FcConfigAppFontAddFile(config, os.fsencode(font)):
            raise RuntimeError("A bundled worksheet font could not be loaded.")
    if not library.FcConfigBuildFonts(config):
        raise RuntimeError("Worksheet font registration failed.")
    _fonts_ready = True


def clean_svg(source, size):
    """Accept only our generated vector worksheets; never load external resources."""
    if not isinstance(source, str) or "<!" in source:
        raise ValueError("Invalid worksheet SVG.")
    root = ET.fromstring(source)
    width, height = size
    if root.tag != f"{{{SVG_NS}}}svg" or root.get("viewBox") != f"0 0 {width:g} {height:g}":
        raise ValueError("The worksheet paper size does not match.")
    allowed = {f"{{{SVG_NS}}}{name}" for name in ("svg", "g", "path", "text", "rect", "title")}
    for count, element in enumerate(root.iter()):
        if count > 50000 or element.tag not in allowed:
            raise ValueError("Unsupported worksheet content.")
        for key, value in element.attrib.items():
            if key.lower().endswith("href") or key.lower().startswith("on") or "url(" in value.lower() or key == "style":
                raise ValueError("External worksheet resources are not allowed.")
        if element.get("font-family"):
            family = element.get("font-family")
            if family not in FAMILIES:
                raise ValueError("Unknown worksheet font.")
            element.set("font-family", FAMILIES[family])
    return ET.tostring(root, encoding="utf-8")


def render_pdf(pages, paper, output_dir):
    if paper not in PAPER or not isinstance(pages, list) or not 1 <= len(pages) <= 100:
        raise ValueError("Choose a valid paper size and between 1 and 100 pages.")
    size = PAPER[paper]
    documents = [clean_svg(page, size) for page in pages]
    import cairo
    import gi
    gi.require_version("Rsvg", "2.0")
    from gi.repository import Rsvg
    output_dir = private_directory(output_dir)
    filename = output_dir / (uuid.uuid4().hex + ".pdf")
    with RENDER_LOCK:
        register_fonts()
        descriptor = os.open(filename, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            with os.fdopen(descriptor, "wb") as output:
                width, height = (value * 72 / 25.4 for value in size)
                surface = cairo.PDFSurface(output, width, height)
                surface.set_metadata(cairo.PDF_METADATA_CREATOR, "Little Letters")
                surface.set_metadata(cairo.PDF_METADATA_TITLE, "Little Letters practice worksheet")
                try:
                    context = cairo.Context(surface)
                    viewport = Rsvg.Rectangle()
                    viewport.x = viewport.y = 0
                    viewport.width, viewport.height = width, height
                    for document in documents:
                        handle = Rsvg.Handle.new_from_data(document)
                        if not handle.render_document(context, viewport):
                            raise RuntimeError("A worksheet page could not be rendered.")
                        context.show_page()
                finally:
                    surface.finish()
        except Exception:
            filename.unlink(missing_ok=True)
            raise
    return filename


def open_document(filename):
    subprocess.Popen(["xdg-open", str(filename)], stdin=subprocess.DEVNULL,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)


def fingerprint():
    digest = hashlib.sha256()
    for filename in ("native_pdf.py", "manifest.json"):
        digest.update((ROOT / filename).read_bytes())
    return str(ROOT) + ":" + digest.hexdigest()


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(15)

    def log_message(self, *args):
        pass  # Practice text and authentication material never enter request logs.

    def reply(self, status, data, content_type="application/json"):
        body = json.dumps(data).encode() if content_type == "application/json" else data
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'")
        self.end_headers()
        self.wfile.write(body)

    def allowed(self, authenticated=False):
        origin = self.server.origin
        if self.headers.get("Host") != urlsplit(origin).netloc or self.headers.get("Origin", origin) != origin:
            self.reply(403, {"error": "Request origin rejected."})
            return False
        if authenticated and not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + self.server.token):
            self.reply(403, {"error": "Authentication required."})
            return False
        return True

    def do_GET(self):
        path = unquote(urlsplit(self.path).path)
        if not self.allowed(path.startswith("/api/")):
            return
        if path in ("/api/status", "/api/ping"):
            self.server.last_activity = time.monotonic()
            self.reply(200, {"ok": True, "fingerprint": self.server.identity})
            return
        if path in ("/", "/index.html"):
            relative = "index.html"
        elif path in ("/app.js", "/styles.css", "/glyphs.js") or path.startswith("/assets/fonts/"):
            relative = path.lstrip("/")
        else:
            self.reply(404, {"error": "Not found."})
            return
        filename = ROOT / relative
        boundary = ROOT / "assets/fonts" if path.startswith("/assets/fonts/") else ROOT
        if ".." in Path(relative).parts or not filename.resolve().is_relative_to(boundary) or not filename.is_file() or filename.is_symlink():
            self.reply(404, {"error": "Not found."})
            return
        types = {".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
                 ".css": "text/css; charset=utf-8", ".ttf": "font/ttf", ".txt": "text/plain; charset=utf-8"}
        self.reply(200, filename.read_bytes(), types.get(filename.suffix, "application/octet-stream"))

    def do_POST(self):
        if not self.allowed(True):
            return
        if self.path == "/api/shutdown":
            self.reply(200, {"ok": True})
            self.wfile.flush()
            self.server.stop_requested = True
            return
        if self.path != "/api/pdf" or self.headers.get("Content-Type") != "application/json":
            self.reply(400, {"error": "Expected a worksheet PDF request."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_REQUEST:
                raise ValueError("The worksheet is too large.")
            payload = json.loads(self.rfile.read(length))
            self.server.last_activity = time.monotonic()
            filename = render_pdf(payload.get("pages"), payload.get("paper"), self.server.output_dir)
            self.server.opener(filename)
            self.reply(200, {"ok": True, "document": filename.name})
        except (ValueError, ET.ParseError, TypeError, AttributeError):
            self.reply(400, {"error": "Invalid worksheet content or paper size."})
        except Exception:
            self.reply(500, {"error": "PDF export failed. Check that system Cairo, Pango and librsvg are available."})


def make_server(output_dir, token, port=0, opener=open_document):
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    server.token = token
    server.origin = f"http://127.0.0.1:{server.server_port}"
    server.identity = fingerprint()
    server.output_dir = output_dir
    server.opener = opener
    server.last_activity = time.monotonic()
    server.stop_requested = False
    server.timeout = 1
    return server


def request(state, path, method="GET"):
    address = f"http://127.0.0.1:{int(state['port'])}{path}"
    req = Request(address, headers={"Authorization": "Bearer " + state["token"]}, method=method)
    with urlopen(req, timeout=2) as response:
        return json.load(response)


def state_directory():
    base = Path(os.environ.get("XDG_RUNTIME_DIR", str(Path.home() / ".cache")))
    return private_directory(base / "littleletters")


def serve(directory):
    directory = private_directory(directory)
    state_file = directory / "server.json"
    try:
        previous = json.loads(state_file.read_text())
        port = int(previous.get("port", 0))
    except (OSError, ValueError, TypeError):
        port = 0
    output = Path(os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local/share"))) / "littleletters/worksheets"
    token = secrets.token_urlsafe(32)
    try:
        server = make_server(output, token, port)
    except OSError:
        server = make_server(output, token)
    with server:
        temporary = directory / (uuid.uuid4().hex + ".json")
        temporary.write_text(json.dumps({"port": server.server_port, "token": token}))
        temporary.chmod(0o600)
        temporary.replace(state_file)
        while not server.stop_requested and time.monotonic() - server.last_activity < IDLE_SECONDS:
            server.handle_request()


def launch(mode):
    directory = state_directory()
    state_file = directory / "server.json"
    with (directory / "launch.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        state = {}
        try:
            state = json.loads(state_file.read_text())
            if request(state, "/api/status").get("fingerprint") != fingerprint():
                request(state, "/api/shutdown", "POST")
                # Let the old listener release its port before starting the new version.
                for _ in range(30):
                    try:
                        request(state, "/api/status")
                    except (OSError, ValueError, URLError):
                        break
                    time.sleep(.1)
                state = {}
        except (OSError, ValueError, KeyError, URLError):
            state = {}
        if not state:
            subprocess.Popen([sys.executable, "-B", str(ROOT / "native_pdf.py"), "--serve", str(directory)],
                             stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                             start_new_session=True)
            for _ in range(100):
                time.sleep(.1)
                try:
                    state = json.loads(state_file.read_text())
                    if request(state, "/api/status").get("fingerprint") == fingerprint():
                        break
                except (OSError, ValueError, KeyError, URLError):
                    pass
            else:
                raise RuntimeError("The local worksheet helper could not start.")
        url = f"http://127.0.0.1:{state['port']}/#token={state['token']}"
    if mode == "--url":
        print(url)
    elif mode == "--app" and shutil.which("omarchy"):
        subprocess.run(["omarchy", "launch", "webapp", url], check=True)
    else:
        subprocess.run(["xdg-open", url], check=True)


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app", action="store_true")
    parser.add_argument("--browser", action="store_true")
    parser.add_argument("--url", action="store_true")
    parser.add_argument("--serve", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.serve:
        serve(args.serve)
    else:
        mode = "--browser" if args.browser else "--url" if args.url else "--app"
        launch(mode)


if __name__ == "__main__":
    main()
