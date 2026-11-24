"""Dados de entrada: prova (JSON), alunos (CSV) e normalização de turma. Sem layout aqui."""
from __future__ import annotations

import csv
import json
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path

MAX_MATRICULA = 20
CODIGO_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


class ErroGabarito(Exception):
    """Erro de uso/entrada com mensagem clara (nunca inclui nomes de alunos)."""


@dataclass(frozen=True)
class Prova:
    codigo: str
    titulo: str
    escola: str
    data: str
    questoes: int
    alternativas: tuple[str, ...]
    bloco: str = "RESPOSTAS"   # título do bloco de respostas (usado no formato a6x4)


@dataclass(frozen=True)
class Aluno:
    nome: str
    matricula: str
    turma: str
    situacao: str = ""


def sem_acentos(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def chave_turma(turma: str) -> str:
    """'9º C' = '9ºC' = '9° c' -> '9ºc'."""
    t = unicodedata.normalize("NFC", turma).replace("°", "º").replace("˚", "º")
    return re.sub(r"\s+", "", t).casefold()


def slug_turma(turma: str) -> str:
    s = sem_acentos(chave_turma(turma).replace("º", ""))
    s = re.sub(r"[^a-z0-9]", "", s)
    if not s:
        raise ErroGabarito("Turma inválida para nome de arquivo.")
    return s


def carregar_prova(caminho) -> Prova:
    p = Path(caminho)
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise ErroGabarito(f"Não consegui ler a prova {p}: {e}")
    faltam = [k for k in ("codigo", "titulo", "escola", "data", "questoes", "alternativas") if k not in d]
    if faltam:
        raise ErroGabarito(f"Prova {p}: faltam campos {faltam}.")
    if not CODIGO_RE.match(str(d["codigo"])):
        raise ErroGabarito(f"Prova {p}: código inválido (use letras, números, . _ -).")
    q = d["questoes"]
    if not isinstance(q, int) or isinstance(q, bool) or q < 1:
        raise ErroGabarito(f"Prova {p}: 'questoes' deve ser inteiro >= 1.")
    alts = d["alternativas"]
    if (not isinstance(alts, list) or not 2 <= len(alts) <= 8
            or any(not isinstance(a, str) or not a.strip() or len(a) > 2 for a in alts)
            or len(set(alts)) != len(alts)):
        raise ErroGabarito(f"Prova {p}: 'alternativas' deve ter 2 a 8 itens únicos.")
    bloco = d.get("bloco", "RESPOSTAS")
    if not isinstance(bloco, str) or not bloco.strip():
        raise ErroGabarito(f"Prova {p}: 'bloco' deve ser texto.")
    return Prova(d["codigo"], d["titulo"], d["escola"], d["data"], q, tuple(alts), bloco.strip())


def _ler_texto(p: Path) -> str:
    raw = p.read_bytes()
    for enc in ("utf-8-sig", "cp1252"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("latin-1")


def ler_alunos(caminho) -> list[Aluno]:
    """Lê o CSV (Nome, Matrícula, Turma, Situação). Mensagens de erro só citam número de linha."""
    p = Path(caminho)
    try:
        texto = _ler_texto(p)
    except OSError as e:
        raise ErroGabarito(f"Não consegui abrir o CSV: {e.strerror or 'erro'}")
    primeira = texto.splitlines()[0] if texto.strip() else ""
    delim = max(",;\t", key=primeira.count) if primeira else ","
    leitor = csv.reader(texto.splitlines(), delimiter=delim)
    linhas = list(leitor)
    if not linhas:
        raise ErroGabarito("CSV vazio.")
    cab = [sem_acentos(c).strip().casefold() for c in linhas[0]]
    def col(nome):
        if nome not in cab:
            raise ErroGabarito(f"CSV sem a coluna '{nome}'.")
        return cab.index(nome)
    i_nome, i_mat, i_tur = col("nome"), col("matricula"), col("turma")
    i_sit = cab.index("situacao") if "situacao" in cab else None
    alunos = []
    for n, lin in enumerate(linhas[1:], start=2):
        if not any(c.strip() for c in lin):
            continue
        def g(i):
            return lin[i].strip() if i is not None and i < len(lin) else ""
        alunos.append(Aluno(g(i_nome), g(i_mat), g(i_tur), g(i_sit)))
    return alunos


def alunos_da_turma(alunos: list[Aluno], turma: str) -> tuple[list[Aluno], int]:
    """Ativos da turma, em ordem alfabética. Retorna (ativos, ignorados_por_situacao)."""
    k = chave_turma(turma)
    ativos, ignorados = [], 0
    for a in alunos:
        if chave_turma(a.turma) != k:
            continue
        if a.situacao.strip():
            ignorados += 1
            continue
        ativos.append(a)
    if not ativos:
        raise ErroGabarito(f"Nenhum aluno ativo na turma '{turma}'. Nenhum PDF gerado.")
    for a in ativos:
        if not a.nome:
            raise ErroGabarito(f"Turma '{turma}': aluno ativo sem nome.")
        if not a.matricula or "|" in a.matricula or len(a.matricula) > MAX_MATRICULA:
            raise ErroGabarito(f"Turma '{turma}': matrícula vazia, com '|' ou maior que {MAX_MATRICULA} caracteres.")
    if len({a.matricula for a in ativos}) != len(ativos):
        raise ErroGabarito(f"Turma '{turma}': matrículas repetidas.")
    ativos.sort(key=lambda a: (sem_acentos(a.nome).casefold(), a.matricula))
    return ativos, ignorados
