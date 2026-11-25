import json
import tempfile
import unittest
from pathlib import Path

import layout as lo
import montagem
from cartao import Cartao, _ajustar
from gerar_cartoes import main
from modelos import (ErroGabarito, Prova, alunos_da_turma, carregar_prova, chave_turma,
                     ler_alunos, slug_turma)

RAIZ = Path(__file__).resolve().parent.parent
PROVA = carregar_prova(RAIZ / "provas/teste-mat-10q.json")


def prova(q, alts):
    return Prova("t-x", "T", "E", "01/01/2026", q, tuple(alts))


class Turma(unittest.TestCase):
    def test_normalizacao(self):
        self.assertEqual(chave_turma("9º C"), chave_turma("9ºC"))
        self.assertEqual(chave_turma("9º C"), chave_turma("9° c"))
        self.assertNotEqual(chave_turma("9º C"), chave_turma("9º D"))
        self.assertEqual(slug_turma("9° c"), "9c")

    def test_csv_exemplo(self):
        alunos = ler_alunos(RAIZ / "dados/exemplo.csv")
        ativos, ign = alunos_da_turma(alunos, "9ºc")
        self.assertEqual([a.matricula for a in ativos], ["2023000002", "2023000003", "2023000001"])  # Dois, Três, Um
        self.assertEqual(ign, 0)

    def test_transferido_e_turma_vazia(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "a.csv"
            p.write_text("Nome;Matricula;Turma;Situacao\nAluno Teste Dois;2023000002;1A;\n"
                         "Aluno Teste Um;2023000001;1A;\nAluno Teste Tres;2023000003;1A;Transferido\n"
                         "Aluno Teste Quatro;2023000004;1B;Transferido\n", encoding="utf-8")
            al = ler_alunos(p)
            ativos, ign = alunos_da_turma(al, "1 a")
            self.assertEqual([a.matricula for a in ativos], ["2023000002", "2023000001"])  # Dois, Um
            self.assertEqual(ign, 1)
            with self.assertRaises(ErroGabarito):
                alunos_da_turma(al, "1B")
            with self.assertRaises(ErroGabarito):
                alunos_da_turma(al, "9Z")


class Geometria(unittest.TestCase):
    def test_marcas_e_bolhas(self):
        L = lo.calcular_layout(PROVA)
        for m in L.marcas:
            self.assertEqual(m.tamanho, 10)
            self.assertIn(m.cx - 5, (12, 188)); self.assertIn(m.cy - 5, (12, 275))
        self.assertEqual(len(L.bolhas), 40)
        b1, b2 = L.bolha(1, "A"), L.bolha(1, "B")
        self.assertAlmostEqual(b2.cx - b1.cx, 11)
        self.assertAlmostEqual(L.bolha(2, "A").cy - b1.cy, 11)
        self.assertEqual(b1.r, 3.5)

    def test_qr_silencio_e_posicao(self):
        L = lo.calcular_layout(PROVA)
        q = L.qr
        self.assertAlmostEqual(q.silencio, 4 * q.modulo_mm)
        self.assertTrue(24 <= q.tamanho <= 25)
        z = q.zona
        self.assertLessEqual(z.x + z.largura, lo.AREA_X1 + 1e-9)
        self.assertGreaterEqual(z.y, lo.AREA_Y0)
        self.assertLess(z.y + z.altura, L.bloco.y)  # zona não toca o bloco

    def test_tudo_dentro_da_area(self):
        L = lo.calcular_layout(prova(30, "ABCDE"))
        self.assertGreater(L.colunas, 1)
        for b in L.bolhas:
            self.assertGreaterEqual(b.cx - b.r, lo.AREA_X0 - 1e-9)
            self.assertLessEqual(b.cx + b.r, lo.AREA_X1 + 1e-9)
            self.assertLessEqual(b.cy + b.r, lo.BLOCO_LIMITE + 1e-9)
        self.assertEqual(len({(b.questao, b.alternativa) for b in L.bolhas}), 150)

    def test_nao_cabe(self):
        with self.assertRaises(ErroGabarito):
            lo.calcular_layout(prova(200, "ABCD"))

    def test_molde_json(self):
        m = lo.calcular_layout(PROVA).para_molde()
        json.dumps(m)
        for k in ("marcas", "qr", "bloco_respostas", "marcas_bloco", "formato", "cartao", "recorte_auditoria", "bolhas"):
            self.assertIn(k, m)
        self.assertEqual(len(m["bolhas"]), 40)

    def test_conteudo_qr(self):
        self.assertEqual(lo.conteudo_qr("p1", "2023000001"), "GAB1|p1|2023000001")
        self.assertEqual(lo.conteudo_qr("p1"), "GAB1|p1|")
        v = lo.versao_qr("teste-mat-10q")
        q = lo.criar_qr(lo.conteudo_qr("teste-mat-10q", "2023000001"), v)
        self.assertEqual(q.error, "Q")


class Cli(unittest.TestCase):
    def test_turma_sem_ativos_nao_gera_pdf(self):
        with tempfile.TemporaryDirectory() as d:
            r = main(["--prova", str(RAIZ / "provas/teste-mat-10q.json"), "--alunos",
                      str(RAIZ / "dados/exemplo.csv"), "--turma", "7º Z", "--saida", d, "--moldes", d + "/m"])
            self.assertEqual(r, 1)
            self.assertEqual(list(Path(d).iterdir()), [])

    def test_lote(self):
        with tempfile.TemporaryDirectory() as d:
            lote = Path(d) / "l.json"
            lote.write_text(json.dumps([
                {"prova": str(RAIZ / "provas/teste-mat-10q.json"), "turma": "9º C"},
                {"prova": str(RAIZ / "provas/teste-mat-10q-b.json"), "turma": "9° d"}]))
            r = main(["--alunos", str(RAIZ / "dados/exemplo.csv"), "--lote", str(lote),
                      "--saida", d + "/o", "--moldes", d + "/m"])
            self.assertEqual(r, 0)
            self.assertEqual(json.loads(Path(d, "m/index.json").read_text()), ["teste-mat-10q", "teste-mat-10q-b"])
            self.assertEqual(Path(d, "m/teste-mat-10q_molde.json").read_text(),
                             Path(d, "o/teste-mat-10q_molde.json").read_text())
            nomes = {p.name for p in Path(d, "o").iterdir()}
            self.assertTrue({"teste-mat-10q_9c.pdf", "teste-mat-10q-b_9d.pdf",
                             "teste-mat-10q_molde.json", "teste-mat-10q-b_molde.json"} <= nomes)


class A6(unittest.TestCase):
    def setUp(self):
        self.L = lo.calcular_layout(PROVA, "a6x4")

    def test_marcas_a_5mm_do_corte(self):
        for m in self.L.marcas:
            self.assertEqual(m.tamanho, 6)
            self.assertAlmostEqual(min(m.cx, 105 - m.cx) - 3, 5)
            self.assertAlmostEqual(min(m.cy, 148.5 - m.cy) - 3, 5)

    def test_nada_fora_do_quarto_nem_da_area(self):
        for r in self.L.retangulos_conteudo():
            self.assertGreaterEqual(r.x, 13 - 1e-6); self.assertLessEqual(r.x + r.largura, 92 + 1e-6)
            self.assertGreaterEqual(r.y, 12.5 - 1e-6); self.assertLessEqual(r.y + r.altura, 136 + 1e-6)
        for m in self.L.marcas:
            self.assertTrue(0 <= m.cx - 3 and m.cx + 3 <= 105 and 0 <= m.cy - 3 and m.cy + 3 <= 148.5)

    def test_bolhas_e_colunas(self):
        L = self.L
        self.assertEqual((L.colunas, L.linhas_por_coluna), (2, 5))
        self.assertEqual(L.bolha(1, "A").r, 2.1)
        self.assertAlmostEqual(L.bolha(1, "B").cx - L.bolha(1, "A").cx, 5.5)
        self.assertAlmostEqual(L.bolha(2, "A").cy - L.bolha(1, "A").cy, 5.5)
        self.assertEqual(L.bolha(5, "A").cx, L.bolha(1, "A").cx)
        self.assertGreater(L.bolha(6, "A").cx, L.bolha(5, "D").cx)       # 6–10 na 2ª coluna
        self.assertEqual(L.bolha(6, "A").cy, L.bolha(1, "A").cy)
        esq = L.bolha(1, "A").cx - 2.1 - 5.5          # inclui a faixa do número da questão
        dir_ = L.bolha(10, "D").cx + 2.1
        self.assertAlmostEqual((esq + dir_) / 2, 52.5, delta=0.01)       # bloco centralizado em 13–92

    def test_quadro_como_preencher_5mm_abaixo(self):
        caixas = [i for i in self.L.itens if isinstance(i, lo.Caixa) and i.a > 15]
        self.assertEqual(len(caixas), 1)
        ultima = max(b.cy + b.r for b in self.L.bolhas)
        self.assertGreaterEqual(caixas[0].y - ultima, 5)

    def test_qr_silencio_e_sem_sobreposicao(self):
        q = self.L.qr
        self.assertAlmostEqual(q.silencio, 4 * q.modulo_mm)
        self.assertTrue(17 <= q.tamanho <= 18.01)
        z = q.zona
        for i in self.L.itens:
            if isinstance(i, lo.Caixa):
                self.assertTrue(i.x + i.l <= z.x or i.y + i.a <= z.y or i.y >= z.y + z.altura)
        self.assertLess(z.y + z.altura, 48)

    def test_fonte_minima_7pt(self):
        for i in self.L.itens:
            if isinstance(i, lo.Texto):
                self.assertGreaterEqual(i.tam, 7)
                self.assertGreaterEqual(i.minimo, 7)

    def test_nome_longo_reduz_e_corta(self):
        txt, tam = _ajustar("Aluno Teste " + "Sobrenome " * 12, "Helvetica", 9, 51 * 2.8346, 7)
        self.assertEqual(tam, 7)
        self.assertTrue(txt.endswith("…"))
        txt, tam = _ajustar("Aluno Teste Um", "Helvetica", 9, 51 * 2.8346, 7)
        self.assertEqual((txt, tam), ("Aluno Teste Um", 9))

    def test_molde_relativo_ao_cartao(self):
        m = self.L.para_molde()
        self.assertEqual(m["formato"], "a6x4")
        self.assertEqual(m["cartao"], {"largura": 105, "altura": 148.5})
        self.assertEqual(len(m["marcas_bloco"]), 1)
        self.assertAlmostEqual(m["recorte_auditoria"]["y"], 49.5)
        self.assertTrue(all(0 < b["cx"] < 105 and 0 < b["cy"] < 148.5 for b in m["bolhas"]))
        self.assertEqual(lo.calcular_layout(PROVA).para_molde()["formato"], "a4")

    def test_nao_cabe(self):
        with self.assertRaises(ErroGabarito):
            lo.calcular_layout(prova(30, "ABCD"), "a6x4")
        with self.assertRaises(ErroGabarito):
            lo.calcular_layout(PROVA, "a5")


class Montagem(unittest.TestCase):
    def test_ordem_cortar_e_empilhar(self):
        pag = montagem.sequencia_paginas(list(range(10)))
        self.assertEqual(len(pag), 3)
        self.assertEqual(pag, [[0, 3, 6, 9], [1, 4, 7, None], [2, 5, 8, None]])
        # pilha q = cartões da posição q em ordem de página; pilhas 0,1,2,3 juntas = ordem original
        pilhas = [[p[q] for p in pag if p[q] is not None] for q in range(4)]
        self.assertEqual([x for pl in pilhas for x in pl], list(range(10)))
        self.assertEqual(len(montagem.sequencia_paginas(list(range(13)))), 4)

    def test_genericos_completam_ultima_pagina(self):
        from modelos import Aluno
        al = [Aluno(f"Aluno Teste {i}", f"20230000{i:02d}", "9º C") for i in range(1, 11)]
        cs = montagem.completar_com_genericos(al, "9º C", 3)
        self.assertEqual(len(cs), 16)
        self.assertEqual(sum(c.nome is None for c in cs), 6)
        self.assertTrue(all(c.nome is None for c in cs[10:]))
        pag = montagem.sequencia_paginas(cs)
        self.assertTrue(all(q is not None for p in pag for q in p))
        pilhas = [[p[q] for p in pag] for q in range(4)]
        ordem = [c for pl in pilhas for c in pl]
        self.assertEqual(ordem, cs)

    def test_linhas_de_corte_5mm_das_marcas(self):
        L = lo.calcular_layout(PROVA, "a6x4")
        for (ox, oy) in montagem.ORIGENS:
            for m in L.marcas:
                x, y = ox + m.cx, oy + m.cy
                self.assertGreaterEqual(abs(x - montagem.LINHAS_CORTE_X) - 3, 5 - 1e-9)
                self.assertGreaterEqual(abs(y - montagem.LINHAS_CORTE_Y) - 3, 5 - 1e-9)

    def test_pdf_a6_paginas(self):
        with tempfile.TemporaryDirectory() as d:
            r = main(["--prova", str(RAIZ / "provas/teste-mat-10q.json"), "--alunos",
                      str(RAIZ / "dados/exemplo.csv"), "--turma", "9º C", "--formato", "a6x4", "--saida", d, "--moldes", d + "/m"])
            self.assertEqual(r, 0)
            self.assertEqual(Path(d, "teste-mat-10q_9c.pdf").read_bytes().count(b"/Type /Page\n"), 2)
            self.assertEqual(json.loads(Path(d, "teste-mat-10q_molde.json").read_text())["formato"], "a6x4")

    def test_lote_real_a6x4(self):
        lote = json.loads((RAIZ / "lote-2026-11-25.json").read_text(encoding="utf-8"))
        for x in lote:
            self.assertEqual(x["formato"], "a6x4")
            p = carregar_prova(RAIZ / x["prova"])
            self.assertEqual(p.bloco, "Matemática")
            L = lo.calcular_layout(p, "a6x4")        # também exige os logos em marca/
            self.assertEqual(L.formato, "a6x4")


class Moldes(unittest.TestCase):
    def test_molde_versionado_bate_com_o_layout(self):
        """moldes/ (usado pelo leitor) tem de ser exatamente o que layout.py calcula hoje."""
        idx = json.loads((RAIZ / "moldes/index.json").read_text(encoding="utf-8"))
        self.assertIn("teste-mat-10q", idx)
        for cod in idx:
            molde = json.loads((RAIZ / f"moldes/{cod}_molde.json").read_text(encoding="utf-8"))
            p = carregar_prova(RAIZ / f"provas/{cod}.json")
            self.assertEqual(molde, json.loads(json.dumps(lo.calcular_layout(p, molde["formato"]).para_molde())))

    def test_sinteticos_so_ficticios(self):
        for j in (RAIZ / "testes/sinteticos").glob("[0-9]*.json"):
            d = json.loads(j.read_text(encoding="utf-8"))
            self.assertIn(d["matricula"], ("", "2023000001", "2023000002", "2023000003"))


class ProvasReais(unittest.TestCase):
    def test_carregam(self):
        for t in ("8c", "8d", "9c", "9d"):
            p = carregar_prova(RAIZ / f"provas/mat-2026-11-25-{t}.json")
            self.assertEqual((p.escola, p.data, p.questoes), ("UMEF Ulisses Álvares", "25/11/2026", 10))
            self.assertEqual(p.codigo, f"mat-2026-11-25-{t}")
        lote = json.loads((RAIZ / "lote-2026-11-25.json").read_text(encoding="utf-8"))
        self.assertEqual([x["turma"] for x in lote], ["8C", "8D", "9C", "9D"])
        for x in lote:
            carregar_prova(RAIZ / x["prova"])


if __name__ == "__main__":
    unittest.main()
