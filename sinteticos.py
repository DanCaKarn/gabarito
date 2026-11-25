"""Gera fotos SINTÉTICAS de cartões-resposta a6x4 (alunos fictícios) para testar o leitor.

Saída em testes/sinteticos/: NN_caso.jpg + NN_caso.json (a "verdade") + index.json.
Só Pillow. Usa dados/exemplo.csv (fictício) e gera o PDF num diretório temporário; nunca lê dados reais.

  uv run sinteticos.py
"""
from __future__ import annotations

import json
import math
import random
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

import gerar_cartoes
import montagem
from modelos import alunos_da_turma, ler_alunos

RAIZ = Path(__file__).resolve().parent
SAIDA = RAIZ / "testes" / "sinteticos"
PROVA = RAIZ / "provas" / "teste-mat-10q.json"
TURMA = "9º C"
DPI = 300
MM = DPI / 25.4

AZUL = [(28, 48, 150), (40, 60, 165), (20, 40, 130)]
PRETO = [(22, 22, 22), (35, 35, 38)]

# (tags, card_q, caneta, rx, ry, rot, sombra, desfoque, ruido, jpeg)
CASOS = [
    (["base"], 0, "azul", 0, 0, 0.5, 0.0, 0.0, 0, 85),
    (["base"], 1, "preta", 0, 0, -1.0, 0.0, 0.0, 0, 85),
    (["base"], 2, "azul", 0, 0, 1.5, 0.0, 0.0, 0, 85),
    (["base"], 0, "preta", 0, 0, 0.0, 0.0, 0.0, 0, 85),
    (["perspectiva"], 1, "azul", 12, 0, 1, 0.0, 0.5, 0, 85),
    (["perspectiva"], 0, "preta", 0, 15, -2, 0.0, 0.5, 0, 85),
    (["perspectiva"], 2, "azul", 18, 10, 3, 0.0, 0.6, 0, 85),
    (["perspectiva"], 1, "preta", 20, -15, -3, 0.0, 0.6, 0, 85),
    (["rotacao"], 0, "azul", 3, 2, 12, 0.0, 0.5, 0, 85),
    (["rotacao"], 2, "preta", 2, -3, -15, 0.0, 0.5, 0, 85),
    (["cabeca_baixo"], 1, "azul", 8, 5, 180, 0.0, 0.5, 0, 85),
    (["rot90"], 0, "preta", 6, 4, 90, 0.0, 0.5, 0, 85),
    (["sombra"], 0, "azul", 5, 3, 2, 0.35, 0.5, 0, 85),
    (["sombra"], 1, "preta", 4, -4, -3, 0.5, 0.5, 0, 85),
    (["sombra"], 2, "azul", 8, 2, 1, 0.65, 0.6, 0, 85),
    (["desfoque_ruido"], 0, "azul", 5, 5, 2, 0.0, 1.4, 14, 85),
    (["desfoque_ruido"], 1, "preta", 6, -3, -2, 0.0, 1.8, 20, 85),
    (["desfoque_ruido"], 2, "azul", 4, 4, 1, 0.0, 2.2, 24, 80),
    (["jpeg_baixo"], 0, "azul", 6, 6, 3, 0.0, 0.8, 8, 55),
    (["jpeg_baixo"], 1, "preta", 5, -6, -3, 0.0, 0.8, 8, 60),
    (["combinado"], 2, "azul", 18, -12, -10, 0.5, 1.6, 18, 60),
]

COMPOSICAO = ["cheia"] * 5 + ["x", "meia", "dupla", "branco", "branco"]


# ---------------------------------------------------------------- cartão limpo
def cartoes_limpos(tmp: Path):
    """Gera o a6x4 de exemplo e devolve (molde, [(imagem do quarto, matricula)] para q = 0..3 da página 1)."""
    rc = gerar_cartoes.main(["--prova", str(PROVA), "--alunos", str(RAIZ / "dados/exemplo.csv"),
                             "--turma", TURMA, "--formato", "a6x4", "--saida", str(tmp / "saida"),
                             "--moldes", str(tmp / "moldes")])
    if rc:
        sys.exit(rc)
    subprocess.run(["pdftoppm", "-r", str(DPI), "-f", "1", "-l", "1", "-singlefile", "-png",
                    str(tmp / "saida/teste-mat-10q_9c.pdf"), str(tmp / "p1")], check=True)
    folha = Image.open(tmp / "p1.png").convert("RGB")
    molde = json.loads((tmp / "saida/teste-mat-10q_molde.json").read_text(encoding="utf-8"))
    cw, ch = molde["cartao"]["largura"] * MM, molde["cartao"]["altura"] * MM
    ativos, _ = alunos_da_turma(ler_alunos(RAIZ / "dados/exemplo.csv"), TURMA)
    pagina1 = montagem.sequencia_paginas(montagem.completar_com_genericos(ativos, TURMA, 3))[0]
    out = []
    for q, ct in enumerate(pagina1):
        ox, oy = (q % 2) * cw, (q // 2) * ch
        quarto = folha.crop((round(ox), round(oy), round(ox + cw), round(oy + ch)))
        out.append((quarto, ct.matricula or ""))
    return molde, out


# ---------------------------------------------------------------- pintura
def _blob(draw, cx, cy, r, cor, rng, ruido=0.07):
    n = 28
    pts = []
    for k in range(n):
        a = 2 * math.pi * k / n
        rr = r * (1 + rng.uniform(-ruido, ruido))
        pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    draw.polygon(pts, fill=cor)


def _cheia(img, cx, cy, r, cor, rng):
    d = ImageDraw.Draw(img)
    _blob(d, cx, cy, r * rng.uniform(0.92, 1.12), cor, rng)
    for _ in range(3):   # retoques: o preenchimento não é perfeito, mas cobre o centro
        _blob(d, cx + rng.uniform(-0.1, 0.1) * r, cy + rng.uniform(-0.1, 0.1) * r, r * 0.8, cor, rng)


    if rng.random() < 0.6:   # caneta de verdade deixa falhas: riscos finos de papel aparecendo (cobertura ~85–95%)
        for _ in range(rng.randint(1, 3)):
            a = rng.uniform(0, math.pi)
            dx, dy = math.cos(a) * r * 1.2, math.sin(a) * r * 1.2
            o = rng.uniform(-0.5, 0.5) * r
            nx, ny = -math.sin(a) * o, math.cos(a) * o
            d.line([(cx - dx + nx, cy - dy + ny), (cx + dx + nx, cy + dy + ny)], fill=(238, 238, 238),
                   width=max(2, round(rng.uniform(0.15, 0.3) * MM)))


def _x(img, cx, cy, r, cor, rng):
    d = ImageDraw.Draw(img)
    e = r * rng.uniform(0.9, 1.15)
    w = max(3, round(0.55 * MM))
    j = lambda: rng.uniform(-0.12, 0.12) * r
    d.line([(cx - e + j(), cy - e + j()), (cx + e + j(), cy + e + j())], fill=cor, width=w)
    d.line([(cx - e + j(), cy + e + j()), (cx + e + j(), cy - e + j())], fill=cor, width=w)


def _meia(img, cx, cy, r, cor, rng):
    """Preenche ~35–55% do disco central (corda cortando o círculo)."""
    camada = Image.new("L", img.size, 0)
    d = ImageDraw.Draw(camada)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
    corte = Image.new("L", img.size, 0)
    ang = rng.uniform(0, 2 * math.pi)
    off = rng.uniform(-0.2, 0.25) * r        # deslocamento da corda: ~35–60% da bolha
    ImageDraw.Draw(corte).polygon([
        (cx + math.cos(ang) * (off) + math.cos(ang + math.pi / 2) * 3 * r, cy + math.sin(ang) * off + math.sin(ang + math.pi / 2) * 3 * r),
        (cx + math.cos(ang) * (off) - math.cos(ang + math.pi / 2) * 3 * r, cy + math.sin(ang) * off - math.sin(ang + math.pi / 2) * 3 * r),
        (cx + math.cos(ang) * 4 * r - math.cos(ang + math.pi / 2) * 3 * r, cy + math.sin(ang) * 4 * r - math.sin(ang + math.pi / 2) * 3 * r),
        (cx + math.cos(ang) * 4 * r + math.cos(ang + math.pi / 2) * 3 * r, cy + math.sin(ang) * 4 * r + math.sin(ang + math.pi / 2) * 3 * r),
    ], fill=255)
    img.paste(Image.new("RGB", img.size, cor), (0, 0), ImageChops.multiply(camada, corte))


def pintar(cartao, molde, caneta, rng):
    img = cartao.copy()
    tipos = COMPOSICAO[:]
    rng.shuffle(tipos)
    resp = []
    cores = AZUL if caneta == "azul" else PRETO
    alts = molde["prova"]["alternativas"]
    for q in range(1, molde["prova"]["questoes"] + 1):
        tipo = tipos[q - 1]
        bol = {b["alternativa"]: b for b in molde["bolhas"] if b["questao"] == q}
        cor = rng.choice(cores)
        escolha = rng.sample(alts, 2 if tipo == "dupla" else 1)
        reg = {"questao": q, "tipo": tipo}
        if tipo == "branco":
            reg["estado"] = "branco"
        else:
            for a in escolha:
                b = bol[a]
                cx, cy, r = b["cx"] * MM, b["cy"] * MM, b["r"] * MM
                {"cheia": _cheia, "dupla": _cheia, "x": _x, "meia": _meia}[tipo](img, cx, cy, r, cor, rng)
            if tipo == "cheia":
                reg.update(estado="marcada", letra=escolha[0])
            elif tipo == "dupla":
                reg.update(estado="dupla", letras=sorted(escolha))
            else:
                reg.update(estado="duvida", letras=escolha)
        resp.append(reg)
    return img, resp


# ---------------------------------------------------------------- foto
def _resolver(A, b):
    n = len(b)
    M = [row[:] + [b[i]] for i, row in enumerate(A)]
    for i in range(n):
        p = max(range(i, n), key=lambda k: abs(M[k][i]))
        M[i], M[p] = M[p], M[i]
        for k in range(i + 1, n):
            f = M[k][i] / M[i][i]
            for j in range(i, n + 1):
                M[k][j] -= f * M[i][j]
    x = [0.0] * n
    for i in reversed(range(n)):
        x[i] = (M[i][n] - sum(M[i][j] * x[j] for j in range(i + 1, n))) / M[i][i]
    return x


def coef_perspectiva(destino, origem):
    """Coeficientes do Image.transform(PERSPECTIVE): pixel de saída (x,y) -> pixel de entrada."""
    A, b = [], []
    for (x, y), (u, v) in zip(destino, origem):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.append(u)
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y]); b.append(v)
    return _resolver(A, b)


def _rot(p, rx, ry, rz):
    x, y, z = p
    c, s = math.cos(rx), math.sin(rx); y, z = y * c - z * s, y * s + z * c
    c, s = math.cos(ry), math.sin(ry); x, z = x * c + z * s, -x * s + z * c
    c, s = math.cos(rz), math.sin(rz); x, y = x * c - y * s, x * s + y * c
    return x, y, z


def gradiente(w, h, graus):
    """Gradiente linear 0..255 na direção `graus`, do tamanho (w, h), sem artefatos de borda."""
    d = int(math.hypot(w, h)) + 4
    g = Image.linear_gradient("L").resize((d, d), Image.BICUBIC).rotate(graus, resample=Image.BICUBIC)
    return g.crop(((d - w) // 2, (d - h) // 2, (d - w) // 2 + w, (d - h) // 2 + h))


def mesa(w, h, rng):
    base = rng.choice([(150, 112, 78), (120, 120, 118), (170, 150, 120)])
    img = Image.new("RGB", (w, h), base)
    ruido = Image.effect_noise((w // 4, h // 4), 30).resize((w, h), Image.BICUBIC).filter(ImageFilter.GaussianBlur(3))
    ruido = Image.merge("RGB", [ruido] * 3)
    img = ImageChops.add(img, ruido, scale=2.0, offset=-64)
    veio = gradiente(w, h, rng.uniform(0, 180))
    return ImageChops.blend(img, Image.merge("RGB", [veio] * 3), 0.12)


def fotografar(cartao, rx, ry, rot, sombra, desfoque, ruido, rng, canvas=(2400, 3200), deslocar=None):
    W, H = canvas
    f = 1800.0
    cw = 1450.0
    ch = cw * cartao.height / cartao.width
    cantos3d = [(-cw / 2, -ch / 2), (cw / 2, -ch / 2), (cw / 2, ch / 2), (-cw / 2, ch / 2)]
    dx, dy = deslocar or (rng.uniform(-80, 80), rng.uniform(-80, 80))
    quad = []
    for (x, y) in cantos3d:
        X, Y, Z = _rot((x, y, 0.0), math.radians(rx), math.radians(ry), math.radians(rot))
        Z += f
        quad.append((W / 2 + dx + f * X / Z, H / 2 + dy + f * Y / Z))
    origem = [(0, 0), (cartao.width, 0), (cartao.width, cartao.height), (0, cartao.height)]
    coef = coef_perspectiva(quad, origem)
    fundo = mesa(W, H, rng)
    warp = cartao.transform((W, H), Image.PERSPECTIVE, coef, Image.BICUBIC)
    mascara = Image.new("L", cartao.size, 255).transform((W, H), Image.PERSPECTIVE, coef, Image.BILINEAR)
    fundo.paste(warp, (0, 0), mascara)
    img = fundo
    if sombra > 0:    # gradiente de luz diagonal + faixa de sombra
        g = gradiente(W, H, rng.uniform(0, 360))
        lo = int(255 * (1 - sombra))
        g = g.point(lambda v: lo + v * (255 - lo) // 255)
        img = ImageChops.multiply(img, Image.merge("RGB", [g] * 3))
    if desfoque:
        img = img.filter(ImageFilter.GaussianBlur(desfoque))
    if ruido:
        n = Image.effect_noise((W, H), ruido)
        img = ImageChops.add(img, Image.merge("RGB", [n] * 3), scale=1.0, offset=-128)
    return img


# Casos NEGATIVOS: o leitor deve recusar (erro claro), nunca "chutar". (tags, card_q, deslocamento (dx,dy) em px)
NEGATIVOS = [
    (["negativo_cortado"], 0, (-740, -80)),     # cartão deslocado: marcas da esquerda fora do quadro
    (["negativo_sem_cartao"], None, None),      # só a mesa
]


def main() -> int:
    SAIDA.mkdir(parents=True, exist_ok=True)
    for velho in list(SAIDA.glob("*.jpg")) + list(SAIDA.glob("*.json")):
        velho.unlink()
    indice = []
    with tempfile.TemporaryDirectory() as t:
        molde, cartoes = cartoes_limpos(Path(t))
        for i, (tags, cq, caneta, rx, ry, rot, sombra, desf, ruido, jpeg) in enumerate(CASOS, start=1):
            rng = random.Random(1000 + i)
            cartao, mat = cartoes[cq]
            pintado, resp = pintar(cartao, molde, caneta, rng)
            foto = fotografar(pintado, rx, ry, rot, sombra, desf, ruido, rng)
            nome = f"{i:02d}_{tags[0]}"
            foto.save(SAIDA / f"{nome}.jpg", quality=jpeg)
            verdade = {"arquivo": f"{nome}.jpg", "codigo": molde["prova"]["codigo"], "matricula": mat,
                       "casos": tags, "caneta": caneta, "tilt": [rx, ry], "rotacao": rot,
                       "sombra": sombra, "desfoque": desf, "ruido": ruido, "jpeg": jpeg, "respostas": resp}
            (SAIDA / f"{nome}.json").write_text(json.dumps(verdade, ensure_ascii=False, indent=1), encoding="utf-8")
            indice.append({"imagem": f"{nome}.jpg", "verdade": f"{nome}.json"})
        for j, (tags, cq, desl) in enumerate(NEGATIVOS, start=len(CASOS) + 1):
            rng = random.Random(1000 + j)
            nome = f"{j:02d}_{tags[0]}"
            if cq is None:
                foto = mesa(2400, 3200, rng)
                mat = ""
            else:
                cartao, mat = cartoes[cq]
                pintado, _ = pintar(cartao, molde, "azul", rng)
                foto = fotografar(pintado, 4, 3, 1, 0.0, 0.5, 0, rng, deslocar=desl)
            foto.save(SAIDA / f"{nome}.jpg", quality=85)
            verdade = {"arquivo": f"{nome}.jpg", "codigo": molde["prova"]["codigo"], "matricula": mat,
                       "casos": tags, "negativo": True, "respostas": []}
            (SAIDA / f"{nome}.json").write_text(json.dumps(verdade, ensure_ascii=False, indent=1), encoding="utf-8")
            indice.append({"imagem": f"{nome}.jpg", "verdade": f"{nome}.json"})
    (SAIDA / "index.json").write_text(json.dumps(indice, indent=1) + "\n", encoding="utf-8")
    print(f"{len(indice)} imagens em {SAIDA.relative_to(RAIZ)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
