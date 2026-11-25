/* vivo.js — modo ao vivo: o professor aponta a câmera, o leitor percebe o cartão sozinho, lê e avisa.
 * Padrões da Caderneta: getUserMedia com limite de tempo, iOS (câmera some em segundo plano: visibilitychange/pageshow),
 * apito WebAudio, torch só quando existe.
 * NENHUM quadro é guardado nem enviado: tudo fica em canvas na memória e é solto ao confirmar. Sem localStorage/IndexedDB.
 * Tudo que roda na inicialização está declarado ANTES (lição da Caderneta: nada de const usada antes de declarar). */
const Vivo = (() => {
  "use strict";
  const $ = (id) => document.getElementById(id);

  // ---------- constantes de tempo ----------
  const INTERVALO_MS = 120;        // entre checagens das marcas
  const APOS_FALHA_MS = 500;       // espera depois de uma leitura completa que falhou
  const BLOQUEADO_MS = 1000;       // com o mesmo cartão ainda na frente, só relê (e descarta) a cada tanto
  const DICA_APOS_MS = 2000;       // sem sucesso depois de tanto tempo: mostra o motivo
  const SUMIU_MS = 1000;           // marcas fora da imagem por tanto tempo = o cartão saiu

  // molde só para a proporção das marcas e a moldura-guia, enquanto o molde real não foi carregado
  const MOLDE_PADRAO = { marcas: [{ cx: 8, cy: 8 }, { cx: 97, cy: 8 }, { cx: 8, cy: 140.5 }, { cx: 97, cy: 140.5 }], cartao: { largura: 105, altura: 148.5 } };

  // ---------- estado ----------
  const eventos = [];              // só para os testes (em memória): {tipo, t, ...}
  const moldes = new Map();        // código → molde (sem dados pessoais)
  let moldeRef = null;             // molde só para a proporção/guia
  let stream = null, track = null, pedidoCam = 0, querCamera = false, iniciando = false;
  let rodando = false, raf = 0, ultimo = 0, ocupado = false, pausado = false;
  let hist = [], semMarcasDesde = 0, bloqueio = null, proxima = 0, tentandoDesde = 0, motivo = "", ultimaDeteccao = null;
  let somOn = true, actx = null, hapticLabel = null, torchOn = false;
  let perfOn = false; const marcasDeTempo = []; let tLeitura = null;
  let pequeno = null, pctx = null, atual = null;

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
    rodando = true; hist = []; ultimo = 0; tentandoDesde = 0; semMarcasDesde = 0; proxima = 0;
    raf = requestAnimationFrame(passo);
  }
  function passo(t) {
    if (!rodando) return;
    raf = requestAnimationFrame(passo);
    if (ocupado || document.hidden || t - ultimo < INTERVALO_MS) return;   // sem acumular trabalho
    ultimo = t;
    try { checar(); } catch (e) { if (window.__avisoErro) window.__avisoErro(e.message, e.stack ? "linha " + ((String(e.stack).match(/:(\d+):\d+/) || [0, "?"])[1]) : ""); }
  }

  function quadroPequeno() {
    const v = $("video"), vw = v.videoWidth, vh = v.videoHeight;
    if (!vw || v.readyState < 2) return null;
    const s = Math.min(1, OMR.C.VIVO_LADO / Math.max(vw, vh)), w = Math.round(vw * s), h = Math.round(vh * s);
    if (!pequeno) { pequeno = document.createElement("canvas"); pctx = pequeno.getContext("2d", { willReadFrequently: true }); }
    if (pequeno.width !== w || pequeno.height !== h) { pequeno.width = w; pequeno.height = h; }
    pctx.drawImage(v, 0, 0, w, h);
    return pctx.getImageData(0, 0, w, h);
  }

  const TEXTO = { aponte: "Aponte para o cartão", aproxime: "Aproxime", afaste: "Afaste", reto: "Segure o cartão reto" };

  function checar() {
    const img = quadroPequeno(); if (!img) return;
    const t = agora();
    marcasDeTempo.push(t); while (marcasDeTempo.length && t - marcasDeTempo[0] > 1000) marcasDeTempo.shift();
    if ($("guia").width !== Math.round($("palco").clientWidth * (window.devicePixelRatio || 1))) ajustarPalco();
    const det = OMR.detectarMarcas(img, moldeRef || MOLDE_PADRAO);
    ultimaDeteccao = det;
    desenharGuia(det);
    if (!det.achou) {
      hist = []; tentandoDesde = 0;
      if (!semMarcasDesde) semMarcasDesde = t;
      else if (bloqueio && t - semMarcasDesde >= SUMIU_MS) { bloqueio = null; log("cartao-saiu"); }   // o cartão saiu: pode ler de novo
      dica(TEXTO[det.dica] || TEXTO.aponte); atualizarPerf(det.ms);
      return;
    }
    semMarcasDesde = 0;
    if (!det.ok) { hist = []; tentandoDesde = 0; dica(TEXTO[det.dica]); atualizarPerf(det.ms); return; }
    const ult = hist[hist.length - 1];
    if (ult && OMR.deslocamentoRel(ult, det) < OMR.C.VIVO_DESLOC) hist.push(det); else hist = [det];
    if (hist.length > OMR.C.VIVO_ESTAVEIS) hist.shift();
    atualizarPerf(det.ms);
    if (hist.length < OMR.C.VIVO_ESTAVEIS) { dica("Segure firme"); return; }
    if (t < proxima) return;
    if (!tentandoDesde) tentandoDesde = t;
    dica(t - tentandoDesde >= DICA_APOS_MS && motivo ? motivo : bloqueio ? "Cartão já lido: mostre o próximo" : "Lendo…");
    lerCompleto();
  }

  async function molde(codigo) {
    if (!moldes.has(codigo)) moldes.set(codigo, await Foto.moldePorCodigo(codigo));
    return moldes.get(codigo);
  }

  async function lerCompleto() {
    ocupado = true; const t0 = agora();
    let falha = null;
    try {
      const quadro = Foto.deVideo($("video"));                     // quadro na resolução TOTAL do vídeo
      const tObter = agora() - t0, t1 = agora();
      let qr = null;
      try { qr = await Foto.lerQR(quadro.cQR, quadro.cOMR); } catch (e) { falha = "O leitor de QR não carregou (sem internet?)."; }
      const tQR = agora() - t1;
      if (!falha && !qr) falha = "Não li o QR: aproxime um pouco.";
      else if (!falha && qr.invalido) falha = "Esse QR não é de um cartão do Gabarito.";
      let mol = null;
      if (!falha) { mol = await molde(qr.codigo); if (!mol) falha = `Não há molde para a prova “${qr.codigo}”.`; }
      let res = null;
      if (!falha) {
        res = OMR.ler(Foto.imageData(quadro.cOMR), mol, qr, {});
        if (!res.ok) falha = res.erro;
        else if ((res.avisos || []).some((a) => /Orientação duvidosa/.test(a))) falha = "Orientação duvidosa: segure firme e tente de novo.";
      }
      if (falha) { motivo = falha; proxima = agora() + APOS_FALHA_MS; log("falha", { motivo: falha.slice(0, 80) }); return; }
      const chave = qr.codigo + "|" + qr.matricula;
      tLeitura = Math.round(agora() - t0);
      if (bloqueio === chave) { proxima = agora() + BLOQUEADO_MS; log("repetida"); return; }   // mesmo cartão ainda na frente: ignora
      sucesso({ cOMR: quadro.cOMR, res, qr, molde: mol, tDecod: tObter, tQR }, chave);
    } finally { ocupado = false; }
  }

  function sucesso(dados, chave) {
    rodando = false; cancelAnimationFrame(raf); pausado = true; atual = { chave };
    motivo = ""; tentandoDesde = 0; hist = [];
    apito();
    log("leitura", { codigo: dados.qr.codigo, matricula: dados.qr.matricula, respostas: dados.res.respostas.map((r) => ({ questao: r.questao, estado: r.estado, letra: r.letra, letras: r.letras })), ms: tLeitura });
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
    const g = $("guia"), c = g.getContext("2d"), W = g.width, H = g.height;
    if (!W) return;
    c.clearRect(0, 0, W, H);
    const m = moldeRef || MOLDE_PADRAO, prop = m.cartao.largura / m.cartao.altura;
    let h = H * 0.9, w = h * prop; if (w > W * 0.9) { w = W * 0.9; h = w / prop; }
    const x = (W - w) / 2, y = (H - h) / 2, r = Math.min(W, H) * 0.03;
    c.lineWidth = Math.max(2, W * 0.004); c.strokeStyle = det.ok ? "rgba(61,220,122,.9)" : "rgba(255,255,255,.75)"; c.setLineDash(det.ok ? [] : [W * 0.03, W * 0.02]);
    c.beginPath(); c.roundRect ? c.roundRect(x, y, w, h, r) : c.rect(x, y, w, h); c.stroke(); c.setLineDash([]);
    for (const p of det.marcas) {   // 4 pontos sobre as marcas achadas (verde = achada e boa; amarelo = achada, mas falta ajuste)
      c.fillStyle = det.ok ? "#3ddc7a" : "#f2b705";
      c.beginPath(); c.arc(p.cx / det.largura * W, p.cy / det.altura * H, Math.max(6, W * 0.018), 0, 2 * Math.PI); c.fill();
    }
  }

  function atualizarPerf(msDeteccao) {
    if (!perfOn) return;
    $("perf").textContent = `${marcasDeTempo.length} checagens/s · marcas ${msDeteccao} ms` + (tLeitura != null ? ` · última leitura ${tLeitura} ms` : "");
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
    const lista = await Foto.listaMoldes();
    if (lista.length) { try { moldeRef = await molde(lista[0]); } catch (e) {} }
    if (new URLSearchParams(location.search).has("perf")) { perfOn = true; $("perf").hidden = false; }
  }

  function parar() { querCamera = false; pausado = false; soltarCamera(); $("telaVivo").hidden = true; }   // vai para o plano B (foto)

  return { iniciarPagina, parar, eventos, iniciar, estado: () => ({ rodando, pausado, bloqueio, camera: !!stream }), ultimaDeteccao: () => ultimaDeteccao };
})();
