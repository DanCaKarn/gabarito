"""Montagem do formato a6x4: 4 cartões por folha A4, ordem 'cortar e empilhar', linhas de corte."""
from __future__ import annotations

import math

from reportlab.lib.units import mm

from cartao import Cartao, desenhar_cartao
from layout import A6_A, A6_L, PAGINA_A, PAGINA_L, Layout
from modelos import Aluno, Prova


def completar_com_genericos(alunos: list[Aluno], turma: str, minimo_genericos: int) -> list[Cartao]:
    """Alunos (já ordenados) + genéricos no fim; a última página é completada com genéricos."""
    n = len(alunos) + minimo_genericos
    total = math.ceil(n / 4) * 4 if n else 0
    return [Cartao(turma, a.nome, a.matricula) for a in alunos] + [Cartao(turma)] * (total - len(alunos))


def sequencia_paginas(cartoes: list) -> list[list]:
    """P = ceil(N/4) páginas; posição q (0=sup.esq,1=sup.dir,2=inf.esq,3=inf.dir) da página p
    recebe o cartão q*P + p (None se não existir)."""
    n = len(cartoes)
    p_total = math.ceil(n / 4)
    return [[cartoes[q * p_total + p] if q * p_total + p < n else None for q in range(4)]
            for p in range(p_total)]


ORIGENS = ((0.0, 0.0), (A6_L, 0.0), (0.0, A6_A), (A6_L, A6_A))
CORTE_CINZA = 0.3
LINHAS_CORTE_X = A6_L      # linha vertical
LINHAS_CORTE_Y = A6_A      # linha horizontal


def _tesoura(c, x, y, angulo):
    """Tesourinha vetorial (~4,5 mm) em (x, y) mm, apontando na direção `angulo` (graus, y para cima)."""
    c.saveState()
    c.translate(x * mm, (PAGINA_A - y) * mm)
    c.rotate(angulo)
    s = 0.72 * mm
    c.setStrokeColorRGB(CORTE_CINZA, CORTE_CINZA, CORTE_CINZA)
    c.setLineWidth(0.5)
    c.setDash()
    c.circle(-2.4 * s, 1.0 * s, 0.9 * s)
    c.circle(-2.4 * s, -1.0 * s, 0.9 * s)
    c.line(-1.5 * s, 1.0 * s, 2.5 * s, -0.3 * s)
    c.line(-1.5 * s, -1.0 * s, 2.5 * s, 0.3 * s)
    c.restoreState()


def desenhar_linhas_corte(c) -> None:
    c.saveState()
    c.setStrokeColorRGB(CORTE_CINZA, CORTE_CINZA, CORTE_CINZA)
    c.setLineWidth(0.25)
    c.setDash(2.5, 2.0)
    c.line(LINHAS_CORTE_X * mm, 0, LINHAS_CORTE_X * mm, PAGINA_A * mm)
    c.line(0, (PAGINA_A - LINHAS_CORTE_Y) * mm, PAGINA_L * mm, (PAGINA_A - LINHAS_CORTE_Y) * mm)
    c.restoreState()
    _tesoura(c, LINHAS_CORTE_X, 10.0, -90)      # vertical: ponta de cima, apontando para baixo
    _tesoura(c, 10.0, LINHAS_CORTE_Y, 0)        # horizontal: ponta da esquerda, apontando para a direita


def desenhar_folha(c, L: Layout, prova: Prova, quatro: list) -> None:
    for (ox, oy), ct in zip(ORIGENS, quatro):
        if ct is not None:
            desenhar_cartao(c, L, prova, ct, ox, oy, PAGINA_A)
    desenhar_linhas_corte(c)
