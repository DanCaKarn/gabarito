"""Roda os testes da correção do leitor (JavaScript) junto com o unittest. Pula se não houver node."""
import shutil
import subprocess
import unittest
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent


@unittest.skipUnless(shutil.which("node"), "node não instalado")
class Corrigir(unittest.TestCase):
    def test_corrigir_js(self):
        r = subprocess.run(["node", "--test", "tests/corrigir.test.mjs"], cwd=RAIZ, capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
