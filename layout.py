"""Fonte única de verdade da geometria dos cartões. Tudo em mm, origem no canto superior
esquerdo do CARTÃO, y para baixo. O PDF (cartao.py) e o molde JSON saem daqui.

Formatos: "a4" (cartão = folha A4) e "a6x4" (cartão A6 105 x 148,5; 4 por folha A4)."""
from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path

import segno
from PIL import Image
from reportlab.lib.units import mm as PT_POR_MM
from reportlab.pdfbase.pdfmetrics import stringWidth

from modelos import MAX_MATRICULA, ErroGabarito, Prova

VERSAO_MOLDE = 1
FORMATOS = ("a4", "a6x4")
MARCA_DIR = Path(__file__).resolve().parent / "marca"

PAGINA_L, PAGINA_A = 210.0, 297.0
A6_L, A6_A = PAGINA_L / 2, PAGINA_A / 2        # 105 x 148,5

# ---------------- A4 ----------------
MARCA = 10.0
MARCA_DIST = 12.0
AREA_X0 = MARCA_DIST + MARCA + 4          # 26
AREA_X1 = PAGINA_L - AREA_X0              # 184
AREA_Y0 = AREA_X0
QR_ALVO = 25.0
QR_ZONA_MAX = 37.0
QR_SILENCIO_MOD = 4
RAIO = 3.5
PASSO = 11.0
NUM_W = 8.0
GAP_COL = 6.0
MARCA_BLOCO = 5.0
Y_ESCOLA, Y_TITULO, Y_DATA, Y_NOME, Y_TURMA = 32.0, 40.0, 46.5, 54.0, 61.0
X_MATRICULA = 90.0
Y_INSTRUCAO, Y_AUDITORIA = 67.0, 73.0
BLOCO_Y = 77.0
BLOCO_LIMITE = 262.0
Y_RODAPE = 270.5

# ---------------- A6 ----------------
A6_MARCA = 6.0
A6_MARCA_CENTRO = 8.0                      # centro a 8 mm das bordas (borda externa a 5 mm do corte)
A6_X0, A6_X1, A6_Y0, A6_Y1 = 13.0, 92.0, 12.5, 136.0
A6_MIN_PT = 7.0
A6_RAIO, A6_PASSO = 2.1, 5.5
A6_Y_LINHA = 48.0                          # linha tracejada "não escreva abaixo"
A6_BOX_Y, A6_BOX_A = 112.0, 19.0           # quadro "Como preencher"
A6_FOLGA_BOX = 5.0                         # bolha -> quadro (mín.)
A6_PRIMEIRA_CY = 74.0


@dataclass(frozen=True)
class Retangulo:
    x: float
    y: float
    largura: float
    altura: float


@dataclass(frozen=True)
class Marca:
    cx: float
    cy: float
    tamanho: float


@dataclass(frozen=True)
class PosQR:
    x: float
    y: float
    modulos: int
    modulo_mm: float
    versao: int

    @property
    def tamanho(self) -> float:
        return self.modulos * self.modulo_mm

    @property
    def silencio(self) -> float:
        return QR_SILENCIO_MOD * self.modulo_mm

    @property
    def zona(self) -> Retangulo:
        s = self.silencio
        return Retangulo(self.x - s, self.y - s, self.tamanho + 2 * s, self.tamanho + 2 * s)


@dataclass(frozen=True)
class Bolha:
    questao: int
    alternativa: str
    cx: float
    cy: float
    r: float


# ---- itens de desenho (já posicionados; cartao.py só os percorre) ----
@dataclass(frozen=True)
class Texto:
    x: float
    y: float                       # linha de base
    fonte: str
    tam: float
    texto: str | None = None       # literal...
    chave: str | None = None       # ...ou valor dinâmico: nome | turma | matricula | auditoria
    alinha: str = "e"              # e / c / d
    larg_max: float | None = None  # reduz até `minimo` pt e depois corta com "…"
    minimo: float = 6.0
    linha_se_vazio: bool = False   # valor ausente (genérico): traça uma linha de preencher


@dataclass(frozen=True)
class Caixa:
    x: float
    y: float
    l: float
    a: float
    raio: float = 0.0
    traco_pt: float = 0.5


@dataclass(frozen=True)
class Solido:
    x: float
    y: float
    l: float
    a: float


@dataclass(frozen=True)
class Linha:
    x1: float
    y1: float
    x2: float
    y2: float
    traco_pt: float = 0.5
    tracejada: bool = False
    cinza: float = 0.0


@dataclass(frozen=True)
class Imagem:
    x: float
    y: float
    l: float
    a: float
    caminho: str


@dataclass(frozen=True)
class Circulo:
    cx: float
    cy: float
    r: float
    cheio: bool = False
    traco_pt: float = 0.6


@dataclass(frozen=True)
class Layout:
    formato: str
    cartao_l: float
    cartao_a: float
    codigo: str
    questoes: int
    alternativas: tuple[str, ...]
    marcas: tuple[Marca, ...]
    qr: PosQR
    bloco: Retangulo
    marcas_bloco: tuple[Marca, ...]
    recorte_auditoria: Retangulo
    bolhas: tuple[Bolha, ...]
    itens: tuple
    colunas: int
    linhas_por_coluna: int
    traco_bolha_pt: float = 0.6

    def bolha(self, questao: int, alternativa: str) -> Bolha:
        return self.bolhas[(questao - 1) * len(self.alternativas) + self.alternativas.index(alternativa)]

    def retangulos_conteudo(self) -> list[Retangulo]:
        """Caixas delimitadoras de tudo que não é texto nem marca de canto (para testes de geometria)."""
        out = [self.qr.zona, self.bloco]
        out += [Retangulo(m.cx - m.tamanho / 2, m.cy - m.tamanho / 2, m.tamanho, m.tamanho)
                for m in self.marcas_bloco]
        for it in self.itens:
            if isinstance(it, (Caixa, Solido, Imagem)):
                out.append(Retangulo(it.x, it.y, it.l, it.a))
            elif isinstance(it, Circulo):
                out.append(Retangulo(it.cx - it.r, it.cy - it.r, 2 * it.r, 2 * it.r))
        for b in self.bolhas:
            out.append(Retangulo(b.cx - b.r, b.cy - b.r, 2 * b.r, 2 * b.r))
        return out

    def para_molde(self) -> dict:
        r = lambda v: round(v, 3)
        ret = lambda t: {"x": r(t.x), "y": r(t.y), "largura": r(t.largura), "altura": r(t.altura)}
        mk = lambda m: {"cx": r(m.cx), "cy": r(m.cy), "tamanho": r(m.tamanho)}
        q = self.qr
        return {
            "versao": VERSAO_MOLDE,
            "formato": self.formato,
            "unidade": "mm",
            "origem": "canto superior esquerdo do cartão; x para a direita, y para baixo",
            "cartao": {"largura": r(self.cartao_l), "altura": r(self.cartao_a)},
            "prova": {"codigo": self.codigo, "questoes": self.questoes,
                      "alternativas": list(self.alternativas)},
            "marcas": [mk(m) for m in self.marcas],
            "qr": {"x": r(q.x), "y": r(q.y), "tamanho": r(q.tamanho), "modulos": q.modulos,
                   "modulo_mm": r(q.modulo_mm), "versao_qr": q.versao,
                   "silencio_mm": r(q.silencio), "zona_silencio": ret(q.zona)},
            "bloco_respostas": ret(self.bloco),
            "marcas_bloco": [mk(m) for m in self.marcas_bloco],
            "recorte_auditoria": ret(self.recorte_auditoria),
            "bolhas": [{"questao": b.questao, "alternativa": b.alternativa,
                        "cx": r(b.cx), "cy": r(b.cy), "r": r(b.r)} for b in self.bolhas],
        }


# ---------------- QR ----------------
def conteudo_qr(codigo: str, matricula: str = "") -> str:
    return f"GAB1|{codigo}|{matricula}"


def criar_qr(conteudo: str, versao: int):
    try:
        return segno.make(conteudo, error="q", version=versao, micro=False, boost_error=False)
    except Exception as e:
        raise ErroGabarito(f"Conteúdo do QR não cabe na versão {versao}: {e}")


def versao_qr(codigo: str) -> int:
    """Versão fixa por prova (calculada com a maior matrícula permitida), para o molde valer p/ todos."""
    q = segno.make(conteudo_qr(codigo, "0" * MAX_MATRICULA), error="q", micro=False, boost_error=False)
    return int(q.version)


def _posicionar_qr(codigo: str, alvo: float, zona_dir: float, zona_topo: float, zona_max: float) -> PosQR:
    """Silêncio = 4 módulos reais, nunca reduzido; se faltar espaço, reduz só o QR."""
    versao = versao_qr(codigo)
    n = criar_qr(conteudo_qr(codigo), versao).symbol_size(border=0)[0]
    modulo = min(alvo / n, zona_max / (n + 2 * QR_SILENCIO_MOD))
    modulo = math.floor(modulo * 100) / 100
    sil = QR_SILENCIO_MOD * modulo
    return PosQR(zona_dir - sil - n * modulo, zona_topo + sil, n, modulo, versao)


# ---------------- grade de bolhas (comum aos formatos) ----------------
def _grade(prova: Prova, *, x0: float, x1: float, centralizar: bool, primeira_cy: float, passo: float,
           raio: float, num_w: float, gap: float, max_linhas: int, y_letras: float,
           fonte_letra: float, fonte_num: float, num_dx: float, num_dy: float):
    alts = prova.alternativas
    na = len(alts)
    colunas = math.ceil(prova.questoes / max_linhas)
    linhas = math.ceil(prova.questoes / colunas)
    col_larg = num_w + (na - 1) * passo + 2 * raio
    largura = colunas * col_larg + (colunas - 1) * gap
    if largura > x1 - x0 + 1e-9 or max_linhas < 1:
        raise ErroGabarito(
            f"{prova.questoes} questões x {na} alternativas não cabem neste formato "
            f"(precisa de {largura:.0f} mm, há {x1 - x0:.0f} mm).")
    ini = x0 + ((x1 - x0) - largura) / 2 if centralizar else x0
    bolhas, itens = [], []
    for c in range(colunas):
        cx0 = ini + c * (col_larg + gap)
        for j, a in enumerate(alts):
            itens.append(Texto(cx0 + num_w + raio + j * passo, y_letras, "Helvetica-Bold",
                               fonte_letra, texto=a, alinha="c", minimo=fonte_letra))
    for i in range(1, prova.questoes + 1):
        c, l = divmod(i - 1, linhas)
        cx0 = ini + c * (col_larg + gap)
        cy = primeira_cy + l * passo
        itens.append(Texto(cx0 + num_w - num_dx, cy + num_dy, "Helvetica", fonte_num,
                           texto=str(i), alinha="d", minimo=fonte_num))
        for j, a in enumerate(alts):
            bolhas.append(Bolha(i, a, cx0 + num_w + raio + j * passo, cy, raio))
    return bolhas, itens, colunas, linhas, largura, ini


def _w_mm(txt: str, fonte: str, tam: float) -> float:
    return stringWidth(txt, fonte, tam) / PT_POR_MM


def _quebrar(txt: str, fonte: str, tam: float, larg: float) -> list[str]:
    linhas, atual = [], ""
    for palavra in txt.split():
        cand = f"{atual} {palavra}".strip()
        if atual and _w_mm(cand, fonte, tam) > larg:
            linhas.append(atual)
            atual = palavra
        else:
            atual = cand
    return linhas + [atual]


# ---------------- A4 ----------------
def _campo_a4(itens, rotulo, chave, x, y, larg_max, tam=11):
    itens.append(Texto(x, y, "Helvetica-Bold", tam, texto=rotulo))
    xv = x + _w_mm(rotulo, "Helvetica-Bold", tam) + 1.5
    itens.append(Texto(xv, y, "Helvetica", tam, chave=chave, larg_max=x + larg_max - xv,
                       minimo=6.0, linha_se_vazio=True))


def _layout_a4(prova: Prova) -> Layout:
    alts = prova.alternativas
    marcas = tuple(
        Marca(cx, cy, MARCA)
        for cy in (MARCA_DIST + MARCA / 2, PAGINA_A - MARCA_DIST - MARCA / 2)
        for cx in (MARCA_DIST + MARCA / 2, PAGINA_L - MARCA_DIST - MARCA / 2)
    )
    qr = _posicionar_qr(prova.codigo, QR_ALVO, AREA_X1, AREA_Y0, QR_ZONA_MAX)
    zona = qr.zona
    if zona.y + zona.altura > Y_INSTRUCAO - 4:
        raise ErroGabarito("QR não cabe no cabeçalho.")

    primeira = BLOCO_Y + 16
    max_linhas = int(math.floor((BLOCO_LIMITE - RAIO - primeira) / PASSO + 1e-9)) + 1
    bolhas, itens_grade, colunas, linhas, largura, _ = _grade(
        prova, x0=AREA_X0, x1=AREA_X1, centralizar=False, primeira_cy=primeira, passo=PASSO, raio=RAIO,
        num_w=NUM_W, gap=GAP_COL, max_linhas=max_linhas, y_letras=BLOCO_Y + 10.5, fonte_letra=10,
        fonte_num=10, num_dx=1.5, num_dy=1.3)

    x0 = AREA_X0
    nome_larg = zona.x - 3 - AREA_X0
    itens = [
        Texto(x0, Y_ESCOLA, "Helvetica-Bold", 12, texto=prova.escola),
        Texto(x0, Y_TITULO, "Helvetica-Bold", 15, texto=prova.titulo),
        Texto(x0, Y_DATA, "Helvetica", 10, texto=f"Data: {prova.data}"),
    ]
    _campo_a4(itens, "Nome:", "nome", x0, Y_NOME, nome_larg)
    _campo_a4(itens, "Turma:", "turma", x0, Y_TURMA, X_MATRICULA - 6 - x0)
    _campo_a4(itens, "Matrícula:", "matricula", X_MATRICULA, Y_TURMA, 40)
    itens += [
        Texto(x0, Y_INSTRUCAO, "Helvetica", 9.5, texto="Pinte a bolinha inteira com caneta azul ou preta."),
        Texto(x0, Y_AUDITORIA, "Courier-Bold", 9, chave="auditoria"),
        *itens_grade,
        Texto(PAGINA_L / 2, Y_RODAPE, "Helvetica", 8, alinha="c",
              texto="Imprimir em tamanho real (100%) · não dobrar"),
    ]
    altura = primeira + (linhas - 1) * PASSO + RAIO + 2 - BLOCO_Y
    bloco = Retangulo(AREA_X0, BLOCO_Y, largura + 2, altura)
    mb = Marca(AREA_X0 + MARCA_BLOCO / 2, BLOCO_Y + MARCA_BLOCO / 2, MARCA_BLOCO)
    topo = Y_AUDITORIA - 4
    recorte = Retangulo(AREA_X0, topo, AREA_X1 - AREA_X0, Y_RODAPE + 2 - topo)
    return Layout("a4", PAGINA_L, PAGINA_A, prova.codigo, prova.questoes, alts, marcas, qr, bloco,
                  (mb,), recorte, tuple(bolhas), tuple(itens), colunas, linhas)


# ---------------- A6 ----------------
def _logo(nome: str, altura: float, x: float | None, x_dir: float | None, y: float) -> Imagem:
    p = MARCA_DIR / nome
    if not p.is_file():
        raise ErroGabarito(f"Logo ausente: marca/{nome}")
    with Image.open(p) as im:
        largura = altura * im.size[0] / im.size[1]
    return Imagem(x if x is not None else x_dir - largura, y, largura, altura, str(p))


def _layout_a6(prova: Prova) -> Layout:
    alts = prova.alternativas
    c = A6_MARCA_CENTRO
    marcas = tuple(Marca(cx, cy, A6_MARCA) for cy in (c, A6_A - c) for cx in (c, A6_L - c))

    semed = _logo("semed.png", 7.0, A6_X0, None, A6_Y0 + 0.75)
    ulis = _logo("ulisses.png", 8.5, None, A6_X1, A6_Y0)
    centro = ((semed.x + semed.l) + ulis.x) / 2
    larg_centro = ulis.x - (semed.x + semed.l) - 3

    itens: list = [semed, ulis,
        Texto(centro, 17.2, "Helvetica-Bold", 11, texto="CARTÃO-RESPOSTA", alinha="c",
              larg_max=larg_centro, minimo=A6_MIN_PT),
        Texto(centro, 20.6, "Helvetica", A6_MIN_PT, texto=f"{prova.titulo} · {prova.data}", alinha="c",
              larg_max=larg_centro, minimo=A6_MIN_PT)]

    # QR (à direita) e caixas de identificação (à esquerda dele)
    qr = _posicionar_qr(prova.codigo, 18.0, A6_X1, 23.5, 24.0)
    zona = qr.zona
    caixa_dir = zona.x - 2.5
    bx, bw = A6_X0, caixa_dir - A6_X0
    y1, y2, h = 24.5, 35.5, 9.0
    larg_turma = 22.0
    itens += [
        Caixa(bx, y1, bw, h, 1.0), Caixa(bx, y2, larg_turma, h, 1.0),
        Caixa(bx + larg_turma + 2.5, y2, bw - larg_turma - 2.5, h, 1.0),
        Texto(bx + 1.5, y1 + 3.2, "Helvetica-Bold", A6_MIN_PT, texto="ESTUDANTE", minimo=A6_MIN_PT),
        Texto(bx + 1.5, y1 + 7.3, "Helvetica", 9, chave="nome", larg_max=bw - 3, minimo=A6_MIN_PT),
        Texto(bx + 1.5, y2 + 3.2, "Helvetica-Bold", A6_MIN_PT, texto="TURMA", minimo=A6_MIN_PT),
        Texto(bx + 1.5, y2 + 7.3, "Helvetica", 9, chave="turma", larg_max=larg_turma - 3, minimo=A6_MIN_PT),
        Texto(bx + larg_turma + 4.0, y2 + 3.2, "Helvetica-Bold", A6_MIN_PT, texto="MATRÍCULA",
              minimo=A6_MIN_PT),
        Texto(bx + larg_turma + 4.0, y2 + 7.3, "Courier", 9, chave="matricula",
              larg_max=bw - larg_turma - 5.5, minimo=A6_MIN_PT),
        Linha(A6_X0, A6_Y_LINHA, A6_X1, A6_Y_LINHA, 0.4, tracejada=True, cinza=0.2),
        Texto((A6_X0 + A6_X1) / 2, A6_Y_LINHA + 4.5, "Helvetica-Bold", A6_MIN_PT, alinha="c",
              texto="NÃO ESCREVA ABAIXO DESTA LINHA", minimo=A6_MIN_PT),
        Texto(A6_X0, A6_Y_LINHA + 9.4, "Courier-Bold", A6_MIN_PT, chave="auditoria", minimo=A6_MIN_PT),
    ]
    if zona.y + zona.altura > A6_Y_LINHA - 1:
        raise ErroGabarito("QR não cabe no cabeçalho do cartão A6.")

    # Bloco de respostas
    y_titulo = A6_Y_LINHA + 15.2
    marca_b = Marca(A6_X0 + 2.0, y_titulo - 2.0, 4.0)
    itens += [Texto(A6_X0 + 6.0, y_titulo, "Helvetica-Bold", 8, texto=prova.bloco.upper(), minimo=A6_MIN_PT)]
    limite_cy = A6_BOX_Y - A6_FOLGA_BOX - A6_RAIO
    max_linhas = int(math.floor((limite_cy - A6_PRIMEIRA_CY) / A6_PASSO + 1e-9)) + 1
    bolhas, itens_grade, colunas, linhas, largura, ini = _grade(
        prova, x0=A6_X0, x1=A6_X1, centralizar=True, primeira_cy=A6_PRIMEIRA_CY, passo=A6_PASSO,
        raio=A6_RAIO, num_w=5.5, gap=8.0, max_linhas=max_linhas, y_letras=A6_PRIMEIRA_CY - 4.5,
        fonte_letra=A6_MIN_PT, fonte_num=A6_MIN_PT, num_dx=1.2, num_dy=0.9)
    itens += itens_grade
    fim_bolhas = A6_PRIMEIRA_CY + (linhas - 1) * A6_PASSO + A6_RAIO
    bloco = Retangulo(A6_X0, y_titulo - 4.0 - 0.5, A6_X1 - A6_X0, fim_bolhas + 1.5 - (y_titulo - 4.5))

    # Quadro "Como preencher" (fora do molde)
    by = A6_BOX_Y
    itens.append(Caixa(A6_X0, by, A6_X1 - A6_X0, A6_BOX_A, 1.0))
    itens.append(Texto(A6_X0 + 2.0, by + 4.0, "Helvetica-Bold", 7.5, texto="Como preencher", minimo=A6_MIN_PT))
    texto = "Caneta azul ou preta. Pinte toda a bolinha. Só uma por questão."
    ty = by + 7.6
    for ln in _quebrar(texto, "Helvetica", A6_MIN_PT, A6_X1 - A6_X0 - 4.0):
        itens.append(Texto(A6_X0 + 2.0, ty, "Helvetica", A6_MIN_PT, texto=ln, minimo=A6_MIN_PT))
        ty += 3.0
    ey = by + A6_BOX_A - 3.6
    xe = A6_X0 + 2.0
    itens.append(Texto(xe, ey + 0.9, "Helvetica-Bold", A6_MIN_PT, texto="CERTO", minimo=A6_MIN_PT))
    xc = xe + _w_mm("CERTO", "Helvetica-Bold", A6_MIN_PT) + 2.0 + A6_RAIO
    for k, cheio in enumerate((False, True, False)):
        itens.append(Circulo(xc + k * A6_PASSO, ey, A6_RAIO, cheio))
    xe2 = xc + 2 * A6_PASSO + A6_RAIO + 6.0
    itens.append(Texto(xe2, ey + 0.9, "Helvetica-Bold", A6_MIN_PT, texto="ERRADO", minimo=A6_MIN_PT))
    xr = xe2 + _w_mm("ERRADO", "Helvetica-Bold", A6_MIN_PT) + 2.0 + A6_RAIO
    itens.append(Circulo(xr, ey, A6_RAIO, False))
    d = A6_RAIO * 0.62
    itens += [Linha(xr - d, ey - d, xr + d, ey + d, 0.6), Linha(xr - d, ey + d, xr + d, ey - d, 0.6),
              Circulo(xr + A6_PASSO, ey, A6_RAIO, True), Circulo(xr + 2 * A6_PASSO, ey, A6_RAIO, True)]
    itens.append(Texto((A6_X0 + A6_X1) / 2, A6_Y1 - 0.5, "Helvetica", A6_MIN_PT, alinha="c",
                       texto="Imprimir em tamanho real (100%)", minimo=A6_MIN_PT))

    topo = A6_Y_LINHA + 1.5
    recorte = Retangulo(A6_X0, topo, A6_X1 - A6_X0, A6_Y1 - topo)
    return Layout("a6x4", A6_L, A6_A, prova.codigo, prova.questoes, alts, marcas, qr, bloco,
                  (marca_b,), recorte, tuple(bolhas), tuple(itens), colunas, linhas)


def calcular_layout(prova: Prova, formato: str = "a4") -> Layout:
    if formato == "a4":
        return _layout_a4(prova)
    if formato == "a6x4":
        return _layout_a6(prova)
    raise ErroGabarito(f"Formato desconhecido: {formato} (use {' ou '.join(FORMATOS)}).")
