"""Serve uma pasta por HTTPS com certificado autoassinado EFÊMERO (só para testar a câmera ao vivo no iPhone:
getUserMedia exige HTTPS). Uso: python3 ferramentas/servir_https.py PASTA PORTA IP
O certificado e a chave ficam na própria PASTA temporária (apagada pelo servir_leitor.sh); nada é versionado."""
import http.server, ssl, subprocess, sys
from functools import partial
from pathlib import Path

pasta, porta, ip = Path(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
chave, cert = pasta.parent / (pasta.name + ".key"), pasta.parent / (pasta.name + ".crt")
san = f"subjectAltName=DNS:localhost,IP:127.0.0.1" + (f",IP:{ip}" if ip[0].isdigit() else "")
subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", str(chave), "-out", str(cert),
                "-days", "2", "-subj", "/CN=gabarito-teste", "-addext", san], check=True, capture_output=True)
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); ctx.load_cert_chain(cert, chave)
chave.unlink(); cert.unlink()   # já carregados na memória
srv = http.server.ThreadingHTTPServer(("0.0.0.0", porta), partial(http.server.SimpleHTTPRequestHandler, directory=str(pasta)))
srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
try: srv.serve_forever()
except KeyboardInterrupt: pass
