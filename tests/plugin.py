"""Launcher checks. Run: python -B tests/plugin.py"""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent


class PluginTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="little-letters-tests-")
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)

    def test_launcher_handles_spaces_accents_and_shell_characters(self):
        app = self.folder / "Little Letters ó # % ' $(do-not-execute)"
        (app / "bin").mkdir(parents=True)
        (app / "bin/little-letters").write_bytes((ROOT / "bin/little-letters").read_bytes())
        (app / "index.html").write_text("test")
        (app / "native_pdf.py").write_text("import json,os,sys\nopen(os.environ['CAPTURE'], 'w').write(json.dumps(sys.argv))\n")
        commands = self.folder / "commands"
        commands.mkdir()
        capture = self.folder / "arguments.json"
        for name in ("omarchy", "xdg-open"):
            command = commands / name
            command.write_text("#!/usr/bin/env python3\nimport json,os,sys\nopen(os.environ['CAPTURE'], 'w').write(json.dumps(sys.argv))\n")
            command.chmod(0o755)
        env = {**os.environ, "PATH": str(commands) + os.pathsep + os.environ["PATH"], "CAPTURE": str(capture)}
        launcher = app / "bin/little-letters"
        expected = str(app / "native_pdf.py")
        subprocess.run(["bash", str(launcher), "--url"], env=env, check=True)
        self.assertEqual(json.loads(capture.read_text()), [expected, '--url'])
        subprocess.run(["bash", str(launcher)], env=env, check=True)
        self.assertEqual(json.loads(capture.read_text()), [expected, '--app'])
        subprocess.run(["bash", str(launcher), "--browser"], env=env, check=True)
        self.assertEqual(json.loads(capture.read_text()), [expected, '--browser'])
        self.assertEqual(subprocess.run(["bash", str(launcher), "--invalid"], capture_output=True).returncode, 2)


if __name__ == "__main__":
    unittest.main()
