/* vivo.js — modo ao vivo: o professor aponta a câmera, o leitor percebe o cartão sozinho, lê e avisa.
 * Padrões da Caderneta: getUserMedia com limite de tempo, iOS (câmera some em segundo plano: visibilitychange/pageshow),
 * apito WebAudio, torch só quando existe.
 * NENHUM quadro é guardado nem enviado: tudo fica em canvas na memória e é solto ao confirmar. Sem localStorage/IndexedDB.
 * Tudo que roda na inicialização está declarado ANTES (lição da Caderneta: nada de const usada antes de declarar). */
const Vivo = (() => {
  "use strict";
  const $ = (id) => document.getElementById(id);

  // ---------- constantes de tempo ----------
  const APOS_FALHA_MS = 500;       // espera depois de uma leitura completa que falhou
  const BLOQUEADO_MS = 1000;       // com o mesmo cartão ainda na frente, só relê (e descarta) a cada tanto
  const DICA_APOS_MS = 2000;       // sem sucesso depois de tanto tempo: mostra o motivo
  const SUMIU_MS = 1000;           // marcas fora da imagem por tanto tempo = o cartão saiu
  const LENTO_MS = 25;             // checagem mais lenta que isto: o laço passa a pular quadros

  // molde só para a proporção das marcas, a moldura-guia e a posição do QR, enquanto o molde real não foi carregado
  const MOLDE_PADRAO = { marcas: [{ cx: 8, cy: 8, tamanho: 6 }, { cx: 97, cy: 8, tamanho: 6 }, { cx: 8, cy: 140.5, tamanho: 6 }, { cx: 97, cy: 140.5, tamanho: 6 }],
    cartao: { largura: 105, altura: 148.5 }, qr: { x: 72.02, y: 25.66, tamanho: 17.82 } };

  // ---------- estado ----------
  const eventos = [];              // só para os testes (em memória): {tipo, t, ...}
  const moldes = new Map();        // código → molde (sem dados pessoais)
  let moldeRef = null;             // molde só para a proporção/guia/QR
  let stream = null, track = null, pedidoCam = 0, querCamera = false, iniciando = false;
  let rodando = false, raf = 0, ultimo = 0, ocupado = false, pausado = false, ultimoTempoVideo = -1, intervaloMin = 0, emaMs = 0;
  let refDesde = 0, semMarcasDesde = 0, bloqueio = null, proxima = 0, tentandoDesde = 0, motivo = "";
  const refPos = new Float64Array(8);
  let somOn = true, actx = null, hapticLabel = null, torchOn = false;
  let perfOn = false; const marcasDeTempo = []; let tLeitura = null, tQR = null, tBolhas = null, estrategiaQR = "";
  let ultimaDet = null, debug = false, dbgCtx = null, dbgUltimo = 0;
  let mosaico = null, mctx = null, detector = null, regs = null, regsChave = "", atual = null;

  const agora = () => performance.now();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = (tipo, extra) => { eventos.push(Object.assign({ tipo, t: Math.round(agora()) }, extra || {})); if (eventos.length > 500) eventos.shift(); };

  // ---------- som e vibração (da Caderneta) ----------
  function audioOn() { try { if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); if (actx.state !== "running") actx.resume(); } catch (e) {} }
  function tremer() {
    try { if (navigator.vibrate) { navigator.vibrate(70); return; } } catch (e) {}
    try {   // iPhone (iOS 18): o toque tátil de um <input switch> (só com gesto do usuário; sem gesto não faz mal)
      if (!hapticLabel) {
        const l = document.createElement("label"), i = document.createElement("input");
        l.setAttribute("aria-hidden", "true"); l.style.cssText = "position:fixed;left:-100px;top:-100px;width:1px;height:1px;opacity:0;pointer-events:none";
        i.type = "checkbox"; i.setAttribute("switch", ""); l.appendChild(i); document.body.appendChild(l); hapticLabel = l;
      }
      hapticLabel.click();
    } catch (e) {}
  }
  function apito() {
    tremer();
    if (!somOn) return;
    try {
      audioOn(); if (!actx) return;
      const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
      o.type = "square"; o.frequency.setValueAtTime(1950, t); o.frequency.setValueAtTime(2450, t + .08);
      g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.14, t + .008);
      g.gain.setValueAtTime(.14, t + .17); g.gain.exponentialRampToValueAtTime(.0001, t + .2);
      o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + .36);
    } catch (e) {}
  }

  // ---------- câmera ----------
  async function iniciar() {
    if (iniciando) return;
    iniciando = true; querCamera = true; audioOn();
    $("camErr").hidden = true;
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return semCamera("Este navegador não libera a câmera ao vivo. Use a foto.");
      soltarCamera();   // nunca deixa uma câmera velha (que o iOS pode ter desligado) para trás
      const pedido = ++pedidoCam;
      let s;
      try {
        // o iOS às vezes deixa o getUserMedia pendente para sempre: desiste depois de 10 s
        s = await Promise.race([
          navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } } }),
          new Promise((_, no) => setTimeout(() => no({ name: "Demorou" }), 10000)),
        ]);
      } catch (e) {
        if (pedido !== pedidoCam) return;
        return semCamera(e && e.name === "NotAllowedError" ? "A câmera foi bloqueada. No iPhone: Ajustes > Safari > Câmera > Permitir, e abra de novo."
          : e && e.name === "Demorou" ? "A câmera não respondeu. Feche a página e abra de novo."
          : "Não consegui abrir a câmera. Use a foto.");
      }
      if (pedido !== pedidoCam) { s.getTracks().forEach((t) => t.stop()); return; }
      stream = s;
      const video = $("video");
      video.srcObject = stream;
      try { await Promise.race([video.play(), sleep(5000)]); } catch (e) {}
      track = stream.getVideoTracks()[0];
      track.addEventListener("ended", cameraMorreu);
      try {
        const cap = track.getCapabilities ? track.getCapabilities() : {};
        $("lanterna").hidden = !cap.torch;   // só Android; no iPhone o botão não aparece
        if (cap.focusMode && cap.focusMode.includes("continuous")) track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => {});
      } catch (e) {}
      $("telaInicio").hidden = true; $("telaVivo").hidden = false;
      ajustarPalco();   // depois de mostrar a tela: escondida, o palco não tem tamanho
      if (!pausado) comecarLaco();
    } finally { iniciando = false; }
  }

  function soltarCamera() {
    rodando = false; cancelAnimationFrame(raf);
    if (stream) { try { stream.getTracks().forEach((t) => t.stop()); } catch (e) {} }
    stream = null; track = null; torchOn = false;
    try { $("video").srcObject = null; } catch (e) {}
  }

  // o iOS desliga a câmera em segundo plano: se a trilha morreu, volta à tela inicial em vez de ficar com vídeo congelado
  function cameraMorreu() {
    if (!stream) return;
    soltarCamera(); querCamera = false;
    $("telaVivo").hidden = true; $("lanterna").hidden = true;
    if (!pausado) $("telaInicio").hidden = false;
    log("camera-morreu");
  }
  function conferirCamera() { if (stream && (!track || track.readyState === "ended")) cameraMorreu(); }
  function ao_esconder() { if (stream) { const queria = querCamera; soltarCamera(); querCamera = queria; log("camera-liberada"); } }
  function ao_voltar() { conferirCamera(); if (querCamera && !stream && !iniciando && !pausado) iniciar(); }

  function semCamera(msg) { $("camErr").textContent = msg; $("camErr").hidden = false; querCamera = false; }

  function ajustarPalco() {
    const v = $("video"); if (!v.videoWidth) return;
    $("palco").style.setProperty("--ar", String(v.videoWidth / v.videoHeight));
    const g = $("guia"), r = $("palco").getBoundingClientRect(), d = window.devicePixelRatio || 1;
    g.width = Math.round(r.width * d); g.height = Math.round(r.height * d);
  }

  // ---------- laço ----------
  function comecarLaco() {
    if (rodando) return;
    rodando = true; ultimo = 0; ultimoTempoVideo = -1; tentandoDesde = 0; semMarcasDesde = 0; proxima = 0; refDesde = 0; intervaloMin = 0;
    raf = requestAnimationFrame(passo);
  }
  // rAF: checa a cada quadro NOVO de vídeo; se a checagem ficar lenta (> LENTO_MS) passa a pular quadros (sem acumular trabalho)
  function passo(t) {
    if (!rodando) return;
    raf = requestAnimationFrame(passo);
    if (ocupado || document.hidden) return;
    const v = $("video");
    if (v.currentTime === ultimoTempoVideo && t - ultimo < 250) return;   // mesmo quadro de vídeo (a trava de 250 ms cobre navegadores sem currentTime fino)
    if (t - ultimo < intervaloMin) return;
    ultimoTempoVideo = v.currentTime; ultimo = t;
    try { checar(t); } catch (e) { if (window.__avisoErro) window.__avisoErro(e.message, e.stack ? "linha " + ((String(e.stack).match(/:(\d+):\d+/) || [0, "?"])[1]) : ""); }
  }

  // 4 recortes (um por canto da moldura) → mosaico 2T×2T → UM getImageData
  function amostrar() {
    const v = $("video"), vw = v.videoWidth, vh = v.videoHeight;
    if (!vw || v.readyState < 2) return null;
    const T = detector.T, m = moldeRef || MOLDE_PADRAO;
    if (!mosaico) { mosaico = document.createElement("canvas"); mosaico.width = mosaico.height = 2 * T; mctx = mosaico.getContext("2d", { willReadFrequently: true }); }
    const chave = vw + "x" + vh + (moldeRef ? "r" : "p");
    if (chave !== regsChave) { regs = OMR.regioesCantos(vw, vh, m); regsChave = chave; }
    for (let k = 0; k < 4; k++) mctx.drawImage(v, regs[k].sx, regs[k].sy, regs[k].s, regs[k].s, (k & 1) * T, (k >> 1) * T, T, T);
    return mctx.getImageData(0, 0, 2 * T, 2 * T);
  }

  const TEXTO = { aponte: "Aponte para o cartão", encaixe: "Encaixe o cartão na moldura", aproxime: "Aproxime", afaste: "Afaste", reto: "Segure o cartão reto" };

  function checar(t) {
    const ini = agora();
    const img = amostrar(); if (!img) return;
    if ($("guia").width !== Math.round($("palco").clientWidth * (window.devicePixelRatio || 1))) ajustarPalco();
    const m = moldeRef || MOLDE_PADRAO;
    const det = detector.analisar(img, regs, m);
    ultimaDet = det;
    const gasto = agora() - ini;
    emaMs = emaMs ? emaMs * 0.9 + gasto * 0.1 : gasto;
    intervaloMin = emaMs > LENTO_MS ? emaMs * 1.5 : 0;
    marcasDeTempo.push(t); while (marcasDeTempo.length && t - marcasDeTempo[0] > 1000) marcasDeTempo.shift();
    desenharGuia(det);
    atualizarPerf();
    if (debug) desenharDebug(img, det, t);
    if (det.achou <= 1) {   // cartão fora da imagem
      refDesde = 0; tentandoDesde = 0;
      if (!semMarcasDesde) semMarcasDesde = t;
      else if (bloqueio && t - semMarcasDesde >= SUMIU_MS) { bloqueio = null; log("cartao-saiu"); }   // o cartão saiu: pode ler de novo
    } else semMarcasDesde = 0;
    if (!det.ok) { refDesde = 0; tentandoDesde = 0; dica(TEXTO[det.dica] || TEXTO.aponte); return; }
    // estabilidade por TEMPO: marcas paradas (deslocamento pequeno em relação à referência) por VIVO_ESTAVEL_MS
    if (!refDesde || OMR.deslocamentoPos(refPos, det) >= OMR.C.VIVO_DESLOC) { OMR.copiarPosicoes(det, refPos); refDesde = t; }
    if (t - refDesde < OMR.C.VIVO_ESTAVEL_MS) { dica("Segure firme"); return; }
    if (t < proxima) return;
    if (!tentandoDesde) tentandoDesde = t;
    dica(t - tentandoDesde >= DICA_APOS_MS && motivo ? motivo : bloqueio ? "Cartão já lido: mostre o próximo" : "Lendo…");
    lerCompleto(det);
  }

  async function molde(codigo) {
    if (!moldes.has(codigo)) moldes.set(codigo, await Foto.moldePorCodigo(codigo));
    return moldes.get(codigo);
  }

  // Caixas de recorte para o QR: posição prevista pelo molde (homografia das 4 marcas vivas), margem de 60% do QR; depois o espelho 180°.
  function caixasQR(det, vw, vh) {
    const m = moldeRef || MOLDE_PADRAO, q = m.qr, W = m.cartao.largura, Hh = m.cartao.altura;
    const src = m.marcas.map((k) => [k.cx, k.cy]), dst = det.cantos.map((c) => [c.cx, c.cy]);
    const H = OMR.homografia(src, dst), marg = 0.6 * q.tamanho;
    const caixa = (x, y, nome) => {
      const pts = [[x - marg, y - marg], [x + q.tamanho + marg, y - marg], [x + q.tamanho + marg, y + q.tamanho + marg], [x - marg, y + q.tamanho + marg]].map(([a, b]) => OMR.projetar(H, a, b));
      const x0 = Math.max(0, Math.min(...pts.map((p) => p[0]))), x1 = Math.min(vw, Math.max(...pts.map((p) => p[0])));
      const y0 = Math.max(0, Math.min(...pts.map((p) => p[1]))), y1 = Math.min(vh, Math.max(...pts.map((p) => p[1])));
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, nome };
    };
    return [caixa(q.x, q.y, "recorte"), caixa(W - q.x - q.tamanho, Hh - q.y - q.tamanho, "recorte 180°")].filter((c) => c.w > 8 && c.h > 8);
  }

  async function lerCompleto(det) {
    ocupado = true; const t0 = agora();
    let falha = null;
    try {
      const caixasDet = (() => { try { return caixasQR(det, $("video").videoWidth, $("video").videoHeight); } catch (e) { return []; } })();
      const quadro = Foto.deVideo($("video"));                     // quadro na resolução TOTAL do vídeo
      const tObter = agora() - t0, t1 = agora();
      let qr = null;
      try { qr = await Foto.lerQRAoVivo(quadro.cheio, quadro.cOMR, caixasDet); } catch (e) { falha = "O leitor de QR não carregou (sem internet?)."; }
      tQR = Math.round(agora() - t1); estrategiaQR = qr && qr.estrategia ? qr.estrategia : "";
      if (!falha && !qr) falha = "Não li o QR: aproxime um pouco.";
      else if (!falha && qr.invalido) falha = "Esse QR não é de um cartão do Gabarito.";
      let mol = null;
      if (!falha) { mol = await molde(qr.codigo); if (!mol) falha = `Não há molde para a prova “${qr.codigo}”.`; }
      let res = null;
      if (!falha) {
        res = OMR.ler(Foto.imageData(quadro.cOMR), mol, qr, {});
        tBolhas = res.tempos_ms ? res.tempos_ms.bolhas : null;
        if (!res.ok) falha = res.erro;
        else if ((res.avisos || []).some((a) => /Orientação duvidosa/.test(a))) falha = "Orientação duvidosa: segure firme e tente de novo.";
      }
      if (!falha) {   // as marcas que a leitura completa achou têm de coincidir com as que o laço viu (quadro mexendo/misturado = recusa)
        const f = quadro.cOMR.width / quadro.largura, tol = 0.06 * det.ladoQuad * f;
        const coincide = det.cantos.every((c) => res.marcas.some((m) => Math.hypot(m.cx - c.cx * f, m.cy - c.cy * f) <= tol));
        if (!coincide) falha = "A imagem mexeu na hora de ler: segure firme.";
      }
      Foto.soltarQuadro();
      if (falha) { motivo = falha; proxima = agora() + APOS_FALHA_MS; log("falha", { motivo: falha.slice(0, 80) }); return; }
      const chave = qr.codigo + "|" + qr.matricula;
      tLeitura = Math.round(agora() - t0);
      if (bloqueio === chave) { proxima = agora() + BLOQUEADO_MS; log("repetida"); return; }   // mesmo cartão ainda na frente: ignora
      sucesso({ cOMR: quadro.cOMR, res, qr, molde: mol, tDecod: tObter, tQR }, chave);
    } finally { ocupado = false; }
  }

  function sucesso(dados, chave) {
    rodando = false; cancelAnimationFrame(raf); pausado = true; atual = { chave };
    motivo = ""; tentandoDesde = 0; refDesde = 0;
    apito();
    log("leitura", { codigo: dados.qr.codigo, matricula: dados.qr.matricula, estrategiaQR, tQR, tBolhas, respostas: dados.res.respostas.map((r) => ({ questao: r.questao, estado: r.estado, letra: r.letra, letras: r.letras })), ms: tLeitura });
    $("telaVivo").hidden = true;
    Resultado.mostrar(dados, { vivo: true });
    window.scrollTo(0, 0);
  }

  function confirmar() {   // volta a ler; o mesmo cartão só é lido de novo depois que as marcas sumirem por ≥ 1 s
    bloqueio = atual ? atual.chave : null; log("confirmou");
    voltar();
  }
  function lerDeNovo() { bloqueio = null; log("reler"); voltar(); }
  function voltar() {
    Resultado.esconder(); atual = null; pausado = false; Resultado.avisos([]);
    $("telaVivo").hidden = false;
    if (!stream) iniciar(); else comecarLaco();
  }

  // ---------- tela ----------
  function dica(txt) { const d = $("dica"); if (d.textContent !== txt) d.textContent = txt; }

  function desenharGuia(det) {
    const g = $("guia"), c = g.getContext("2d"), W = g.width, H = g.height, v = $("video");   // tudo no espaço do VÍDEO; fx/fy levam ao espaço da tela (o <video> usa object-fit: fill)
    if (!W || !v.videoWidth) return;
    c.clearRect(0, 0, W, H);
    const m = OMR.moldura(v.videoWidth, v.videoHeight, moldeRef || MOLDE_PADRAO), fx = W / v.videoWidth, fy = H / v.videoHeight, r = Math.min(W, H) * 0.03;
    c.lineWidth = Math.max(2, W * 0.004); c.strokeStyle = det.ok ? "rgba(61,220,122,.9)" : "rgba(255,255,255,.75)"; c.setLineDash(det.ok ? [] : [W * 0.03, W * 0.02]);
    c.beginPath(); c.roundRect ? c.roundRect(m.x * fx, m.y * fy, m.w * fx, m.h * fy, r) : c.rect(m.x * fx, m.y * fy, m.w * fx, m.h * fy); c.stroke(); c.setLineDash([]);
    for (let k = 0; k < 4; k++) {   // verde = marca achada; amarelo = canto sem marca (no lugar esperado)
      const cn = det.cantos[k], x = (cn.achada ? cn.cx : regs[k].ex) * fx, y = (cn.achada ? cn.cy : regs[k].ey) * fy;
      c.fillStyle = cn.achada ? "#3ddc7a" : "#f2b705";
      c.beginPath(); c.arc(x, y, Math.max(6, W * 0.018), 0, 2 * Math.PI); c.fill();
    }
  }

  // ?debug=1: o mosaico que a checagem está vendo (TL, TR / BL, BR), com a marca achada circulada, e por que cada canto falhou
  const NOMES_REJ = ["borda", "razão", "tamanho", "preench.", "clara"];
  function desenharDebug(img, det, t) {
    if (t - dbgUltimo < 200) return;
    dbgUltimo = t;
    const cv = $("mosaicoDbg"), T = detector.T;
    if (!dbgCtx) { cv.width = cv.height = 2 * T; dbgCtx = cv.getContext("2d"); }
    dbgCtx.putImageData(img, 0, 0);
    dbgCtx.strokeStyle = "#f2b705"; dbgCtx.lineWidth = 1; dbgCtx.strokeRect(0.5, 0.5, 2 * T - 1, 2 * T - 1); dbgCtx.strokeRect(T - 0.5, 0, 1, 2 * T); dbgCtx.strokeRect(0, T - 0.5, 2 * T, 1);
    const nomes = ["TL", "TR", "BL", "BR"], linhas = [];
    for (let k = 0; k < 4; k++) {
      const cn = det.cantos[k], r = regs[k];
      if (cn.achada) {
        dbgCtx.strokeStyle = "#3ddc7a"; dbgCtx.lineWidth = 2; dbgCtx.beginPath();
        dbgCtx.arc((k & 1) * T + (cn.cx - r.sx) / r.s * T, (k >> 1) * T + (cn.cy - r.sy) / r.s * T, 9, 0, 2 * Math.PI); dbgCtx.stroke();
        linhas.push(`${nomes[k]} ok tam ${cn.razao.toFixed(2)}`);
      } else linhas.push(`${nomes[k]} --  ` + (Array.from(cn.rej).map((v, i) => v ? NOMES_REJ[i] + "×" + v : "").filter(Boolean).join(" ") || "nada escuro"));
    }
    const v = $("video"), p = $("palco").getBoundingClientRect();
    linhas.push(`vídeo ${v.videoWidth}x${v.videoHeight} · palco ${Math.round(p.width)}x${Math.round(p.height)} · tela ${innerWidth}x${innerHeight} · dpr ${window.devicePixelRatio}`);
    linhas.push(`recorte ${Math.round(regs[0].s)} px do vídeo → ${T} px · dica ${det.dica || "ok"} · v${self.APP_VERSAO}`);
    $("debugTxt").textContent = linhas.join("\n");
  }

  function metricas() {
    return { checagensPorSeg: marcasDeTempo.length, msChecagem: Math.round(emaMs * 10) / 10, tQR, estrategiaQR, tBolhas, tLeitura,
      video: $("video").videoWidth + "x" + $("video").videoHeight };
  }
  function atualizarPerf() {
    if (!perfOn) return;
    const m = metricas();
    $("perf").textContent = `${m.checagensPorSeg} checagens/s · ${m.msChecagem} ms/checagem` + (tLeitura != null ? ` · leitura ${tLeitura} ms (QR ${tQR} ms ${estrategiaQR}, bolhas ${tBolhas} ms)` : "");
  }

  // ---------- inicialização (tudo acima já está declarado) ----------
  async function iniciarPagina() {
    $("ligar").addEventListener("click", () => { audioOn(); iniciar(); });
    $("confirmar").addEventListener("click", confirmar);
    $("lerDeNovo").addEventListener("click", lerDeNovo);
    $("lanterna").addEventListener("click", () => { if (!track) return; torchOn = !torchOn; track.applyConstraints({ advanced: [{ torch: torchOn }] }).catch(() => {}); });
    $("perfBtn").addEventListener("click", () => { perfOn = !perfOn; $("perf").hidden = !perfOn; });
    $("somBtn").addEventListener("click", () => { somOn = !somOn; $("somBtn").textContent = somOn ? "🔊" : "🔇"; if (somOn) { audioOn(); apito(); } });
    $("video").addEventListener("loadedmetadata", ajustarPalco);
    window.addEventListener("resize", ajustarPalco);
    document.addEventListener("visibilitychange", () => { if (document.hidden) ao_esconder(); else { if (actx) actx.resume(); ao_voltar(); } });
    window.addEventListener("pagehide", ao_esconder);
    window.addEventListener("pageshow", (e) => { if (e.persisted) ao_voltar(); else conferirCamera(); });
    detector = OMR.criarDetectorCantos();   // buffers alocados UMA vez
    Foto.aquecerQR();                        // 1ª detecção do QR carrega o WebAssembly: faz agora, não na primeira leitura
    const lista = await Foto.listaMoldes();
    if (lista.length) { try { moldeRef = await molde(lista[0]); } catch (e) {} }
    if (new URLSearchParams(location.search).has("debug")) { debug = true; $("debug").hidden = false; }
    if (new URLSearchParams(location.search).has("perf")) { perfOn = true; $("perf").hidden = false; }
  }

  function parar() { querCamera = false; pausado = false; soltarCamera(); $("telaVivo").hidden = true; }   // vai para o plano B (foto)

  return { iniciarPagina, parar, eventos, metricas, iniciar, detalhe: () => ultimaDet && { achou: ultimaDet.achou, dica: ultimaDet.dica, razao: ultimaDet.razaoMedia, cantos: ultimaDet.cantos.map((c) => [c.achada ? 1 : 0, Math.round(c.cx), Math.round(c.cy), +c.razao.toFixed(2)]) }, regs: () => regs, estado: () => ({ rodando, pausado, bloqueio, camera: !!stream })};
})();
