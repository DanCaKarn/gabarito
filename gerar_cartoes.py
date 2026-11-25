"""Gera cartões-resposta em PDF (um aluno por página) + molde JSON.

Uso:
  uv run gerar_cartoes.py --prova provas/X.json --alunos dados/exemplo.csv --turma "9º C" [--genericos 3]
  uv run gerar_cartoes.py --alunos dados/exemplo.csv --lote lote-exemplo.json
O terminal mostra só contagens (LGPD): nunca nomes nem matrículas.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

import conferencia
import montagem
from cartao import Cartao, desenhar_cartao
from layout import FORMATOS, PAGINA_A, PAGINA_L, calcular_layout
from modelos import ErroGabarito, alunos_da_turma, carregar_prova, ler_alunos, slug_turma

RAIZ = Path(__file__).resolve().parent


def gerar_pdf(caminho: Path, L, prova, turma: str, alunos, genericos: int) -> tuple[int, int, int]:
    """Devolve (cartões, páginas, genéricos)."""
    c = canvas.Canvas(str(caminho), pagesize=(PAGINA_L * mm, PAGINA_A * mm), invariant=1)
    c.setTitle(f"Cartões {prova.codigo}")
    if L.formato == "a6x4":
        cartoes = montagem.completar_com_genericos(alunos, turma, genericos)
        paginas = montagem.sequencia_paginas(cartoes)
        for quatro in paginas:
            montagem.desenhar_folha(c, L, prova, quatro)
            c.showPage()
    else:
        cartoes = [Cartao(turma, a.nome, a.matricula) for a in alunos] + [Cartao(turma)] * genericos
        paginas = cartoes
        for ct in cartoes:
            desenhar_cartao(c, L, prova, ct)
            c.showPage()
    c.save()
    return len(cartoes), len(paginas), len(cartoes) - len(alunos)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--prova")
    ap.add_argument("--turma")
    ap.add_argument("--lote", help="JSON: lista de {prova, turma[, formato]}")
    ap.add_argument("--formato", choices=FORMATOS, default="a4",
                    help="a4 (um cartão por folha) ou a6x4 (4 cartões A6 por folha); no lote, o campo "
                         "'formato' do par tem prioridade")
    ap.add_argument("--alunos", required=True)
    ap.add_argument("--genericos", type=int, default=3)
    ap.add_argument("--saida", default=str(RAIZ / "saida"))
    ap.add_argument("--moldes", default=str(RAIZ / "moldes"),
                    help="pasta onde cada molde também é gravado (versionada: o molde não tem dados pessoais)")
    a = ap.parse_args(argv)
    try:
        if a.lote:
            if a.prova or a.turma:
                raise ErroGabarito("Use --lote OU --prova/--turma, não os dois.")
            try:
                pares = json.loads(Path(a.lote).read_text(encoding="utf-8"))
                pares = [(p["prova"], p["turma"], p.get("formato") or a.formato) for p in pares]
            except (OSError, ValueError, KeyError, TypeError) as e:
                raise ErroGabarito(f"Lote inválido: {e}")
        elif a.prova and a.turma:
            pares = [(a.prova, a.turma, a.formato)]
        else:
            raise ErroGabarito("Informe --prova e --turma, ou --lote.")
        if a.genericos < 0:
            raise ErroGabarito("--genericos deve ser >= 0.")
        if not pares:
            raise ErroGabarito("Lote vazio.")

        todos = ler_alunos(a.alunos)
        # valida tudo antes de gerar qualquer arquivo
        planos = []
        for caminho, turma, formato in pares:
            prova = carregar_prova(caminho)
            ativos, ign = alunos_da_turma(todos, turma)
            planos.append((prova, calcular_layout(prova, formato), turma, ativos, ign))
        destinos = [f"{p.codigo}_{slug_turma(t)}" for p, _, t, _, _ in planos]
        if len(set(destinos)) != len(destinos):
            raise ErroGabarito("O lote tem pares prova/turma repetidos.")

        saida = Path(a.saida)
        saida.mkdir(parents=True, exist_ok=True)
        pasta_moldes = Path(a.moldes)
        pasta_moldes.mkdir(parents=True, exist_ok=True)
        moldes_feitos, conf_feitas = set(), set()
        for (prova, L, turma, ativos, ign), dest in zip(planos, destinos):
            pdf = saida / f"{dest}.pdf"
            n, paginas, gen = gerar_pdf(pdf, L, prova, turma, ativos, a.genericos)
            molde = saida / f"{prova.codigo}_molde.json"
            if prova.codigo not in moldes_feitos:
                molde.write_text(json.dumps(L.para_molde(), ensure_ascii=False, indent=2), encoding="utf-8")
                (pasta_moldes / molde.name).write_text(molde.read_text(encoding="utf-8"), encoding="utf-8")
                moldes_feitos.add(prova.codigo)
            if prova.codigo not in conf_feitas:
                conferencia.gerar_conferencia(pdf, molde, saida / f"{prova.codigo}_conferencia.png")
                conferencia.renderizar_pagina1(pdf, saida / f"{prova.codigo}_pagina1.png")
                conf_feitas.add(prova.codigo)
            print(f"[{prova.codigo}] turma {turma} ({L.formato}): {len(ativos)} alunos + {gen} genéricos "
                  f"= {n} cartões em {paginas} páginas ({ign} ignorados por situação) -> {pdf.name}")
        if moldes_feitos:   # índice para o seletor do leitor
            codigos = sorted(p.name[: -len("_molde.json")] for p in pasta_moldes.glob("*_molde.json"))
            (pasta_moldes / "index.json").write_text(json.dumps(codigos, ensure_ascii=False, indent=2) + "\n",
                                                     encoding="utf-8")
    except ErroGabarito as e:
        print(f"ERRO: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
