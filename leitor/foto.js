/* foto.js — ponte navegador ↔ omr.js: decodifica a foto NO APARELHO, lê o QR e desenha o resultado.
 * A foto nunca é enviada a lugar nenhum (nenhum upload; nenhum localStorage/IndexedDB com imagem ou nome).
 * Só o molde (sem dados pessoais) é buscado por fetch. */
const Foto = (() => {
  let detector = null;

  async function detectorQR() {
    if (!detector) {
      if (!("BarcodeDetector" in self)) throw new Error("BarcodeDetector indisponível (o polyfill não carregou: sem internet?).");
      detector = new BarcodeDetector({ formats: ["qr_code"] });
    }
    return detector;
  }

  function desenhar(bitmap, lado) {
    const s = Math.min(1, lado / Math.max(bitmap.width, bitmap.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bitmap.width * s); c.height = Math.round(bitmap.height * s);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, c.width, c.height);
    return c;
  }

  // Duas versões da mesma foto: até 2400 px (só para o QR: módulos de 0,55 mm) e até 1600 px (resto da leitura).
  async function carregar(blob) {
    const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });   // respeita a rotação EXIF (iPhone)
    const cQR = desenhar(bmp, OMR.C.LADO_MAX_QR), cOMR = desenhar(bmp, OMR.C.LADO_MAX);
    bmp.close();
    return { cQR, cOMR };
  }

  // Quadro ao vivo: UM canvas reaproveitado com o quadro na resolução TOTAL do vídeo (`cheio`) + a cópia de ≤1600 px para a leitura.
  // A cópia de 2400 px do QR só é feita se o recorte não bastar (veja lerQRAoVivo).
  const cvCheio = document.createElement("canvas"), cvRecorte = document.createElement("canvas");
  function deVideo(video) {
    cvCheio.width = video.videoWidth; cvCheio.height = video.videoHeight;
    cvCheio.getContext("2d").drawImage(video, 0, 0);
    return { cheio: cvCheio, cOMR: desenhar(cvCheio, OMR.C.LADO_MAX), largura: cvCheio.width, altura: cvCheio.height };
  }
  function soltarQuadro() { cvCheio.width = 1; cvCheio.height = 1; cvRecorte.width = 1; cvRecorte.height = 1; }   // não deixa imagem na memória

  // Aquece o detector (o polyfill carrega o WebAssembly na 1ª detecção): uma detecção numa imagem branca.
  async function aquecerQR() {
    try {
      const c = document.createElement("canvas"); c.width = 64; c.height = 64;
      const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, 64, 64);
      await (await detectorQR()).detect(c);
      return true;
    } catch (e) { return false; }
  }

  /* QR ao vivo: tenta recortes em resolução nativa em volta da posição prevista pelo molde (via homografia das 4 marcas vivas),
   * depois o espelho 180° (cartão de cabeça para baixo), depois o quadro inteiro (≤2400 px).
   * caixas: [{x,y,w,h,nome}] em px de `cheio`. Devolve {…parseQR, texto, cornerPoints (espaço do cOMR), estrategia} | {invalido} | null. */
  async function lerQRAoVivo(cheio, cOMR, caixas) {
    const det = await detectorQR(), f = cOMR.width / cheio.width;
    let invalido = null;
    for (const cx of caixas) {
      const w = Math.round(Math.min(Math.max(cx.w * 2, 480), OMR.C.LADO_MAX_QR)), h = Math.max(16, Math.round(cx.h * w / cx.w));
      cvRecorte.width = w; cvRecorte.height = h;
      cvRecorte.getContext("2d").drawImage(cheio, cx.x, cx.y, cx.w, cx.h, 0, 0, w, h);
      for (const a of await det.detect(cvRecorte)) {
        const p = OMR.parseQR(a.rawValue);
        if (!p) { invalido = { invalido: true, texto: "(QR que não é do Gabarito)" }; continue; }
        const pts = a.cornerPoints.map(q => ({ x: (cx.x + q.x * cx.w / w) * f, y: (cx.y + q.y * cx.h / h) * f }));
        return Object.assign({ texto: a.rawValue, cornerPoints: pts, estrategia: cx.nome }, p);
      }
    }
    if (invalido) return invalido;
    const cQR = desenhar(cheio, OMR.C.LADO_MAX_QR);
    const r = await lerQR(cQR, cOMR);
    if (r && !r.invalido) r.estrategia = "quadro inteiro";
    return r;
  }

  const imageData = (c) => c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);

  async function lerQR(cQR, cOMR) {
    const det = await detectorQR();
    const achados = await det.detect(cQR);
    const f = cOMR.width / cQR.width;
    for (const a of achados) {
      const p = OMR.parseQR(a.rawValue);
      if (p) return Object.assign({ texto: a.rawValue, cornerPoints: OMR.escalarPontos(a.cornerPoints, f) }, p);
    }
    return achados.length ? { invalido: true, texto: "(QR que não é do Gabarito)" } : null;
  }

  async function moldePorCodigo(codigo) {
    const r = await fetch(`../moldes/${encodeURIComponent(codigo)}_molde.json`, { cache: "no-store" });
    return r.ok ? r.json() : null;
  }

  async function listaMoldes() {
    try { const r = await fetch("../moldes/index.json", { cache: "no-store" }); return r.ok ? r.json() : []; } catch (e) { return []; }
  }

  // Desenho por cima: marcas (azul), bolhas (verde = marcada, amarelo = dúvida/dupla, cinza fino = vazia).
  function sobrepor(ctx, res, esc) {
    ctx.save();
    ctx.lineWidth = Math.max(1.5, 2 * esc);
    for (const m of res.marcas || []) {
      ctx.strokeStyle = "#1f6feb"; const l = m.lado * esc;
      ctx.strokeRect(m.cx * esc - l / 2 - 3, m.cy * esc - l / 2 - 3, l + 6, l + 6);
    }
    const porQ = new Map((res.respostas || []).map(r => [r.questao, r]));
    for (const b of res.bolhas || []) {
      const r = porQ.get(b.questao); let cor = "rgba(120,120,120,.55)", lw = 1;
      if (r) {
        if (r.estado === "marcada" && r.letra === b.alternativa) { cor = "#12b34a"; lw = 3; }
        else if ((r.estado === "dupla" || r.estado === "duvida") && (r.letras || []).includes(b.alternativa)) { cor = "#f2b705"; lw = 3; }
      }
      ctx.strokeStyle = cor; ctx.lineWidth = Math.max(1, lw * esc * 1.2);
      ctx.beginPath(); ctx.arc(b.u * esc, b.v * esc, b.r * esc, 0, 2 * Math.PI); ctx.stroke();
    }
    ctx.restore();
  }

  function descricao(r) {
    if (r.estado === "marcada") return r.letra;
    if (r.estado === "branco") return "em branco";
    if (r.estado === "dupla") return `dupla (${r.letras.join(" e ")})`;
    return `dúvida (${(r.letras || []).join(", ") || "—"})`;
  }

  return { carregar, deVideo, soltarQuadro, aquecerQR, lerQRAoVivo, imageData, lerQR, moldePorCodigo, listaMoldes, sobrepor, descricao };
})();
