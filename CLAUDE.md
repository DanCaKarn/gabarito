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
