"""Desenha um cartão no PDF percorrendo os itens do Layout. Nenhuma posição literal aqui."""
from __future__ import annotations

from dataclasses import dataclass

from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth

import layout as lo
from layout import Layout, conteudo_qr, criar_qr
from modelos import Prova


@dataclass(frozen=True)
class Cartao:
    turma: str
    nome: str | None = None        # None = cartão genérico
    matricula: str | None = None


def _ajustar(txt: str, fonte: str, tam: float, larg_pt: float, minimo: float):
    while tam > minimo and stringWidth(txt, fonte, tam) > larg_pt:
        tam = max(minimo, tam - 0.25)
    if stringWidth(txt, fonte, tam) > larg_pt:
        while txt and stringWidth(txt + "…", fonte, tam) > larg_pt:
            txt = txt[:-1]
        txt = txt.rstrip() + "…"
    return txt, tam


def valor(chave: str, ct: Cartao) -> str | None:
    if chave == "auditoria":
        return f"Matrícula {ct.matricula if ct.matricula is not None else '__________'} · Turma {ct.turma}"
    return getattr(ct, chave)


def desenhar_cartao(c, L: Layout, prova: Prova, ct: Cartao, ox: float = 0.0, oy: float = 0.0,
                    altura_pagina: float = lo.PAGINA_A) -> None:
    X = lambda v: (ox + v) * mm
    Y = lambda v: (altura_pagina - (oy + v)) * mm
    def rect(x, y, w, h, **kw):
        c.rect(X(x), Y(y + h), w * mm, h * mm, **kw)

    c.setFillColorRGB(0, 0, 0)
    c.setStrokeColorRGB(0, 0, 0)
    c.setDash()
    for m in L.marcas:
        rect(m.cx - m.tamanho / 2, m.cy - m.tamanho / 2, m.tamanho, m.tamanho, stroke=0, fill=1)

    q = L.qr
    matriz = criar_qr(conteudo_qr(prova.codigo, ct.matricula or ""), q.versao).matrix
    for r, linha in enumerate(matriz):
        col = 0
        while col < len(linha):
            if linha[col]:
                ini = col
                while col < len(linha) and linha[col]:
                    col += 1
                rect(q.x + ini * q.modulo_mm, q.y + r * q.modulo_mm, (col - ini) * q.modulo_mm,
                     q.modulo_mm, stroke=0, fill=1)
            else:
                col += 1

    for it in L.itens:
        c.setFillColorRGB(0, 0, 0)
        c.setStrokeColorRGB(0, 0, 0)
        c.setDash()
        if isinstance(it, lo.Texto):
            txt = it.texto if it.texto is not None else valor(it.chave, ct)
            if txt is None:
                if it.linha_se_vazio:
                    c.setLineWidth(0.5)
                    c.line(X(it.x), Y(it.y), X(it.x + it.larg_max), Y(it.y))
                continue
            tam = it.tam
            if it.larg_max is not None:
                txt, tam = _ajustar(txt, it.fonte, tam, it.larg_max * mm, it.minimo)
            c.setFont(it.fonte, tam)
            {"e": c.drawString, "c": c.drawCentredString, "d": c.drawRightString}[it.alinha](X(it.x), Y(it.y), txt)
        elif isinstance(it, lo.Caixa):
            c.setLineWidth(it.traco_pt)
            if it.raio:
                c.roundRect(X(it.x), Y(it.y + it.a), it.l * mm, it.a * mm, it.raio * mm, stroke=1, fill=0)
            else:
                rect(it.x, it.y, it.l, it.a, stroke=1, fill=0)
        elif isinstance(it, lo.Solido):
            rect(it.x, it.y, it.l, it.a, stroke=0, fill=1)
        elif isinstance(it, lo.Linha):
            c.setLineWidth(it.traco_pt)
            c.setStrokeColorRGB(it.cinza, it.cinza, it.cinza)
            if it.tracejada:
                c.setDash(2.5, 1.8)
            c.line(X(it.x1), Y(it.y1), X(it.x2), Y(it.y2))
        elif isinstance(it, lo.Imagem):
            c.drawImage(it.caminho, X(it.x), Y(it.y + it.a), it.l * mm, it.a * mm, mask="auto")
        elif isinstance(it, lo.Circulo):
            c.setLineWidth(it.traco_pt)
            c.circle(X(it.cx), Y(it.cy), it.r * mm, stroke=1, fill=1 if it.cheio else 0)

    c.setDash()
    c.setStrokeColorRGB(0, 0, 0)
    c.setLineWidth(L.traco_bolha_pt)
    for b in L.bolhas:
        c.circle(X(b.cx), Y(b.cy), b.r * mm, stroke=1, fill=0)
    c.setFillColorRGB(0, 0, 0)
    for m in L.marcas_bloco:
        rect(m.cx - m.tamanho / 2, m.cy - m.tamanho / 2, m.tamanho, m.tamanho, stroke=0, fill=1)
