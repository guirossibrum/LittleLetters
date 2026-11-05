"""Native PDF and local API checks. Run: /usr/bin/python3 -B tests/native_pdf.py"""
from pathlib import Path
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from native_pdf import ROOT, clean_svg, make_server, render_pdf

SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 210 297"><text x="16" y="30" font-size="10" font-family="PracticeScript">Practice ó</text></svg>'


class NativePdfTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(prefix="little-letters-native-")
        self.addCleanup(self.folder.cleanup)
        self.output = Path(self.folder.name) / "documents"

    def test_native_pdf_has_private_permissions_text_and_a4_paper(self):
        document = render_pdf([SVG, SVG], "a4", self.output)
        self.assertEqual(os.stat(document).st_mode & 0o777, 0o600)
        self.assertEqual(os.stat(self.output).st_mode & 0o777, 0o700)
        self.assertEqual(len(document.stem), 32)
        info = subprocess.check_output(["pdfinfo", str(document)], text=True)
        self.assertRegex(info, r"Pages:\s+2")
        self.assertIn("A4", info)
        self.assertIn("cairo", info.lower())
        content = subprocess.check_output(["pdftotext", str(document), "-"], text=True)
        self.assertIn("Practice ó", content)
        fonts = subprocess.check_output(["pdffonts", str(document)], text=True)
        self.assertIn("Allura", fonts)

    def test_external_resources_and_invalid_paper_are_rejected(self):
        for extra in ['<image href="file:///etc/passwd"/>', '<script/>', '<foreignObject/>', '<path style="fill:url(http://example.invalid)"/>']:
            with self.assertRaises(ValueError):
                clean_svg(SVG.replace('</svg>', extra + '</svg>'), (210, 297))
        with self.assertRaises(ValueError):
            clean_svg('<!DOCTYPE svg>' + SVG, (210, 297))
        with self.assertRaises(ValueError):
            render_pdf([SVG], "invalid", self.output)
        with self.assertRaises(ValueError):
            render_pdf([], "a4", self.output)
        self.assertFalse(self.output.exists())

    def test_launcher_reuses_a_private_helper_without_opening_a_browser(self):
        folder = Path(self.folder.name)
        env = {**os.environ, 'XDG_RUNTIME_DIR': str(folder / 'runtime'), 'XDG_DATA_HOME': str(folder / 'data')}
        command = ['bash', str(ROOT / 'bin/little-letters'), '--url']
        address = subprocess.check_output(command, env=env, text=True, timeout=15).strip()
        parsed = urlsplit(address)
        token = parse_qs(parsed.fragment)['token'][0]
        def stop():
            req = Request(f'http://127.0.0.1:{parsed.port}/api/shutdown', headers={'Authorization': 'Bearer ' + token}, method='POST')
            with urlopen(req, timeout=3) as response:
                response.read()
        self.addCleanup(stop)
        self.assertEqual(parsed.hostname, '127.0.0.1')
        self.assertEqual(subprocess.check_output(command, env=env, text=True, timeout=15).strip(), address)
        directory = folder / 'runtime/littleletters'
        self.assertEqual(directory.stat().st_mode & 0o777, 0o700)
        self.assertEqual((directory / 'server.json').stat().st_mode & 0o777, 0o600)

    def test_local_api_requires_secret_same_origin_and_restricts_files(self):
        opened = []
        server = make_server(self.output, "test-secret", opener=opened.append)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        def call(path, token=None, origin=None, payload=None):
            headers = {"Content-Type": "application/json"}
            if token:
                headers["Authorization"] = "Bearer " + token
            if origin:
                headers["Origin"] = origin
            data = json.dumps(payload).encode() if payload is not None else None
            return urlopen(Request(server.origin + path, data=data, headers=headers), timeout=5)
        for token, origin in [(None, None), ("wrong-secret", None), ("test-secret", "https://example.invalid")]:
            with self.assertRaises(HTTPError) as error:
                call('/api/pdf', token, origin, {"pages": [SVG], "paper": "a4"})
            self.assertEqual(error.exception.code, 403)
            error.exception.close()
        for path in ['/.git/config', '/assets/fonts/../../.git/config', '/native_pdf.py']:
            with self.assertRaises(HTTPError) as error:
                call(path)
            self.assertEqual(error.exception.code, 404)
            error.exception.close()
        with call('/api/pdf', 'test-secret', server.origin, {"pages": [SVG], "paper": "a4"}) as response:
            self.assertTrue(json.load(response)['ok'])
        self.assertEqual(len(opened), 1)
        self.assertEqual(opened[0].parent, self.output)


if __name__ == '__main__':
    unittest.main()
