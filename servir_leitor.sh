#!/usr/bin/env bash
# Serve o leitor na rede local (para testar no iPhone) SEM expor dados/ nem saida/.
# Copia só leitor/, moldes/ e testes/ para uma pasta temporária e serve ESSA pasta.
# Ctrl+C encerra o servidor e apaga a pasta temporária.
#   ./servir_leitor.sh [porta]      (padrão 8000)
set -euo pipefail

PORTA="${1:-8000}"
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/gabarito-leitor.XXXXXX")"
trap 'rm -rf "$TMP"; echo; echo "Servidor encerrado; pasta temporária apagada."' EXIT
trap 'exit 130' INT TERM

for pasta in leitor moldes testes; do
  [ -d "$RAIZ/$pasta" ] || { echo "Pasta $pasta/ não existe." >&2; exit 1; }
  cp -r "$RAIZ/$pasta" "$TMP/$pasta"
done

# primeiro IPv4 de rede privada (usa `ip`; `hostname -I` não existe em todas as distros)
IP="$(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 \
      | grep -E '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)' | head -n1 || true)"
IP="${IP:-<IP do PC>}"

echo "Servindo uma CÓPIA de leitor/, moldes/ e testes/ (dados/ e saida/ NÃO estão incluídos)."
if [ "${HTTPS:-1}" = "1" ]; then
  # A câmera ao vivo (getUserMedia) só funciona em HTTPS: certificado autoassinado efêmero. O Safari avisa que a conexão
  # não é privada: toque em "Mostrar detalhes" > "acessar este site" (é o seu PC, na sua rede).
  PORTA="${1:-8443}"
  echo "Servindo uma CÓPIA de leitor/, moldes/ e testes/ (dados/ e saida/ NÃO estão incluídos), por HTTPS."
  echo "No iPhone (mesma rede Wi-Fi), abra:   https://$IP:$PORTA/leitor/   (aceite o aviso do certificado)"
  echo "Para só HTTP (sem câmera ao vivo; só foto):  HTTPS=0 ./servir_leitor.sh"
  echo "Aviso: o servidor fica aberto na rede local até Ctrl+C. O iPhone precisa de internet (QR via jsDelivr)."
  python3 "$RAIZ/ferramentas/servir_https.py" "$TMP" "$PORTA" "$IP"
  exit 0
fi
echo "No iPhone (mesma rede Wi-Fi), abra:   http://$IP:$PORTA/leitor/"
echo "Testes sintéticos:                    http://$IP:$PORTA/leitor/testes.html"
echo "Aviso: o servidor fica aberto na rede local até Ctrl+C. O iPhone precisa de internet (QR via jsDelivr)."
echo "A cópia é um instantâneo: rode de novo para atualizar."
python3 -m http.server "$PORTA" --bind 0.0.0.0 --directory "$TMP"
