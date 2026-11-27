// Testes da correção (leitor/corrigir.js). Matrículas fictícias.  node --test tests/corrigir.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const C = createRequire(import.meta.url)("../leitor/corrigir.js");
const ALTS = ["A", "B", "C", "D"];
const reg = (matricula, respostas, prova = "teste-mat-10q") => ({ matricula, prova, respostas, acertos: null, total: null, hora: "2026-11-26T10:00:00Z" });

test("chave: aceita minúsculas e separadores; recusa tamanho e letra errados", () => {
  assert.deepEqual(C.lerChave("bdac abcd-ab", 10, ALTS).chave, [..."BDACABCDAB"]);
  assert.match(C.lerChave("BDAC", 10, ALTS).erro, /10 letras; há 4/);
  assert.match(C.lerChave("BDACABCDABA", 10, ALTS).erro, /há 11/);
  assert.match(C.lerChave("BDACABCDAE", 10, ALTS).erro, /inválida/);
});

test("dupla, em branco e dúvida contam como erro", () => {
  const marcas = [
    { estado: "marcada", letra: "A" }, { estado: "marcada", letra: "B" }, { estado: "branco" },
    { estado: "dupla", letras: ["A", "C"] }, { estado: "duvida", letras: ["A"] },
  ].map(C.codificar);
  assert.deepEqual(marcas, ["A", "B", "", "A+C", "?"]);
  const r = C.corrigir(marcas, ["A", "C", "A", "A", "A"]);
  assert.equal(r.acertos, 1); assert.equal(r.total, 5);
  assert.deepEqual(r.certas, [true, false, false, false, false]);
  assert.equal(C.corrigir([..."BDACABCDAB"], [..."BDACABCDAB"]).acertos, 10);
});

test("matrícula válida", () => {
  assert.ok(C.matriculaValida("2023000001"));
  for (const m of ["", "abc", "12", "2023 000001", null]) assert.ok(!C.matriculaValida(m));
});

test("repetida só substitui se pedido; provas diferentes não se misturam", () => {
  let l = C.gravar([], reg("2023000001", ["A"]), false).lista;
  const r = C.gravar(l, reg("2023000001", ["B"]), false);
  assert.ok(r.repetida && !r.gravou); assert.deepEqual(r.lista[0].respostas, ["A"]);
  const s = C.gravar(l, reg("2023000001", ["B"]), true);
  assert.equal(s.lista.length, 1); assert.deepEqual(s.lista[0].respostas, ["B"]); assert.deepEqual(l[0].respostas, ["A"]);
  assert.equal(C.gravar(s.lista, reg("2023000001", ["C"], "outra"), false).lista.length, 2);
});

test("situação de cada questão", () => {
  assert.deepEqual([["A", "A"], ["C", "A"], ["", "A"], ["A+B", "A"], ["?", "A"], ["A", null]].map(([m, c]) => C.situacao(m, c)),
    ["acerto", "erro", "nula", "nula", "nula", "neutra"]);
});

test("recalcular com a chave nova e exportar CSV com C1..Cn e % acerto (uma prova)", () => {
  const l = [reg("2023000001", ["A", "", "A+B"]), reg("2023000002", ["A", "B", "?"]), reg("2023000003", ["B", "B", "C"])];
  const chave = ["A", "B", "C"];
  const n = C.recalcular(l, "teste-mat-10q", chave);
  assert.deepEqual(n.map((r) => r.acertos), [1, 2, 2]);
  assert.equal(C.csv(n, () => chave), "matricula,prova,Q1,Q2,Q3,C1,C2,C3,acertos,total\r\n" +
    "2023000001,teste-mat-10q,A,,A+B,1,0,0,1,3\r\n" +
    "2023000002,teste-mat-10q,A,B,?,1,1,0,2,3\r\n" +
    "2023000003,teste-mat-10q,B,B,C,0,1,1,2,3\r\n" +
    "% acerto,,,,,67,67,33,,\r\n");
});

test("CSV com várias provas: uma linha % acerto por prova; sem chave, C vazio e sem linha", () => {
  const chaves = { p1: ["A", "B"], p2: ["B", "B"] };
  const chaveDe = (p) => chaves[p] || null;
  let l = [reg("2023000001", ["A", "B"], "p1"), reg("2023000002", ["A", "B"], "p2"), reg("2023000003", ["A", "C"], "sem-chave")];
  for (const p of ["p1", "p2", "sem-chave"]) l = C.recalcular(l, p, chaveDe(p));
  assert.equal(C.csv(l, chaveDe), "matricula,prova,Q1,Q2,C1,C2,acertos,total\r\n" +
    "2023000001,p1,A,B,1,1,2,2\r\n" +
    "2023000002,p2,A,B,0,1,1,2\r\n" +
    "2023000003,sem-chave,A,C,,,,\r\n" +
    "% acerto,p1,,,100,100,,\r\n" +
    "% acerto,p2,,,0,100,,\r\n");
  assert.ok(!C.csv([l[2]], chaveDe).includes("% acerto"));
});
