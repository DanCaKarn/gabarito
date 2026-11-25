/* omr.js — visão do leitor de cartões Gabarito. Funções puras, sem DOM.
 * Opera sobre {width, height, data} (como ImageData, RGBA). Global `OMR` no navegador, module.exports no node.
 * A foto NUNCA sai daqui: nada de rede, nada de armazenamento. Sem nomes de alunos (o leitor não os tem). */
(function (raiz, fabrica) {
  if (typeof module === "object" && module.exports) module.exports = fabrica();
  else raiz.OMR = fabrica();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ===================== CONSTANTES (ajustáveis) =====================
  const C = {
    LADO_MAX: 1600,          // px, maior lado da imagem usada na leitura
    LADO_MAX_QR: 2400,       // px, maior lado da cópia usada só para o QR
    JANELA_BOLHAS: 1 / 20,   // janela do limiar adaptativo (fração da largura) para as bolhas
    JANELA_MARCAS: 1 / 6,    // janela maior para as marcas sólidas (o miolo de um quadrado grande sumiria)
    DESCONTO: 0.15,          // tinta = cinza < média local × (1 − DESCONTO)
    DIF_MIN: 18,             // ... e pelo menos DIF_MIN níveis abaixo da média (ignora ruído em fundo uniforme)
    RAIO_DISCO: 0.6,         // disco medido = RAIO_DISCO × raio da bolha
    LIMIAR_BRANCO: 0.10,     // fração de tinta abaixo disto = bolha vazia
    LIMIAR_SEGUNDA: 0.40,    // 'marcada' exige que a 2ª bolha esteja abaixo disto (senão: dúvida; uma dupla com uma bolha falhada não vira letra)
    LIMIAR_MARCA: 0.76,      // fração de tinta a partir da qual a bolha conta como pintada
    FOLGA: 0.25,             // diferença mínima entre a 1ª e a 2ª bolha para haver vencedora
    MARCA_RAZAO_MIN: 0.7, MARCA_RAZAO_MAX: 1.4,   // proporção da caixa da marca
    MARCA_PREENCH_MIN: 0.7,  // preenchimento mínimo (em relação ao octógono envolvente: tolera rotação/perspectiva)
    MARCA_LADO_MIN: 0.008, MARCA_LADO_MAX: 0.09,  // lado da marca / maior lado da imagem
    MARCA_TAM_MAX: 3.0,      // razão máxima entre a maior e a menor das 4 marcas (a perspectiva muda o tamanho)
    MARCA_PISO_REL: 0.5,     // descarta candidatas menores que isto × a 4ª maior (ex.: tesourinha, pontos soltos)
    TOL_PROPORCAO: 0.15,     // tolerância da proporção do quadrilátero × molde
    TOL_QR_MM: 3,            // QR previsto × QR visto
    TOL_BLOCO_MM: 2.5,       // busca da marca do bloco perto da posição prevista
    // --- modo ao vivo (detecção rápida só das 4 marcas) ---
    VIVO_LADO: 720,          // px, maior lado do quadro reduzido usado na detecção ao vivo
    VIVO_AREA_MIN: 0.10,     // área do quadrilátero das marcas / área do quadro: abaixo disto, "Aproxime"
    VIVO_AREA_MAX: 0.85,     // acima disto (ou marca encostada na borda), "Afaste"
    VIVO_BORDA: 0.012,       // marca a menos desta fração da borda do quadro = cartão cortado
    VIVO_DESLOC: 0.015,      // deslocamento máximo entre checagens, como fração do lado do quadrilátero
    VIVO_ESTAVEIS: 3,        // checagens seguidas, estáveis, antes de capturar o quadro inteiro
  };

  const agora = typeof performance !== "undefined" ? () => performance.now() : () => Date.now();
  class ErroLeitura extends Error {}

  // ===================== 1. cinza (canal vermelho) e redução =====================
  function cinzaVermelho(img, ladoMax) {
    const W = img.width, H = img.height, d = img.data;
    const s = Math.min(1, ladoMax / Math.max(W, H));
    const w = Math.max(1, Math.round(W * s)), h = Math.max(1, Math.round(H * s));
    const gray = new Uint8Array(w * h);
    if (s === 1) {
      for (let i = 0; i < w * h; i++) gray[i] = d[i * 4];
      return { width: w, height: h, gray, escala: 1 };
    }
    const fx = W / w, fy = H / h;
    for (let y = 0; y < h; y++) {
      const y0 = Math.floor(y * fy), y1 = Math.max(y0 + 1, Math.min(H, Math.floor((y + 1) * fy)));
      for (let x = 0; x < w; x++) {
        const x0 = Math.floor(x * fx), x1 = Math.max(x0 + 1, Math.min(W, Math.floor((x + 1) * fx)));
        let soma = 0;
        for (let yy = y0; yy < y1; yy++) { let k = (yy * W + x0) * 4; for (let xx = x0; xx < x1; xx++, k += 4) soma += d[k]; }
        gray[y * w + x] = soma / ((y1 - y0) * (x1 - x0));
      }
    }
    return { width: w, height: h, gray, escala: s };
  }

  function suavizar3(g, w, h) {   // média 3×3 (separável) — reduz ruído antes do limiar
    const t = new Float32Array(w * h), o = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const a = g[y * w + Math.max(0, x - 1)], b = g[y * w + x], c = g[y * w + Math.min(w - 1, x + 1)];
      t[y * w + x] = (a + b + c) / 3;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      o[y * w + x] = (t[Math.max(0, y - 1) * w + x] + t[y * w + x] + t[Math.min(h - 1, y + 1) * w + x]) / 3;
    }
    return o;
  }

  // ===================== 2. limiar adaptativo (imagem integral) =====================
  function integral(g, w, h) {
    const W1 = w + 1, I = new Float64Array(W1 * (h + 1));
    for (let y = 0; y < h; y++) {
      let linha = 0;
      for (let x = 0; x < w; x++) { linha += g[y * w + x]; I[(y + 1) * W1 + x + 1] = I[y * W1 + x + 1] + linha; }
    }
    return I;
  }

  function limiarAdaptativo(g, w, h, janelaPx, desconto, difMin, I) {
    I = I || integral(g, w, h);
    const W1 = w + 1, r = Math.max(2, Math.round(janelaPx / 2)), ink = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
        const soma = I[(y1 + 1) * W1 + x1 + 1] - I[y0 * W1 + x1 + 1] - I[(y1 + 1) * W1 + x0] + I[y0 * W1 + x0];
        const media = soma / ((x1 - x0 + 1) * (y1 - y0 + 1));
        const v = g[y * w + x];
        if (v < media * (1 - desconto) && media - v > difMin) ink[y * w + x] = 1;
      }
    }
    return ink;
  }

  // ===================== 3. componentes conexos e marcas =====================
  function componentes(bin, w, h, areaMin) {
    const vis = new Uint8Array(bin), pilha = new Int32Array(w * h), out = [];
    for (let i0 = 0; i0 < w * h; i0++) {
      if (vis[i0] !== 1) continue;
      let sp = 0, n = 0, sx = 0, sy = 0;
      let x0 = w, x1 = -1, y0 = h, y1 = -1, dmin = 1e9, dmax = -1e9, emin = 1e9, emax = -1e9;
      pilha[sp++] = i0; vis[i0] = 2;
      while (sp) {
        const i = pilha[--sp], y = (i / w) | 0, x = i - y * w;
        n++; sx += x; sy += y;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        const d = x + y, e = x - y;
        if (d < dmin) dmin = d; if (d > dmax) dmax = d; if (e < emin) emin = e; if (e > emax) emax = e;
        if (x > 0 && vis[i - 1] === 1) { vis[i - 1] = 2; pilha[sp++] = i - 1; }
        if (x < w - 1 && vis[i + 1] === 1) { vis[i + 1] = 2; pilha[sp++] = i + 1; }
        if (y > 0 && vis[i - w] === 1) { vis[i - w] = 2; pilha[sp++] = i - w; }
        if (y < h - 1 && vis[i + w] === 1) { vis[i + w] = 2; pilha[sp++] = i + w; }
      }
      if (n >= areaMin) out.push({ x0, y0, x1, y1, n, cx: sx / n, cy: sy / n, dmin, dmax, emin, emax });
    }
    return out;
  }

  function preenchimento(c) {   // área / octógono envolvente (caixa ∩ caixa diagonal): tolera rotação do quadrado
    const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
    const tl = Math.max(0, c.dmin - (c.x0 + c.y0)), tr = Math.max(0, (c.x1 - c.y0) - c.emax);
    const br = Math.max(0, (c.x1 + c.y1) - c.dmax), bl = Math.max(0, c.emin - (c.x0 - c.y1));
    const oct = bw * bh - (tl * tl + tr * tr + br * br + bl * bl) / 2;
    return c.n / Math.max(1, oct);
  }

  function candidatosMarca(comps, w, h, ladoMin, ladoMax) {
    const L = Math.max(w, h), lo = ladoMin * L, hi = ladoMax * L, out = [];
    for (const c of comps) {
      const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1, razao = bw / bh;
      if (razao < C.MARCA_RAZAO_MIN || razao > C.MARCA_RAZAO_MAX) continue;
      if (Math.max(bw, bh) < lo || Math.max(bw, bh) > hi) continue;
      const fill = preenchimento(c);
      if (fill < C.MARCA_PREENCH_MIN) continue;
      out.push(Object.assign({ lado: Math.sqrt(c.n), fill }, c));
    }
    return out;
  }

  const NOMES_CANTO_IMG = ["superior esquerdo", "superior direito", "inferior direito", "inferior esquerdo"];

  function dist(a, b) { return Math.hypot(a.cx - b.cx, a.cy - b.cy); }

  function ordenarHorario(pts) {   // em coordenadas de imagem (y para baixo), ângulo crescente = sentido horário na tela
    const mx = pts.reduce((s, p) => s + p.cx, 0) / pts.length, my = pts.reduce((s, p) => s + p.cy, 0) / pts.length;
    return pts.slice().sort((a, b) => Math.atan2(a.cy - my, a.cx - mx) - Math.atan2(b.cy - my, b.cx - mx));
  }

  function escolherMarcas(cands, w, h, molde) {
    if (cands.length < 4) throw new ErroLeitura(`Só ${cands.length} marca(s) de canto candidata(s) achada(s); preciso de 4. Enquadre o cartão inteiro, com os 4 quadrados pretos visíveis.`);
    const grandes = cands.map(c => c.lado).sort((a, b) => b - a), piso = C.MARCA_PISO_REL * grandes[3];
    cands = cands.filter(c => c.lado >= piso);
    const cantos = [{ cx: 0, cy: 0 }, { cx: w, cy: 0 }, { cx: w, cy: h }, { cx: 0, cy: h }];
    const lim = 0.5 * Math.hypot(w, h), usados = new Set(), esc = [];
    for (let k = 0; k < 4; k++) {
      let melhor = null, md = Infinity;
      for (const c of cands) { if (usados.has(c)) continue; const d = dist(c, cantos[k]); if (d < md) { md = d; melhor = c; } }
      if (!melhor || md > lim) throw new ErroLeitura(`Marca do canto ${NOMES_CANTO_IMG[k]} da foto não encontrada.`);
      usados.add(melhor); esc.push(melhor);
    }
    const tam = esc.map(c => c.lado), maior = Math.max(...tam), menor = Math.min(...tam);
    if (maior / menor > C.MARCA_TAM_MAX) throw new ErroLeitura("As 4 marcas achadas têm tamanhos muito diferentes: alguma não é uma marca de canto.");
    const ord = ordenarHorario(esc);
    const lados = [0, 1, 2, 3].map(i => dist(ord[i], ord[(i + 1) % 4]));
    const razao = ((lados[0] + lados[2]) / 2) / ((lados[1] + lados[3]) / 2);
    const mm = molde.marcas;   // TL, TR, BL, BR
    const larg = Math.hypot(mm[1].cx - mm[0].cx, mm[1].cy - mm[0].cy), alt = Math.hypot(mm[2].cx - mm[0].cx, mm[2].cy - mm[0].cy);
    const esperado = larg / alt;
    const err = Math.min(Math.abs(razao / esperado - 1), Math.abs(1 / razao / esperado - 1));
    if (err > C.TOL_PROPORCAO) throw new ErroLeitura(`O quadrilátero das marcas não tem a proporção do cartão (erro ${(err * 100).toFixed(0)}% > ${C.TOL_PROPORCAO * 100}%): marca errada ou foto muito inclinada.`);
    return ord;   // em ordem horária (ponto de partida arbitrário)
  }

  // ===================== 4. orientação =====================
  const ORDEM_HORARIA_MOLDE = [1, 3, 2, 0];   // índices em molde.marcas [TL,TR,BL,BR]: TR, BR, BL, TL

  function pontosCorrespondentes(ord, inicio, molde) {   // ord[inicio] = TR do molde
    const src = [], dst = [];
    for (let k = 0; k < 4; k++) {
      const m = molde.marcas[ORDEM_HORARIA_MOLDE[k]], p = ord[(inicio + k) % 4];
      src.push([m.cx, m.cy]); dst.push([p.cx, p.cy]);
    }
    return { src, dst };
  }

  // ===================== 5. homografia =====================
  function resolver(A, b) {   // Gauss com pivoteamento parcial; A é n×n
    const n = b.length, M = A.map((l, i) => l.concat([b[i]]));
    for (let i = 0; i < n; i++) {
      let p = i;
      for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k;
      if (Math.abs(M[p][i]) < 1e-12) throw new ErroLeitura("Homografia degenerada (marcas alinhadas?).");
      [M[i], M[p]] = [M[p], M[i]];
      for (let k = i + 1; k < n; k++) { const f = M[k][i] / M[i][i]; for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j]; }
    }
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; }
    return x;
  }

  function homografia(src, dst) {   // N ≥ 4 pontos; N = 4 exato, N > 4 mínimos quadrados (equações normais 8×8)
    const A = [], b = [];
    for (let i = 0; i < src.length; i++) {
      const [x, y] = src[i], [u, v] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    const AtA = Array.from({ length: 8 }, () => new Array(8).fill(0)), Atb = new Array(8).fill(0);
    for (let r = 0; r < A.length; r++) for (let i = 0; i < 8; i++) { Atb[i] += A[r][i] * b[r]; for (let j = 0; j < 8; j++) AtA[i][j] += A[r][i] * A[r][j]; }
    return resolver(AtA, Atb);
  }

  function projetar(H, x, y) {
    const d = H[6] * x + H[7] * y + 1;
    return [(H[0] * x + H[1] * y + H[2]) / d, (H[3] * x + H[4] * y + H[5]) / d];
  }

  function pxPorMm(H, x, y) {
    const [u, v] = projetar(H, x, y), [u1, v1] = projetar(H, x + 1, y), [u2, v2] = projetar(H, x, y + 1);
    return (Math.hypot(u1 - u, v1 - v) + Math.hypot(u2 - u, v2 - v)) / 2;
  }

  function refinarComBloco(H, src, dst, molde, candsMarcas) {
    if (!molde.marcas_bloco || !molde.marcas_bloco.length) return { H, achadas: 0 };
    const S = src.slice(), D = dst.slice();
    let achadas = 0;
    for (const m of molde.marcas_bloco) {
      const [u, v] = projetar(H, m.cx, m.cy), s = pxPorMm(H, m.cx, m.cy), raio = C.TOL_BLOCO_MM * s;
      let melhor = null, md = Infinity;
      for (const c of candsMarcas) {
        const d = Math.hypot(c.cx - u, c.cy - v);
        if (d < md && d <= raio && Math.abs(c.lado / (m.tamanho * s) - 1) < 0.4) { md = d; melhor = c; }
      }
      if (melhor) { S.push([m.cx, m.cy]); D.push([melhor.cx, melhor.cy]); achadas++; }
    }
    return achadas ? { H: homografia(S, D), achadas } : { H, achadas: 0 };
  }

  // ===================== 6. medição das bolhas =====================
  function medirBolhas(ink, gray, w, h, H, molde, I) {
    const W1 = w + 1, out = [];
    for (const b of molde.bolhas) {
      const [u, v] = projetar(H, b.cx, b.cy), s = pxPorMm(H, b.cx, b.cy);
      const r = Math.max(1.5, b.r * s * C.RAIO_DISCO), r2 = r * r;
      let n = 0, tinta = 0, soma = 0;
      const x0 = Math.max(0, Math.floor(u - r)), x1 = Math.min(w - 1, Math.ceil(u + r));
      const y0 = Math.max(0, Math.floor(v - r)), y1 = Math.min(h - 1, Math.ceil(v + r));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const dx = x - u, dy = y - v;
        if (dx * dx + dy * dy > r2) continue;
        n++; tinta += ink[y * w + x]; soma += gray[y * w + x];
      }
      let frac = 0, escuridao = 0;
      if (n > 0) {
        frac = tinta / n;
        // escuridão contínua: 1 − (cinza médio do disco ÷ cinza médio de uma janela maior em volta)
        const R = Math.round(r * 3), a0 = Math.max(0, Math.round(u) - R), a1 = Math.min(w - 1, Math.round(u) + R);
        const c0 = Math.max(0, Math.round(v) - R), c1 = Math.min(h - 1, Math.round(v) + R);
        const ref = (I[(c1 + 1) * W1 + a1 + 1] - I[c0 * W1 + a1 + 1] - I[(c1 + 1) * W1 + a0] + I[c0 * W1 + a0]) / ((a1 - a0 + 1) * (c1 - c0 + 1));
        escuridao = Math.max(0, Math.min(1, 1 - (soma / n) / Math.max(1, ref)));
      }
      out.push({ questao: b.questao, alternativa: b.alternativa, u, v, r: b.r * s, frac, escuridao });
    }
    return out;
  }

  // ===================== 7. decisão por questão =====================
  function decidirQuestao(valores) {   // valores: [{letra, v}] da MESMA questão
    const ord = valores.slice().sort((a, b) => b.v - a.v), v0 = ord[0].v, v1 = ord.length > 1 ? ord[1].v : 0;
    const marcadas = ord.filter(o => o.v >= C.LIMIAR_MARCA);
    if (v0 < C.LIMIAR_BRANCO) return { estado: "branco", confianca: Math.max(0, 1 - v0 / C.LIMIAR_BRANCO) };
    if (marcadas.length >= 2) return { estado: "dupla", letras: marcadas.map(o => o.letra).sort(), confianca: 0 };
    if (marcadas.length === 1 && v0 - v1 >= C.FOLGA && v1 < C.LIMIAR_SEGUNDA) return { estado: "marcada", letra: ord[0].letra, confianca: Math.min(1, v0 - v1) };
    return { estado: "duvida", letras: ord.filter(o => o.v >= C.LIMIAR_BRANCO).map(o => o.letra).sort(), confianca: 0 };
  }

  function parseQR(texto) {
    const m = /^GAB1\|([^|]*)\|([^|]*)$/.exec(texto || "");
    return m ? { codigo: m[1], matricula: m[2] } : null;
  }

  function escalarPontos(pts, f) { return pts.map(p => ({ x: p.x * f, y: p.y * f })); }


  // ===================== modo ao vivo: detecção rápida das 4 marcas =====================
  /* detectarMarcas(img, molde, opc) — só as marcas de canto, num quadro reduzido (C.VIVO_LADO).
   * `molde` serve apenas para a proporção do cartão (todos os moldes do mesmo formato têm a mesma).
   * Devolve {achou, ok, dica, marcas[{cx,cy,lado}] (px do quadro reduzido), largura, altura, ladoQuad, areaRel, candidatas, ms}.
   *   achou = 4 marcas válidas (quadrilátero com a proporção do cartão); ok = achou E tamanho/posição bons para capturar.
   *   dica: "aponte" | "reto" | "aproxime" | "afaste" | null */
  function detectarMarcas(img, molde, opc) {
    opc = opc || {};
    const t0 = agora();
    const g = cinzaVermelho(img, opc.lado || C.VIVO_LADO), w = g.width, h = g.height;
    const gs = suavizar3(g.gray, w, h), I = integral(gs, w, h);
    const ink = limiarAdaptativo(gs, w, h, C.JANELA_MARCAS * w, C.DESCONTO, C.DIF_MIN, I);
    const cands = candidatosMarca(componentes(ink, w, h, 6), w, h, C.MARCA_LADO_MIN, C.MARCA_LADO_MAX);
    const out = { achou: false, ok: false, dica: "aponte", marcas: [], largura: w, altura: h, candidatas: cands.length };
    try {
      const ord = escolherMarcas(cands, w, h, molde);
      out.marcas = ord.map(p => ({ cx: p.cx, cy: p.cy, lado: p.lado }));
      out.achou = true;
      let area = 0;
      for (let i = 0; i < 4; i++) { const a = ord[i], b = ord[(i + 1) % 4]; area += a.cx * b.cy - b.cx * a.cy; }
      out.areaRel = Math.abs(area) / 2 / (w * h);
      out.ladoQuad = [0, 1, 2, 3].reduce((s, i) => s + dist(ord[i], ord[(i + 1) % 4]), 0) / 4;
      const bx = C.VIVO_BORDA * w, by = C.VIVO_BORDA * h;
      const cortado = ord.some(p => p.cx - p.lado / 2 < bx || p.cx + p.lado / 2 > w - bx || p.cy - p.lado / 2 < by || p.cy + p.lado / 2 > h - by);
      if (out.areaRel < C.VIVO_AREA_MIN) out.dica = "aproxime";
      else if (out.areaRel > C.VIVO_AREA_MAX || cortado) out.dica = "afaste";
      else { out.ok = true; out.dica = null; }
    } catch (e) {
      if (!(e instanceof ErroLeitura)) throw e;
      out.dica = /propor/.test(e.message) ? "reto" : "aponte";
    }
    out.ms = Math.round((agora() - t0) * 10) / 10;
    return out;
  }

  // Maior deslocamento de uma marca de `a` para a marca mais próxima de `b`, como fração do lado do quadrilátero de `b`.
  function deslocamentoRel(a, b) {
    let pior = 0;
    for (const p of a.marcas) {
      let m = Infinity;
      for (const q of b.marcas) m = Math.min(m, Math.hypot(p.cx - q.cx, p.cy - q.cy));
      pior = Math.max(pior, m);
    }
    return pior / b.ladoQuad;
  }

  // ===================== 8. leitura completa =====================
  /* ler(img, molde, qr, opc)
   *   img   : {width,height,data} (RGBA), de preferência já ≤ LADO_MAX
   *   molde : objeto do molde JSON (mm, origem no canto sup. esq. do cartão)
   *   qr    : {cornerPoints:[{x,y}×4]} NAS COORDENADAS de `img` (ou null se o QR não foi achado)
   *   opc   : {guardarBinaria:boolean}
   * Devolve {ok, erro?, avisos[], marcas[], bolhas[], respostas[], confianca, tempos_ms, largura, altura, orientacao, binaria?} */
  function ler(img, molde, qr, opc) {
    opc = opc || {};
    const tempos = {}; let t0 = agora(); const T0 = t0;
    const lap = (nome) => { const t = agora(); tempos[nome] = Math.round((t - t0) * 10) / 10; t0 = t; };
    const res = { ok: false, avisos: [], marcas: [], bolhas: [], respostas: [], tempos_ms: tempos };
    try {
      const g = cinzaVermelho(img, C.LADO_MAX), w = g.width, h = g.height;
      res.largura = w; res.altura = h; lap("reduzir");
      const gs = suavizar3(g.gray, w, h), I = integral(gs, w, h);
      const inkB = limiarAdaptativo(gs, w, h, C.JANELA_BOLHAS * w, C.DESCONTO, C.DIF_MIN, I);
      const inkM = limiarAdaptativo(gs, w, h, C.JANELA_MARCAS * w, C.DESCONTO, C.DIF_MIN, I);
      lap("limiar");
      if (opc.guardarBinaria) res.binaria = { width: w, height: h, ink: inkB, inkMarcas: inkM };
      const comps = componentes(inkM, w, h, 12);
      const cands = candidatosMarca(comps, w, h, C.MARCA_LADO_MIN, C.MARCA_LADO_MAX);
      lap("componentes");
      res.componentes_top = comps.slice().sort((a, b) => b.n - a.n).slice(0, 14).map(c => ({ cx: Math.round(c.cx), cy: Math.round(c.cy), bw: c.x1 - c.x0 + 1, bh: c.y1 - c.y0 + 1, n: c.n, fill: +preenchimento(c).toFixed(2) }));
      res.candidatas = cands.map(c => ({ cx: c.cx, cy: c.cy, lado: c.lado }));
      const ord = escolherMarcas(cands, w, h, molde);
      res.marcas = ord.map(p => ({ cx: p.cx, cy: p.cy, lado: p.lado }));
      lap("marcas");

      // orientação
      let inicio = -1;
      const qc = qr && qr.cornerPoints && qr.cornerPoints.length >= 4
        ? { cx: qr.cornerPoints.reduce((s, p) => s + p.x, 0) / qr.cornerPoints.length, cy: qr.cornerPoints.reduce((s, p) => s + p.y, 0) / qr.cornerPoints.length } : null;
      if (qc) {
        let md = Infinity;
        ord.forEach((p, i) => { const d = dist(p, qc); if (d < md) { md = d; inicio = i; } });
        res.orientacao = "pelo QR";
      } else {
        res.avisos.push("QR não lido: orientação inferida pelas marcas do molde escolhido (confira a imagem).");
        let melhor = -Infinity;
        for (let k = 0; k < 4; k++) {
          const { src, dst } = pontosCorrespondentes(ord, k, molde);
          const Hk = homografia(src, dst);
          const ref = refinarComBloco(Hk, src, dst, molde, cands);
          // densidade de tinta na região do QR prevista
          const q = molde.qr, [a, b] = projetar(Hk, q.x + q.tamanho / 2, q.y + q.tamanho / 2), s = pxPorMm(Hk, q.x, q.y);
          let n = 0, t = 0; const R = Math.round(q.tamanho * s * 0.35);
          for (let y = Math.max(0, Math.round(b) - R); y <= Math.min(h - 1, Math.round(b) + R); y++)
            for (let x = Math.max(0, Math.round(a) - R); x <= Math.min(w - 1, Math.round(a) + R); x++) { n++; t += inkB[y * w + x]; }
          const dens = n ? t / n : 0, pont = (ref.achadas ? 1 : 0) + Math.min(dens, 0.5) * 2;
          if (pont > melhor) { melhor = pont; inicio = k; }
        }
        res.orientacao = "inferida (sem QR)";
      }
      const { src, dst } = pontosCorrespondentes(ord, inicio, molde);
      let H = homografia(src, dst);
      const ref = refinarComBloco(H, src, dst, molde, cands);
      H = ref.H; res.marcas_bloco_achadas = ref.achadas;
      lap("homografia");

      if (qc) {   // verificação cruzada: o QR previsto deve estar onde o detector o viu
        const q = molde.qr, [pu, pv] = projetar(H, q.x + q.tamanho / 2, q.y + q.tamanho / 2), s = pxPorMm(H, q.x, q.y);
        const dmm = Math.hypot(pu - qc.cx, pv - qc.cy) / s;
        if (dmm > C.TOL_QR_MM) res.avisos.push(`Orientação duvidosa: o QR previsto fica a ${dmm.toFixed(1)} mm de onde foi visto.`);
      }
      lap("orientacao");

      const bol = medirBolhas(inkB, g.gray, w, h, H, molde, integral(g.gray, w, h));
      res.bolhas = bol; lap("bolhas");
      const porQ = new Map();
      for (const b of bol) { if (!porQ.has(b.questao)) porQ.set(b.questao, []); porQ.get(b.questao).push(b); }
      let somaConf = 0, minConf = 1;
      for (const [q, lista] of [...porQ.entries()].sort((a, b) => a[0] - b[0])) {
        const d = decidirQuestao(lista.map(b => ({ letra: b.alternativa, v: b.frac })));
        const valores = {}; lista.forEach(b => { valores[b.alternativa] = Math.round(b.frac * 1000) / 1000; });
        res.respostas.push(Object.assign({ questao: q, valores }, d));
        somaConf += d.confianca; minConf = Math.min(minConf, d.confianca);
      }
      res.confianca = { media: res.respostas.length ? somaConf / res.respostas.length : 0, minima: minConf };
      lap("decisao");
      res.ok = true;
    } catch (e) {
      if (!(e instanceof ErroLeitura)) throw e;
      res.erro = e.message;
    }
    tempos.total = Math.round((agora() - T0) * 10) / 10;
    return res;
  }

  // ===================== comparação com a verdade (testes) =====================
  // Devolve por questão: {ok, critico, leve}. critico = LETRA ERRADA (ou letra onde não devia haver).
  function avaliar(lido, verdade) {
    const out = [];
    for (const v of verdade.respostas) {
      const l = lido.respostas.find(r => r.questao === v.questao) || { estado: "ausente" };
      let ok = false, critico = false;
      switch (v.tipo) {
        case "cheia": ok = l.estado === "marcada" && l.letra === v.letra; critico = l.estado === "marcada" && l.letra !== v.letra; break;
        case "branco": ok = l.estado === "branco"; critico = l.estado === "marcada"; break;
        case "dupla": ok = l.estado === "dupla" || l.estado === "duvida"; critico = l.estado === "marcada"; break;
        default: ok = l.estado === "duvida" || l.estado === "dupla"; critico = l.estado === "marcada"; break;   // x, meia
      }
      out.push({ questao: v.questao, tipo: v.tipo, esperado: v.estado, lido: l.estado, ok, critico, leve: !ok && !critico });
    }
    return out;
  }

  return { C, ErroLeitura, cinzaVermelho, suavizar3, integral, limiarAdaptativo, componentes, candidatosMarca, escolherMarcas,
    homografia, projetar, pxPorMm, medirBolhas, decidirQuestao, parseQR, escalarPontos, ler, avaliar, detectarMarcas, deslocamentoRel };
});
