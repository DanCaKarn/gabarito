/* resultado.js — tela do resultado (foto congelada com o desenho, matrícula, prova, lista Q1..Qn).
 * Só desenha na tela, em memória: nada de rede, nada de localStorage/IndexedDB. Sem nomes de alunos. */
const Resultado = (() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  let atual = null;   // {cOMR, res, qr, molde, binaria, tempos extras}

  function avisos(lista, erro) {
    $("avisos").innerHTML = "";
    for (const a of lista) { const d = document.createElement("div"); d.className = "aviso" + (erro ? " erro" : ""); d.textContent = a; $("avisos").appendChild(d); }
  }

  function desenhar() {
    const { cOMR, res, binaria } = atual, cv = $("tela");
    cv.width = cOMR.width; cv.height = cOMR.height;
    const ctx = cv.getContext("2d");
    if (binaria && res.binaria) {
      const im = ctx.createImageData(cv.width, cv.height), ink = res.binaria.ink, ink2 = res.binaria.inkMarcas;
      for (let i = 0; i < ink.length; i++) { const v = ink[i] ? 0 : 255, o = i * 4; im.data[o] = v; im.data[o + 1] = ink2[i] && !ink[i] ? 120 : v; im.data[o + 2] = v; im.data[o + 3] = 255; }
      ctx.putImageData(im, 0, 0);
    } else ctx.drawImage(cOMR, 0, 0);
    Foto.sobrepor(ctx, res, 1);
    $("binaria").textContent = binaria ? "Ver foto" : "Ver imagem binária";
  }

  // dados: {cOMR, res, qr, molde, tDecod, tQR}; opc: {vivo: boolean}
  function mostrar(dados, opc) {
    atual = Object.assign({ binaria: false }, dados);
    const { res, qr, molde } = atual;
    const avs = (res.avisos || []).slice();
    if (res.erro) avs.unshift("NÃO LI O CARTÃO: " + res.erro);
    avisos(avs, !!res.erro);
    $("saida").hidden = false;
    $("acoesVivo").hidden = !(opc && opc.vivo); $("voltarFoto").hidden = !!(opc && opc.vivo);
    $("mat").textContent = qr && !qr.invalido ? (qr.matricula || "(cartão genérico: sem matrícula)") : "—";
    $("cod").textContent = qr && !qr.invalido ? qr.codigo : (molde ? molde.prova.codigo + " (escolhido)" : "—");
    // correção (modo de teste): nota grande e ✓/✗; sem matrícula no QR, pede antes de confirmar
    const nota = Turma.apresentar(res, qr, molde), c = nota && nota.correcao;
    $("nota").hidden = !res.ok;
    $("nota").className = c ? "" : "sem";
    $("nota").textContent = c ? `${c.acertos}/${c.total}` : "sem gabarito para esta prova";
    const semMat = res.ok && !(qr && !qr.invalido && qr.matricula);
    $("pedeMat").hidden = !semMat; $("matManual").value = "";
    document.body.classList.add("com-resultado");
    $("conf").textContent = res.ok ? `mín. ${(res.confianca.minima * 100).toFixed(0)}% · média ${(res.confianca.media * 100).toFixed(0)}%` : "—";
    desenhar();
    const ul = $("lista"); ul.innerHTML = "";
    for (const r of res.respostas || []) {
      const li = document.createElement("li"); li.className = r.estado;
      const q = document.createElement("span"); q.textContent = `Q${r.questao}: `;
      const b = document.createElement("b"); b.textContent = Foto.descricao(r);
      const s = document.createElement("small"); s.textContent = Object.entries(r.valores).map(([l, v]) => `${l} ${Math.round(v * 100)}%`).join(" · ");
      li.append(q, b, s);
      if (c) {
        const i = res.respostas.slice().sort((a, b) => a.questao - b.questao).indexOf(r), certa = c.certas[i];
        const v = document.createElement("em"); v.className = certa ? "certa" : "errada"; v.textContent = certa ? "✓" : `✗ (${nota.chave[i]})`;
        li.insertBefore(v, s);
      }
      ul.appendChild(li);
    }
    const t = res.tempos_ms || {};
    $("tempos").textContent = `Tempo total da leitura: ${t.total ?? "—"} ms (${atual.tDecod != null ? "obter imagem " + Math.round(atual.tDecod) + " ms · " : ""}QR ${Math.round(atual.tQR || 0)} ms · ` +
      Object.entries(t).filter(([k]) => k !== "total").map(([k, v]) => `${k} ${v} ms`).join(" · ") + ")";
    const dv = (res.respostas || []).filter(r => r.estado === "duvida" || r.estado === "dupla").length;
    $("resumoDuvidas").textContent = dv ? `${dv} questão(ões) com dúvida ou dupla: confira em amarelo.` : "";
    $("resumoDuvidas").hidden = !dv;
  }

  function alternarBinaria() { if (!atual) return; atual.binaria = !atual.binaria; desenhar(); }
  function esconder() { atual = null; Turma.descartar(); document.body.classList.remove("com-resultado"); $("saida").hidden = true; $("tela").width = 1; $("lista").innerHTML = ""; }   // solta a imagem
  const chave = () => (atual && atual.qr && !atual.qr.invalido) ? atual.qr.codigo + "|" + atual.qr.matricula : null;

  return { mostrar, esconder, avisos, alternarBinaria, chave };
})();
