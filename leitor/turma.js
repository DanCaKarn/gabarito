/* turma.js — gabarito por prova, lista da turma e exportação (MODO DE TESTE no aparelho; no sistema final a planilha corrige).
 * No localStorage vão SÓ: a chave de cada prova e, por leitura, matrícula, prova, respostas, acertos, total e hora.
 * NUNCA nomes nem imagens. O CSV só sai do aparelho quando o usuário toca em "Exportar CSV". */
const Turma = (() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const K_LISTA = "gab-lista", K_CHAVE = "gab-chave-";
  const moldes = new Map();
  let lista = [], chaves = new Map();     // memória = cópia de trabalho (vale mesmo se o armazenamento falhar)
  let pendente = null;                    // resultado na tela: {prova, matricula, respostas}
  let editando = { codigo: "", n: 0, alts: [], chave: [] };

  const ler = (k) => { try { const v = localStorage.getItem(k); return v === null ? null : JSON.parse(v); } catch (e) { return null; } };
  function guardar(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) { alert("ATENÇÃO: não consegui salvar neste aparelho (aba privada ou sem espaço?). Os dados somem se a página recarregar: exporte o CSV agora."); return false; }
  }

  function chaveDe(codigo) {
    if (!chaves.has(codigo)) { const c = ler(K_CHAVE + codigo); chaves.set(codigo, Array.isArray(c) ? c : null); }
    return chaves.get(codigo);
  }
  function contador() { $("lidos").textContent = `Lidos: ${lista.length}`; }

  // ---------- resultado na tela ----------
  // chamado por resultado.js: guarda o que "Confirmar" vai gravar e devolve a correção (ou null se não há chave)
  function apresentar(res, qr, molde) {
    pendente = null;
    if (!res.ok) return null;
    const prova = qr && !qr.invalido ? qr.codigo : (molde ? molde.prova.codigo : "");
    if (!prova) return null;
    const respostas = res.respostas.slice().sort((a, b) => a.questao - b.questao).map(Corrigir.codificar);
    pendente = { prova, matricula: qr && !qr.invalido ? qr.matricula : "", respostas };
    const chave = chaveDe(prova);
    return { chave: chave && chave.length === respostas.length ? chave : null, correcao: chave && chave.length === respostas.length ? Corrigir.corrigir(respostas, chave) : null };
  }

  // grava o resultado pendente. false = não pode sair da tela de resultado (falta matrícula)
  function confirmar() {
    if (!pendente) return true;
    const matricula = pendente.matricula || $("matManual").value.trim();
    if (!Corrigir.matriculaValida(matricula)) {
      alert("Cartão sem matrícula no QR: digite a matrícula (só números) antes de confirmar.");
      $("matManual").focus();
      return false;
    }
    const chave = chaveDe(pendente.prova), c = chave && chave.length === pendente.respostas.length ? Corrigir.corrigir(pendente.respostas, chave) : null;
    const reg = { matricula, prova: pendente.prova, respostas: pendente.respostas, acertos: c ? c.acertos : null, total: c ? c.total : null, hora: new Date().toISOString() };
    let r = Corrigir.gravar(lista, reg, false);
    if (r.repetida) {
      const velho = lista[Corrigir.indice(lista, reg.prova, reg.matricula)];
      const nota = (x) => x.acertos == null ? "sem nota" : `${x.acertos}/${x.total}`;
      if (confirm(`Matrícula ${matricula} já foi lida nesta prova (${nota(velho)}). Substituir pela leitura nova (${nota(reg)})?`)) r = Corrigir.gravar(lista, reg, true);
    }
    if (r.gravou) { lista = r.lista; guardar(K_LISTA, lista); contador(); }
    pendente = null;
    return true;
  }
  function descartar() { pendente = null; }

  // ---------- painéis ----------
  function abrir(id) {
    Vivo.parar(); Resultado.esconder(); Resultado.avisos([]);
    $("telaInicio").hidden = true; $("seletor").hidden = true;
    $("painelGab").hidden = id !== "painelGab"; $("painelLista").hidden = id !== "painelLista";
    window.scrollTo(0, 0);
  }
  function fechar() { $("painelGab").hidden = true; $("painelLista").hidden = true; $("telaInicio").hidden = false; }

  // ---------- gabarito ----------
  async function molde(codigo) {
    if (!moldes.has(codigo)) { const m = await Foto.moldePorCodigo(codigo); if (m) moldes.set(codigo, m); }
    return moldes.get(codigo) || null;
  }
  async function abrirGabarito() {
    abrir("painelGab");
    const sel = $("provaGab"), antes = sel.value, codigos = await Foto.listaMoldes();
    sel.innerHTML = "";
    for (const c of codigos) { const o = document.createElement("option"); o.value = c; o.textContent = c + (chaveDe(c) ? " ✓" : ""); sel.appendChild(o); }
    if (codigos.includes(antes)) sel.value = antes;
    if (!codigos.length) return msgGab("Não achei moldes (sem internet?).", true);
    await escolherProva();
  }
  async function escolherProva() {
    const codigo = $("provaGab").value, m = await molde(codigo);
    $("copiar").hidden = true;
    if (!m) { $("grade").innerHTML = ""; editando = { codigo: "", n: 0, alts: [], chave: [] }; return msgGab("Não consegui abrir o molde desta prova.", true); }
    const n = new Set(m.bolhas.map((b) => b.questao)).size, alts = [...new Set(m.bolhas.map((b) => b.alternativa))].sort();
    const salva = chaveDe(codigo);
    editando = { codigo, n, alts, chave: salva && salva.length === n ? salva.slice() : new Array(n).fill("") };
    $("textoChave").value = editando.chave.join(""); $("textoChave").maxLength = n * 3;
    msgGab(salva ? "Gabarito salvo neste aparelho." : "Ainda sem gabarito para esta prova.");
    desenharGrade();
  }
  function desenharGrade() {
    const g = $("grade"); g.innerHTML = "";
    for (let i = 0; i < editando.n; i++) {
      const linha = document.createElement("div"); linha.className = "q";
      const t = document.createElement("span"); t.textContent = i + 1; linha.appendChild(t);
      for (const a of editando.alts) {
        const b = document.createElement("button"); b.type = "button"; b.textContent = a; b.dataset.q = i; b.dataset.a = a;
        b.className = "alt" + (editando.chave[i] === a ? " sel" : ""); b.setAttribute("aria-pressed", String(editando.chave[i] === a));
        b.addEventListener("click", () => { editando.chave[i] = a; $("textoChave").value = editando.chave.map((c) => c || "_").join("").replace(/_+$/, ""); desenharGrade(); msgGab("Alterado: toque em Salvar."); });
        linha.appendChild(b);
      }
      g.appendChild(linha);
    }
  }
  function digitou() {
    const s = $("textoChave").value.toUpperCase().replace(/[\s,;.\-]/g, "");
    editando.chave = Array.from({ length: editando.n }, (_, i) => editando.alts.includes(s[i]) ? s[i] : "");
    desenharGrade();
    const r = Corrigir.lerChave(s, editando.n, editando.alts);
    msgGab(r.erro || "Chave completa: toque em Salvar.", !!r.erro);
  }
  function msgGab(t, erro) { const d = $("msgGab"); d.textContent = t; d.className = "aviso" + (erro ? " erro" : ""); }

  // a chave a salvar/copiar é a da tela; o campo de texto manda se tiver algo inválido ou sobrando
  function chaveDaTela() {
    const texto = $("textoChave").value;
    const r = Corrigir.lerChave(texto.includes("_") ? editando.chave.join("") : texto, editando.n, editando.alts);
    if (r.erro) { msgGab(r.erro, true); return null; }
    return r.chave;
  }
  function definir(codigo, chave) {
    chaves.set(codigo, chave.slice()); const ok = guardar(K_CHAVE + codigo, chave);
    lista = Corrigir.recalcular(lista, codigo, chave); guardar(K_LISTA, lista);
    const o = [...$("provaGab").options].find((x) => x.value === codigo); if (o) o.textContent = codigo + " ✓";
    return ok;
  }
  function salvar() {
    if (!editando.codigo) return;
    const c = chaveDaTela(); if (!c) return;
    editando.chave = c.slice(); $("textoChave").value = c.join(""); desenharGrade();
    if (definir(editando.codigo, c)) msgGab(`Salvo: ${editando.codigo} = ${c.join("")}`);
  }
  async function abrirCopia() {
    if (!editando.codigo || !chaveDaTela()) return;
    const alvo = $("copiarLista"); alvo.innerHTML = "";
    for (const c of await Foto.listaMoldes()) {
      if (c === editando.codigo) continue;
      const m = await molde(c); if (!m || new Set(m.bolhas.map((b) => b.questao)).size !== editando.n) continue;
      const l = document.createElement("label"), i = document.createElement("input");
      i.type = "checkbox"; i.value = c; l.append(i, ` ${c}${chaveDe(c) ? " (já tem gabarito)" : ""}`); alvo.appendChild(l);
    }
    if (!alvo.children.length) return msgGab("Não há outra prova com o mesmo número de questões.", true);
    $("copiar").hidden = false;
  }
  function copiar() {
    const chave = chaveDaTela(); if (!chave) return;
    const destinos = [...$("copiarLista").querySelectorAll("input:checked")].map((i) => i.value);
    if (!destinos.length) return msgGab("Marque ao menos uma prova para copiar.", true);
    const cobre = destinos.filter((c) => chaveDe(c));
    if (cobre.length && !confirm(`Sobrescrever o gabarito de: ${cobre.join(", ")}?`)) return;
    definir(editando.codigo, chave);
    let ok = true; for (const c of destinos) ok = definir(c, chave) && ok;
    $("copiar").hidden = true;
    if (ok) msgGab(`Gabarito ${chave.join("")} salvo em ${editando.codigo} e copiado para: ${destinos.join(", ")}.`);
  }

  // ---------- lista ----------
  function abrirLista() { abrir("painelLista"); desenharLista(); }
  function desenharLista() {
    const t = $("tabela"); t.innerHTML = "";
    $("exportar").disabled = $("limpar").disabled = !lista.length;
    if (!lista.length) { t.textContent = "Nenhum cartão confirmado ainda."; return; }
    for (const r of lista.slice().reverse()) {
      const li = document.createElement("li");
      const m = document.createElement("b"); m.textContent = r.matricula;
      const n = document.createElement("strong"); n.textContent = r.acertos == null ? "sem nota" : `${r.acertos}/${r.total}`;
      const s = document.createElement("small"); s.textContent = `${r.prova} · ${new Date(r.hora).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
      li.append(m, n, s); t.appendChild(li);
    }
  }
  function baixar(arquivo) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(arquivo); a.download = arquivo.name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }
  async function exportar() {
    if (!lista.length) return;
    const d = new Date(), p = (x) => String(x).padStart(2, "0");
    const nome = `gabarito_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.csv`;
    const arquivo = new File(["﻿" + Corrigir.csv(lista)], nome, { type: "text/csv" });
    if (navigator.canShare && navigator.canShare({ files: [arquivo] })) {
      try { await navigator.share({ files: [arquivo] }); return; }
      catch (e) { if (e && e.name === "AbortError") return; }   // cancelou: não é erro; outro problema: cai no download
    }
    baixar(arquivo);
  }
  function limpar() {
    if (!lista.length || !confirm(`Apagar as ${lista.length} leitura(s) deste aparelho? Já exportou o CSV? Não dá para desfazer.`)) return;
    lista = []; guardar(K_LISTA, lista); contador(); desenharLista();
  }

  function iniciar() {
    const l = ler(K_LISTA); lista = Array.isArray(l) ? l : [];
    contador();
    $("gabBtn").addEventListener("click", abrirGabarito);
    $("listaBtn").addEventListener("click", abrirLista);
    for (const b of document.querySelectorAll(".fechar")) b.addEventListener("click", fechar);
    $("provaGab").addEventListener("change", escolherProva);
    $("textoChave").addEventListener("input", digitou);
    $("salvarChave").addEventListener("click", salvar);
    $("copiarBtn").addEventListener("click", abrirCopia);
    $("copiarOk").addEventListener("click", copiar);
    $("exportar").addEventListener("click", exportar);
    $("limpar").addEventListener("click", limpar);
  }

  return { iniciar, apresentar, confirmar, descartar, fechar };
})();
