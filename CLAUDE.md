# Gabarito — módulo de simulados da Caderneta

Gerador de cartões-resposta em PDF (etapa 1). O leitor (celular) virá depois e usará o "molde" gerado aqui.

## Regras do projeto

### LGPD
- Nomes de alunos NUNCA vão para o git, para o chat nem para a saída do terminal.
  O programa imprime só contagens, nunca nome nem matrícula.
- Dados reais ficam em `dados/` (no `.gitignore`; só `dados/exemplo.csv` é versionado).
- Testes usam alunos fictícios: "Aluno Teste Um", "Aluno Teste Dois"..., matrículas 2023000001, 2023000002...
- Nunca abrir nem imprimir o conteúdo de CSVs reais; usar só `dados/exemplo.csv`.
- Nunca colocar o nome do aluno no QR Code nem no molde.
- `saida/` também fica fora do git (contém cartões com nomes).

### Ambiente
- Python com uv; projeto com `pyproject.toml` próprio (reportlab, segno, pillow). Comando: `uv run gerar_cartoes.py ...`.
- Ambiente base em `~/python/base` (pandas, openpyxl, matplotlib): não alterar.
- Biblioteca nova: dizer quais e o comando uv ANTES de usar. CSV com o módulo `csv` (sem pandas).
- Testes: `uv run python -m unittest discover -s tests -t .`

### Geometria
- Tudo em milímetros, folha A4 retrato (210 x 297), origem no canto superior esquerdo, y para baixo.
- `layout.py` é a ÚNICA fonte de verdade das posições: o PDF (`cartao.py`) e o molde JSON
  (`Layout.para_molde()`) saem do mesmo cálculo. Não repetir números de posição em outro lugar.
- Cartão versão 0: preto e branco, para impressora laser e xerox. Fontes padrão do reportlab (Helvetica/Courier).
- Formatos: `a4` (um cartão por folha) e `a6x4` (cartão A6 105 x 148,5, 4 por folha, ordem "cortar e empilhar", linhas de corte fora do molde). O molde é do CARTÃO (origem no canto sup. esq. do cartão; traz `formato` e `cartao`). Logos institucionais em `marca/` são versionados (não são dados pessoais).

### Formato
- QR: `GAB1|<codigo_prova>|<matricula>` (genérico: matrícula vazia), correção Q, silêncio >= 4 módulos.
- Prova em `provas/<codigo>.json` SEM gabarito (respostas certas não entram nos cartões).
- Turma comparada normalizando espaços, maiúsculas e º/° ("9º C" = "9ºC" = "9° c").
- Situação: em branco = ativo; qualquer outro valor (ex.: "Transferido") = pular.

## Leitor (leitor/, protótipo v0, no navegador)
- A FOTO NUNCA SAI DO APARELHO: sem upload, sem envio a servidor, sem localStorage/sessionStorage/IndexedDB com imagem
  ou nome. Só o molde (sem dados pessoais) é buscado por fetch (`../moldes/<codigo>_molde.json`).
- O leitor não tem nomes de alunos e nunca os mostra: só matrícula (do QR) e código da prova.
- `leitor/omr.js` = visão em funções puras (sem DOM), testável fora da página; `leitor/foto.js` = ponte com o navegador.
- Todos os limiares ficam em `OMR.C` (topo de omr.js). Nunca ler "no chute": se faltar marca/QR/proporção, recusar com erro claro.
- QR: polyfill `barcode-detector@3.0.8` (jsDelivr, crossorigin="anonymous"), `qr_code`, lido numa cópia de até 2400 px;
  o resto da leitura usa 1600 px. Foto decodificada com `imageOrientation: "from-image"` (EXIF do iPhone).
- `moldes/` é versionado (o gerador grava uma cópia a cada execução); `testes/sinteticos/` também (só fictícios, `uv run sinteticos.py`).
- Medir: `python3 -m http.server 8000 --bind 127.0.0.1` e `node ferramentas/rodar_testes.mjs` (Chromium headless).
- Teste no iPhone: `./servir_leitor.sh` (serve uma CÓPIA de leitor/, moldes/, testes/; dados/ e saida/ nunca ficam expostos).
  Nunca servir a raiz do projeto com `--bind 0.0.0.0`.
