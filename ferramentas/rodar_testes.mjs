// Roda leitor/testes.html no Chromium headless (via CDP) e imprime o relatório.
// Uso: node ferramentas/rodar_testes.mjs [url] [--screenshot arquivo.png]
//   O servidor precisa estar de pé:  python -m http.server 8000 --bind 127.0.0.1
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const iShot = args.indexOf("--screenshot");
const shot = iShot >= 0 ? args.splice(iShot, 2)[1] : null;
const url = args[0] || "http://127.0.0.1:8000/leitor/testes.html?auto=1";
const porta = 9300 + Math.floor(Math.random() * 500);
const perfil = mkdtempSync(join(tmpdir(), "gab-chrome-"));
const chrome = spawn(process.env.CHROMIUM || "chromium", [
  "--headless=new", "--disable-gpu", "--no-sandbox", `--remote-debugging-port=${porta}`, `--user-data-dir=${perfil}`,
  "--window-size=1200,1800", "about:blank"], { stdio: "ignore" });
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
try {
  let alvo;
  for (let i = 0; i < 60 && !alvo; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${porta}/json`)).json(); alvo = l.find((t) => t.type === "page"); } catch { await dorme(250); }
  }
  if (!alvo) throw new Error("Chromium não respondeu na porta de depuração.");
  ws = new WebSocket(alvo.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else if (d.method === "Runtime.consoleAPICalled") console.error("[console]", d.params.args.map(a => a.value ?? a.description).join(" ")); else if (d.method === "Runtime.exceptionThrown") console.error("[exceção]", d.params.exceptionDetails.text, d.params.exceptionDetails.exception?.description || ""); };
  const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await cdp("Runtime.enable"); await cdp("Page.enable");
  await cdp("Page.navigate", { url });
  let resultado = null;
  for (let i = 0; i < 600 && !resultado; i++) {   // até ~5 min
    await dorme(500);
    const r = await cdp("Runtime.evaluate", { expression: "JSON.stringify(window.__resultado || null)", returnByValue: true });
    const v = r.result?.result?.value; if (v && v !== "null") resultado = JSON.parse(v);
  }
  if (!resultado) throw new Error("Tempo esgotado esperando window.__resultado.");
  if (shot) { const s = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); writeFileSync(shot, Buffer.from(s.result.data, "base64")); }
  if (resultado.falha) { console.log("FALHA:", resultado.falha); process.exitCode = 1; }
  else {
    const p = (o) => `${o.ok}/${o.n} (${(100 * o.ok / o.n).toFixed(0)}%)`.padEnd(12);
    console.log(`TOTAL ${p(resultado.total)} críticos(letra errada)=${resultado.total.critico} leves=${resultado.total.leve}${resultado.semqr ? "  [sem QR]" : ""}`);
    console.log("\nPor tipo de marcação:");
    for (const [k, o] of Object.entries(resultado.por_tipo)) console.log(`  ${k.padEnd(8)} ${p(o)} críticos=${o.critico} leves=${o.leve}`);
    console.log("\nPor tipo de foto:");
    for (const [k, o] of Object.entries(resultado.por_caso)) console.log(`  ${k.padEnd(16)} ${p(o)} críticos=${o.critico}`);
    console.log("\nImagens:");
    for (const im of resultado.imagens) console.log(`  ${im.imagem.padEnd(22)} ${String(im.ok).padStart(2)}/${im.n} crit=${im.criticos} qr=${im.qr} mat=${im.matricula_ok} bloco=${im.bloco_achado} ${im.tempo_ms}ms${im.erro ? "  ERRO: " + im.erro : ""}${im.avisos.length ? "  avisos: " + im.avisos.join(" | ") : ""}${im.leves.length ? "\n      leves: " + im.leves.join(", ") : ""}`);
    if (process.env.DIST) for (const [t, l] of Object.entries(resultado.distribuicao)) { const a = l.map(x => x[0]).sort((x, y) => x - y); console.log(`\n  valor 1º ${t}: min=${a[0]} p10=${a[Math.floor(a.length * .1)]} med=${a[Math.floor(a.length / 2)]} p90=${a[Math.floor(a.length * .9)]} max=${a[a.length - 1]}`); }
    if (process.env.DEBUG_IMG) for (const im of resultado.imagens) if (im.erro || im.imagem.startsWith(process.env.DEBUG_IMG)) console.log(im.imagem, "dim", im.dim, "marcas", JSON.stringify(im.marcas), "cands", JSON.stringify(im.cand), "\n   top", JSON.stringify(im.top));
    if (resultado.criticos.length) console.log("\nCRÍTICOS:\n  " + resultado.criticos.join("\n  "));
  }
} finally {
  try { ws?.close(); } catch {}
  chrome.kill("SIGKILL"); await dorme(200); try { rmSync(perfil, { recursive: true, force: true }); } catch {}
}
