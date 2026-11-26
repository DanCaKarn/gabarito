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

test("recalcular com a chave nova e exportar CSV", () => {
  const l = [reg("2023000001", ["A", "", "A+B"]), reg("2023000002", ["A", "B", "?"]), reg("2023000003", ["A", "B", "C"], "sem-chave")];
  const n = C.recalcular(l, "teste-mat-10q", ["A", "B", "C"]);
  assert.deepEqual(n.map((r) => r.acertos), [1, 2, null]);
  assert.equal(C.csv(n), "matricula,prova,Q1,Q2,Q3,acertos,total\r\n" +
    "2023000001,teste-mat-10q,A,,A+B,1,3\r\n2023000002,teste-mat-10q,A,B,?,2,3\r\n2023000003,sem-chave,A,B,C,,\r\n");
});
