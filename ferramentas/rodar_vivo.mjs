// Testa o MODO AO VIVO no Chromium headless com câmera FALSA (vídeo montado por ferramentas/video_teste.py).
// Uso: node ferramentas/rodar_vivo.mjs VIDEO.mjpeg [--esperado 01_base,05_perspectiva] [--max 30] [--screenshot arq.png]
//   --esperado: fotos sintéticas (sem extensão) que devem ser lidas, UMA vez cada, nesta ordem (vazio = mesa vazia: nenhuma leitura)
//   O servidor precisa estar de pé:  python3 -m http.server 8000 --bind 127.0.0.1
// O script faz o papel do professor: depois de cada leitura espera 0,5 s e toca em "Confirmar".
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const OMR = createRequire(import.meta.url)(resolve(aqui, "../leitor/omr.js"));
const args = process.argv.slice(2);
const pega = (nome, def) => { const i = args.indexOf(nome); return i >= 0 ? args.splice(i, 2)[1] : def; };
const esperado = (pega("--esperado", "") || "").split(",").filter(Boolean);
const maxS = Number(pega("--max", "30"));
const shot = pega("--screenshot", null);
const trace = args.includes("--trace") ? (args.splice(args.indexOf("--trace"), 1), true) : false; let dicaAnt = "";
const viewport = pega("--viewport", null);   // ex.: 390x844x3 (largura x altura x dpr): simula a tela do iPhone
const gum = pega("--gum", null);             // "livre": getUserMedia sem restrições de tamanho (a câmera falsa então entrega o tamanho do arquivo)
const shotDica = pega("--shot-dica", null), shotDicaArq = pega("--shot-dica-arq", null);
const video = resolve(args[0] || "");
const url = pega("--url", "http://127.0.0.1:8000/leitor/index.html?perf=1");
const porta = 9300 + Math.floor(Math.random() * 500);
const perfil = mkdtempSync(join(tmpdir(), "gab-chrome-"));
const chrome = spawn(process.env.CHROMIUM || "chromium", [
  "--headless=new", "--disable-gpu", "--no-sandbox", `--remote-debugging-port=${porta}`, `--user-data-dir=${perfil}`,
  "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${video}`,
  "--autoplay-policy=no-user-gesture-required", "--window-size=500,1000", "about:blank"], { stdio: "ignore" });
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
try {
  let alvo;
  for (let i = 0; i < 60 && !alvo; i++) { try { const l = await (await fetch(`http://127.0.0.1:${porta}/json`)).json(); alvo = l.find((t) => t.type === "page"); } catch { await dorme(250); } }
  if (!alvo) throw new Error("Chromium não respondeu.");
  ws = new WebSocket(alvo.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else if (d.method === "Runtime.consoleAPICalled") console.error("[console]", d.params.args.map(a => a.value ?? a.description).join(" ")); else if (d.method === "Runtime.exceptionThrown") console.error("[exceção]", d.params.exceptionDetails.text, d.params.exceptionDetails.exception?.description || ""); };
  const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expressao) => (await cdp("Runtime.evaluate", { expression: expressao, returnByValue: true, awaitPromise: true })).result?.result?.value;
  await cdp("Runtime.enable"); await cdp("Page.enable");
  if (viewport) { const [w, h, d] = viewport.split("x").map(Number); await cdp("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: d || 1, mobile: true }); }
  if (gum === "livre") await cdp("Page.addScriptToEvaluateOnNewDocument", { source: "(() => { const o = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getUserMedia = (c) => o({ audio: false, video: true }); })();" });
  await cdp("Page.navigate", { url });
  await dorme(2500);   // polyfill do QR (jsDelivr) e moldes
  console.log("polyfill BarcodeDetector:", await ev('"BarcodeDetector" in self'));
  await ev('document.getElementById("ligar").click()');
  const amostras = [], msAmostras = []; let tam = "?";
  const t0 = Date.now(); let confirmadas = 0, ultimaLeitura = 0, shotFeito = false;
  while ((Date.now() - t0) / 1000 < maxS) {
    await dorme(150);
    if (shotDica && shotDicaArq && !globalThis.__feito && (await ev('document.getElementById("dica").textContent')) === shotDica) { const s = await cdp("Page.captureScreenshot", { format: "png" }); writeFileSync(shotDicaArq, Buffer.from(s.result.data, "base64")); globalThis.__feito = true; }
    if (trace) { const d = await ev('document.getElementById("dica").textContent'); if (d !== dicaAnt) { dicaAnt = d; console.log(`  [${((Date.now() - t0) / 1000).toFixed(1)}s] ${d}  ${await ev('JSON.stringify(Vivo.detalhe())')}`); } }
    { const m = JSON.parse(await ev("JSON.stringify(Vivo.metricas())")); tam = m.video; if ((await ev("Vivo.estado().rodando")) && m.checagensPorSeg) { amostras.push(m.checagensPorSeg); msAmostras.push(m.msChecagem); } }
    const evs = JSON.parse(await ev("JSON.stringify(Vivo.eventos)") || "[]");
    const leituras = evs.filter((e) => e.tipo === "leitura");
    if (leituras.length > confirmadas) {
      ultimaLeitura = Date.now();
      if (shot && !shotFeito) { const s = await cdp("Page.captureScreenshot", { format: "png" }); writeFileSync(shot, Buffer.from(s.result.data, "base64")); shotFeito = true; }
      await dorme(500); await ev('document.getElementById("confirmar").click()'); confirmadas = leituras.length;
    }
    if (esperado.length && confirmadas >= esperado.length && Date.now() - ultimaLeitura > 5000) break;
    if (!esperado.length && (Date.now() - t0) / 1000 > 7) break;
  }
  const evs = JSON.parse(await ev("JSON.stringify(Vivo.eventos)") || "[]");
  const estado = await ev("JSON.stringify(Vivo.estado())"), perf = await ev('document.getElementById("perf").textContent');
  const leituras = evs.filter((e) => e.tipo === "leitura");
  const cont = (t) => evs.filter((e) => e.tipo === t).length;
  const med = (a) => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0;
  console.log(`\nvídeo entregue pela câmera: ${tam} · checagens/s (mediana ${med(amostras)}, máx ${Math.max(0, ...amostras)}) · ms/checagem (mediana ${med(msAmostras)})`);
  console.log(`leituras exibidas: ${leituras.length} (esperado ${esperado.length}) · falhas: ${cont("falha")} · repetidas ignoradas: ${cont("repetida")} · cartão saiu: ${cont("cartao-saiu")} · câmera morreu: ${cont("camera-morreu")}`);
  const motivos = {}; for (const e of evs.filter((e) => e.tipo === "falha")) motivos[e.motivo] = (motivos[e.motivo] || 0) + 1;
  if (Object.keys(motivos).length) console.log("motivos das falhas:", JSON.stringify(motivos));
  const ls = evs.filter((e) => e.tipo === "leitura"); if (ls.length) console.log("leitura: " + ls.map((e) => `QR ${e.tQR} ms (${e.estrategiaQR}), bolhas ${e.tBolhas} ms, total ${e.ms} ms`).join(" | "));
  console.log("desempenho na tela:", perf, "| estado:", estado);
  let erros = 0;
  if (leituras.length !== esperado.length) { erros++; console.log("ERRO: número de leituras diferente do esperado"); }
  for (let i = 0; i < Math.min(leituras.length, esperado.length); i++) {
    const verdade = JSON.parse(readFileSync(resolve(aqui, "../testes/sinteticos", esperado[i] + ".json"), "utf8"));
    const lido = { respostas: leituras[i].respostas }, av = OMR.avaliar(lido, verdade);
    const ok = av.filter((a) => a.ok).length, crit = av.filter((a) => a.critico).length;
    const idOk = leituras[i].matricula === verdade.matricula && leituras[i].codigo === verdade.codigo;
    console.log(`  leitura ${i + 1}: ${esperado[i]} → ${ok}/${av.length} certas, críticas=${crit}, matrícula/código ${idOk ? "batem" : "NÃO BATEM"}, ${leituras[i].ms} ms`);
    for (const a of av.filter((a) => !a.ok)) console.log(`      Q${a.questao} (${a.tipo}): esperado ${a.esperado} lido ${a.lido}`);
    if (ok !== av.length || crit || !idOk) erros++;
  }
  console.log(erros ? `\nRESULTADO: FALHOU (${erros})` : "\nRESULTADO: OK");
  process.exitCode = erros ? 1 : 0;
} finally {
  try { ws?.close(); } catch {}
  chrome.kill("SIGKILL"); await dorme(200); try { rmSync(perfil, { recursive: true, force: true }); } catch {}
}
