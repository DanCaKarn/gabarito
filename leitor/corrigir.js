/* corrigir.js — correção das leituras (MODO DE TESTE no aparelho; no sistema final a planilha corrige).
 * Lógica pura, sem DOM nem armazenamento. Global `Corrigir` no navegador, module.exports no node. Sem nomes de alunos. */
(function (raiz, fabrica) {
  if (typeof module === "object" && module.exports) module.exports = fabrica();
  else raiz.Corrigir = fabrica();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // "bdac abcdab" → ["B","D",...]. Aceita espaços, vírgulas, ponto, hífen. Exige exatamente n letras válidas.
  function lerChave(texto, n, alternativas) {
    const s = String(texto || "").toUpperCase().replace(/[\s,;.\-]/g, "");
    const ruim = [...s].find((c) => !alternativas.includes(c));
    if (ruim) return { erro: `Letra inválida: “${ruim}” (use ${alternativas.join(", ")}).` };
    if (s.length !== n) return { erro: `A chave precisa de ${n} letras; há ${s.length}.` };
    return { chave: [...s] };
  }

  // resposta do leitor → texto guardado/exportado: letra; "" = em branco; "A+B" = dupla; "?" = dúvida
  function codificar(r) {
    if (r.estado === "marcada") return r.letra;
    if (r.estado === "branco") return "";
    if (r.estado === "dupla") return r.letras.join("+");
    return "?";
  }

  // marcas: respostas codificadas, na ordem das questões. Só a letra igual à chave acerta (dupla, branco e dúvida = erro).
  function corrigir(marcas, chave) {
    const certas = chave.map((c, i) => marcas[i] === c);
    return { acertos: certas.filter(Boolean).length, total: chave.length, certas };
  }

  const matriculaValida = (m) => /^\d{4,20}$/.test(String(m || ""));

  const indice = (lista, prova, matricula) => lista.findIndex((r) => r.prova === prova && r.matricula === matricula);

  // identidade = prova + matrícula. Repetida: só troca se `substituir`. Devolve {lista, gravou, repetida} sem alterar a original.
  function gravar(lista, registro, substituir) {
    const i = indice(lista, registro.prova, registro.matricula);
    if (i < 0) return { lista: lista.concat([registro]), gravou: true, repetida: false };
    if (!substituir) return { lista, gravou: false, repetida: true };
    const nova = lista.slice(); nova[i] = registro;
    return { lista: nova, gravou: true, repetida: true };
  }

  // refaz acertos/total dos registros de uma prova com a chave atual (null = sem chave)
  function recalcular(lista, prova, chave) {
    return lista.map((r) => {
      if (r.prova !== prova) return r;
      const c = chave && chave.length === r.respostas.length ? corrigir(r.respostas, chave) : null;
      return Object.assign({}, r, { acertos: c ? c.acertos : null, total: c ? c.total : null });
    });
  }

  function campo(v) {
    const s = v == null ? "" : String(v);
    return /[",\r\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // colunas: matricula,prova,Q1..Qn,acertos,total
  function csv(lista) {
    const n = lista.reduce((m, r) => Math.max(m, r.respostas.length), 0);
    const cab = ["matricula", "prova"].concat(Array.from({ length: n }, (_, i) => "Q" + (i + 1)), ["acertos", "total"]);
    const linhas = lista.map((r) => [r.matricula, r.prova].concat(Array.from({ length: n }, (_, i) => r.respostas[i]), [r.acertos, r.total]).map(campo).join(","));
    return [cab.join(",")].concat(linhas).join("\r\n") + "\r\n";
  }

  return { lerChave, codificar, corrigir, matriculaValida, indice, gravar, recalcular, csv };
});
