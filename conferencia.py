"""Renderiza a página 1 do PDF e desenha o molde (lido do JSON em disco) em vermelho por cima."""
from __future__ import annotations

import json
import math
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw

DPI = 200
VERMELHO = (255, 0, 0)


def renderizar_pagina1(pdf: Path, png: Path, dpi: int = DPI) -> None:
    base = png.with_suffix("")
    subprocess.run(["pdftoppm", "-r", str(dpi), "-f", "1", "-l", "1", "-singlefile", "-png",
                    str(pdf), str(base)], check=True)


def gerar_conferencia(pdf: Path, molde_json: Path, png_saida: Path, dpi: int = DPI) -> None:
    molde = json.loads(molde_json.read_text(encoding="utf-8"))
    tmp = png_saida.with_name(png_saida.stem + "_tmp.png")
    renderizar_pagina1(pdf, tmp, dpi)
    img = Image.open(tmp).convert("RGB")
    tmp.unlink()
    cart = molde["cartao"]   # molde é do cartão: recorta o quarto sup. esq. da página 1 (no a4 = página toda)
    img = img.crop((0, 0, min(img.width, round(cart["largura"] * dpi / 25.4)),
                    min(img.height, round(cart["altura"] * dpi / 25.4))))
    d = ImageDraw.Draw(img)
    s = dpi / 25.4
    w = 2

    def ret(x, y, l, a):
        d.rectangle([x * s, y * s, (x + l) * s, (y + a) * s], outline=VERMELHO, width=w)

    def quad(cx, cy, t):
        ret(cx - t / 2, cy - t / 2, t, t)

    for m in molde["marcas"]:
        quad(m["cx"], m["cy"], m["tamanho"])
    q = molde["qr"]
    ret(q["x"], q["y"], q["tamanho"], q["tamanho"])
    z = q["zona_silencio"]
    ret(z["x"], z["y"], z["largura"], z["altura"])
    b = molde["bloco_respostas"]
    ret(b["x"], b["y"], b["largura"], b["altura"])
    for m in molde["marcas_bloco"]:
        quad(m["cx"], m["cy"], m["tamanho"])
    r = molde["recorte_auditoria"]
    ret(r["x"], r["y"], r["largura"], r["altura"])
    for bo in molde["bolhas"]:
        d.ellipse([(bo["cx"] - bo["r"]) * s, (bo["cy"] - bo["r"]) * s,
                   (bo["cx"] + bo["r"]) * s, (bo["cy"] + bo["r"]) * s], outline=VERMELHO, width=w)
    img.save(png_saida)
