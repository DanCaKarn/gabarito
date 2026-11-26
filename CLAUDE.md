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

### Modo ao vivo (etapa 4)
- `leitor/vivo.js` (câmera + laço), `resultado.js` (tela do resultado), `erro.js` (aviso de erro na tela, corta 6+ dígitos),
  `version.js` (APP_VERSAO/APP_DATA: SUBIR a cada mudança em leitor/; aparece no rodapé e no aviso de erro). Sem service worker.
- Laço (v3): rAF a cada quadro NOVO de vídeo; só 4 recortes (48% da moldura-guia em volta de cada marca esperada), 112 px cada, num mosaico
  com UM getImageData , buffers reaproveitados (`OMR.criarDetectorCantos`); se a checagem passar de 25 ms o laço pula quadros.
  Estabilidade por TEMPO: marcas paradas (<1,5% do lado) por `VIVO_ESTAVEL_MS` = 300 ms → captura o quadro inteiro → QR + `OMR.ler`.
  QR: aquecido ao abrir a página; lido num recorte em volta da posição prevista (homografia das marcas vivas), depois recorte 180°, depois quadro inteiro.
  Constantes `VIVO_*`/`CANTO_*` em `OMR.C`. O cartão precisa estar encaixado na moldura (tolerância ~±16% da largura). Nenhum quadro é guardado/enviado.
- Anti-repetição: após "Confirmar", mesmo código+matrícula só relê depois que as marcas somem por ≥1 s (ou "Ler de novo").
- Tudo que roda na inicialização é declarado ANTES (lição da Caderneta). Câmera: liberar em visibilitychange/pagehide, religar ao voltar.
- Câmera ao vivo exige HTTPS: `./servir_leitor.sh` agora serve por HTTPS (autoassinado, efêmero) na porta 8443; `HTTPS=0` volta ao HTTP (só foto).
- Teste ao vivo (câmera falsa do Chromium): `uv run sinteticos.py` (gera os JPGs, que são ignorados no git), depois
  `python3 ferramentas/video_teste.py /tmp/seq.mjpeg` e `node ferramentas/rodar_vivo.mjs /tmp/seq.mjpeg --esperado 01_base,02_base,13_sombra`
  (`--roteiro extras`: cartão fora do lugar, de cabeça para baixo e fora da moldura; `--trace` mostra as dicas ao longo do tempo)
  (e `--roteiro mesa-vazia` + sem `--esperado`: não pode ler nada). Os vídeos ficam fora do repositório.
- Detecção dos cantos (v4): a pontuação do candidato usa a posição ESPERADA DENTRO do recorte (o recorte é deslocado, não encolhido, quando
  sai do quadro: o centro do recorte NÃO é a marca), preenchimento ≥ 0,8, "caixa cheia" (quadrado ≈ 1; logo/círculo ≈ 0,79) e escuridão.
  Antes da leitura ser aceita, as marcas de `OMR.ler` têm de coincidir com as do laço (quadro mexendo = recusa).
- `?debug=1`: mosaico dos 4 recortes + motivo de cada canto falhar (+ tamanhos de vídeo/palco/tela); `?perf=1`: checagens/s.
- Teste com tamanhos de vídeo e tela de celular: `video_teste.py --tam 1080x1920` + `rodar_vivo.mjs --gum livre --viewport 390x844x3`.
- `LIMIAR_SEGUNDA` (0,40): 'marcada' exige a 2ª bolha abaixo disto; uma dupla com uma bolha falhada vira dúvida, nunca letra.

### Correção no leitor (etapa 5, MODO DE TESTE no aparelho do Daniel)
- No sistema final quem corrige é a PLANILHA. `leitor/corrigir.js` (puro) + `leitor/turma.js` (telas) existem para o teste em sala.
- Exceção à regra de armazenamento, só em `turma.js`: localStorage guarda a chave por prova (`gab-chave-<codigo>`) e a lista
  (`gab-lista`: matrícula, prova, respostas, acertos, total, hora). NUNCA nomes nem imagens.
- O CSV só sai do aparelho por ação do usuário ("Exportar CSV"). A chave de correção não vai para o git nem para `provas/`.
- Dupla, em branco e dúvida contam como erro. Identidade na lista = prova + matrícula. Teste: `node --test tests/corrigir.test.mjs`.

