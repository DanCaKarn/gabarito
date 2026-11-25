"""Monta um vídeo MJPEG (câmera FALSA do Chromium) a partir das fotos SINTÉTICAS (fictícias) de testes/sinteticos/.

  python3 ferramentas/video_teste.py SAIDA.mjpeg --roteiro sequencia      # mesa vazia → cartões A, B, C (sem sair da frente) → mesa vazia
  python3 ferramentas/video_teste.py SAIDA.mjpeg --roteiro mesa-vazia      # só mesa vazia
Só Pillow. Quadros 1080×1080 (o que a câmera falsa entrega), cartão encaixado na moldura-guia, 30 quadros/s, com tremor e ruído leves; a entrada de cada cartão
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
LARG, ALT, FPS = 1080, 1080, 30   # a câmera falsa do Chromium entrega 1080×1080 (recorte central) mesmo com arquivo 1080×1920
CARTAO_PX = 1450.0   # largura do cartão nominal (sem inclinação) nas fotos sintéticas (sinteticos.fotografar: cw)
PROP = 105 / 148.5   # proporção do cartão a6x4 = da moldura-guia do leitor


def quadro_base(nome: str, dx: int = 0, dy: int = 0, gira180: bool = False) -> Image.Image:
    """Enquadra a foto como o professor faria: o cartão nominal ocupa a MOLDURA-GUIA (90% da altura/largura, proporção do cartão),
    com a foto centrada. Quadro LARG×ALT."""
    im = Image.open(SINT / nome).convert("RGB")
    h_guia = 0.9 * ALT; w_guia = h_guia * PROP
    if w_guia > 0.9 * LARG:
        w_guia = 0.9 * LARG
    esc = w_guia / CARTAO_PX
    im = im.resize((round(im.width * esc), round(im.height * esc)), Image.LANCZOS)
    x, y = (im.width - LARG) // 2 - dx, (im.height - ALT) // 2 - dy   # dx,dy: cartão fora do lugar (px do quadro)
    q = im.crop((x, y, x + LARG, y + ALT))
    return q.rotate(180) if gira180 else q


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
    ap.add_argument("--roteiro", choices=["sequencia", "mesa-vazia", "extras"], default="sequencia")
    ap.add_argument("--a", default="01_base.jpg"); ap.add_argument("--b", default="02_base.jpg"); ap.add_argument("--c", default="13_sombra.jpg")
    a = ap.parse_args()
    rnd = random.Random(7)
    mesa = quadro_base("23_negativo_sem_cartao.jpg")
    vazio = variantes(mesa, 6, rnd)
    # (imagem, segundos)
    if a.roteiro == "mesa-vazia":
        partes = [(vazio, 8)]
    elif a.roteiro == "extras":
        # A fora do lugar (+4% da largura da moldura), B de cabeça para baixo, C MUITO fora da moldura (não pode ler)
        ca = variantes(quadro_base(a.a, dx=28, dy=-20), 6, rnd)
        cb = variantes(quadro_base(a.b, gira180=True), 6, rnd)
        cc = variantes(quadro_base("03_base.jpg", dx=330, dy=0), 6, rnd)
        partes = [(vazio, 2), (ca, 4), (cb, 4), (vazio, 2), (cc, 4), (vazio, 8)]
    else:
        ca, cb, cc = (variantes(quadro_base(n), 6, rnd) for n in (a.a, a.b, a.c))
        partes = [(vazio, 3), (ca, 4), (cb, 4), (cc, 4), (vazio, 8)]
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
