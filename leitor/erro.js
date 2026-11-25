/* erro.js — aviso de erro NA TELA (padrão da Caderneta): mensagem, linha, tamanho da tela e se está instalado.
 * Corta sequências de 6+ dígitos (podem ser matrículas). Carregar ANTES dos outros scripts. */
(function () {
  var caixa = null, jaMostrou = 0;
  function limpa(m) { return String(m == null ? "" : m).replace(/\d{6,}/g, "…").slice(0, 200); }
  function mostrar(msg, onde) {
    try {
      if (++jaMostrou > 5) return;
      var sa = false; try { sa = (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true; } catch (e) {}
      var v = typeof APP_VERSAO !== "undefined" ? "Versão " + APP_VERSAO + " · " : "";
      var t = "Erro: " + limpa(msg) + (onde ? "\n" + onde : "") + "\n" + v + "tela " + innerWidth + "x" + innerHeight + " · " + (sa ? "app instalado" : "navegador");
      if (!caixa) {
        caixa = document.createElement("div");
        caixa.style.cssText = "position:fixed;left:8px;right:8px;bottom:8px;z-index:99999;background:#3d1714;color:#ffd7d2;border:1px solid #ff8a80;border-radius:12px;padding:10px 12px;font:13px/1.35 -apple-system,system-ui,sans-serif;white-space:pre-wrap;-webkit-user-select:text;user-select:text";
        var tx = document.createElement("span"); caixa.appendChild(tx);
        var b = document.createElement("button"); b.textContent = "Fechar";
        b.style.cssText = "display:block;margin-top:8px;padding:6px 14px;border:0;border-radius:8px;background:#ffd7d2;color:#3d1714;font:600 13px system-ui";
        b.onclick = function () { caixa.style.display = "none"; };
        caixa.appendChild(b); (document.body || document.documentElement).appendChild(caixa);
      }
      caixa.firstChild.textContent = t; caixa.style.display = "block";
    } catch (e) {}
  }
  window.__avisoErro = mostrar;
  window.addEventListener("error", function (e) { mostrar(e.message, "linha " + e.lineno + ", coluna " + e.colno); });
  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason; mostrar(r && r.message ? r.message : r, r && r.stack ? "linha " + (String(r.stack).match(/:(\d+):\d+/) || [0, "?"])[1] : "");
  });
})();
