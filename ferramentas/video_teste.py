"""Monta um vídeo MJPEG (câmera FALSA do Chromium) a partir das fotos SINTÉTICAS (fictícias) de testes/sinteticos/.

  python3 ferramentas/video_teste.py SAIDA.mjpeg --roteiro sequencia      # mesa vazia → cartão A → cartão B → mesa vazia
  python3 ferramentas/video_teste.py SAIDA.mjpeg --roteiro mesa-vazia      # só mesa vazia
Só Pillow. Quadros 1080×1920 (retrato, como o iPhone), 30 quadros/s, com tremor e ruído leves; a entrada de cada cartão
é um deslize lateral (as marcas se movem: o leitor não pode capturar nessa hora).
"""
from __future__ import annotations

import argparse
import io
import random
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter

RAIZ = Path(__file__).resolve().parent.parent
SINT = RAIZ / "testes" / "sinteticos"
LARG, ALT, FPS = 1080, 1920, 30


def quadro_base(nome: str) -> Image.Image:
    im = Image.open(SINT / nome).convert("RGB")
    w, h = LARG, round(im.height * LARG / im.width)
    im = im.resize((w, h), Image.LANCZOS)
    # completa até 9:16 com a cor média das bordas (mesa)
    borda = im.crop((0, 0, w, 20)).resize((1, 1), Image.BOX).getpixel((0, 0))
    tela = Image.new("RGB", (LARG, ALT), borda)
    tela.paste(im, (0, (ALT - h) // 2))
    return tela


def variantes(base: Image.Image, n: int, rnd: random.Random):
    """n versões com tremor de ±1 px, brilho e ruído leves (mão segurando o celular)."""
    out = []
    for _ in range(n):
        dx, dy = rnd.randint(-1, 1), rnd.randint(-1, 1)
        im = ImageChops.offset(base, dx, dy)
        ruido = Image.effect_noise((LARG, ALT), 6).convert("RGB")
        out.append(Image.blend(im, ruido, 0.04))
    return out


def jpeg(im: Image.Image) -> bytes:
    b = io.BytesIO()
    im.save(b, "JPEG", quality=82)
    return b.getvalue()


def deslize(a: Image.Image, b: Image.Image, passos: int):
    """b entra da direita empurrando a para a esquerda."""
    faixa = Image.new("RGB", (LARG * 2, ALT)); faixa.paste(a, (0, 0)); faixa.paste(b, (LARG, 0))
    for i in range(1, passos + 1):
        x = round(LARG * i / (passos + 1))
        yield faixa.crop((x, 0, x + LARG, ALT))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("saida")
    ap.add_argument("--roteiro", choices=["sequencia", "mesa-vazia"], default="sequencia")
    ap.add_argument("--a", default="01_base.jpg"); ap.add_argument("--b", default="05_perspectiva.jpg")
    a = ap.parse_args()
    rnd = random.Random(7)
    mesa = quadro_base("23_negativo_sem_cartao.jpg")
    vazio = variantes(mesa, 6, rnd)
    # (imagem, segundos)
    if a.roteiro == "mesa-vazia":
        partes = [(vazio, 8)]
    else:
        ca, cb = variantes(quadro_base(a.a), 6, rnd), variantes(quadro_base(a.b), 6, rnd)
        partes = [(vazio, 3), (ca, 4), (cb, 4), (vazio, 8)]
    quadros: list[bytes] = []
    for k, (vs, seg) in enumerate(partes):
        if k:
            for im in deslize(partes[k - 1][0][0], vs[0], 15):
                quadros.append(jpeg(im))
        cache = [jpeg(v) for v in vs]
        for i in range(round(seg * FPS)):
            quadros.append(cache[i % len(cache) if i % 3 else rnd.randrange(len(cache))])
    Path(a.saida).write_bytes(b"".join(quadros))
    print(f"{len(quadros)} quadros ({len(quadros) / FPS:.1f} s a {FPS} fps), {Path(a.saida).stat().st_size / 1e6:.0f} MB")


if __name__ == "__main__":
    main()
