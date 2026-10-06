#!/usr/bin/env python3
"""Verifica que un rediseño haya sido solo visual.

Uso: python verificar_solo_visual.py --repo . --base <commit>

Compara el árbol de trabajo contra --base (por defecto HEAD) y:
  - ERROR: hay cambios en carpetas de lógica (api, services, store, navigation, backend...).
  - REVISAR: se quitaron handlers, IDs, endpoints, hooks o funciones que no reaparecen
    en las líneas nuevas del mismo archivo; o se añadió lógica nueva (fetch, hooks de efecto...).
  - AVISO: cambios en archivos de configuración (package.json, manifest, Info.plist...).
Salida: 0 limpio, 1 hay avisos/revisar, 2 hay errores.
"""
import argparse
import re
import subprocess
import sys
from pathlib import Path

LOGIC_DIRS = {
    "api", "services", "service", "store", "stores", "redux", "routes", "controllers",
    "models", "db", "migrations", "auth", "middleware", "navigation", "backend",
    "server", "functions", "repository", "repositories", "viewmodel", "viewmodels",
    "context", "contexts", "providers", "hooks",
}
GENERATED_DIRS = {"dist", "build", ".expo", "node_modules", ".gradle", "coverage"}
TEST_DIRS = {"test", "tests", "__tests__"}
CONFIG_NAMES = {
    "package.json", "package-lock.json", "yarn.lock", "app.json", "androidmanifest.xml",
    "info.plist", "build.gradle", "build.gradle.kts", "podfile", "gemfile",
    "eas.json", "metro.config.js", "tsconfig.json", "tsconfig.tools.json", "eslint.config.mjs",
}
VISUAL_EXT = {
    ".css", ".scss", ".sass", ".less", ".svg", ".png", ".jpg", ".jpeg", ".webp",
    ".ttf", ".otf", ".woff", ".woff2", ".gif", ".ico",
}
MIXED_EXT = {".js", ".jsx", ".ts", ".tsx", ".html", ".vue", ".kt", ".java", ".swift", ".xml", ".m", ".h"}

REMOVED_RE = re.compile(
    r"\bon[A-Z][A-Za-z]*\s*=|setOnClickListener|addEventListener|\bonclick\s*=|@IBAction"
    r"|Button\s*\(\s*action|\bnavigation\.|\brouter\.|\bnavigate\s*\(|\bfetch\s*\("
    r"|\baxios\b|\bawait\b|\.then\s*\(|testID|nativeID|\bid\s*=\s*[\"']|getElementById"
    r"|querySelector|\bfunction\s+\w+|\bfun\s+\w+|\bfunc\s+\w+|\bhref\s*=|/api/"
    r"|\buse(State|Effect|Callback|Memo|Reducer|Context)\b|\bdispatch\s*\("
)
ADDED_RE = re.compile(
    r"\bfetch\s*\(|\baxios\b|\bawait\b|\.then\s*\(|/api/|\buseEffect\b|\bdispatch\s*\("
    r"|AsyncStorage|SecureStore|localStorage|firestore|supabase|XMLHttpRequest"
)


def run(cmd, cwd):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, check=True).stdout


def norm(line):
    return re.sub(r"\s+", "", line)


def classify(path):
    p = Path(path)
    parts = {x.lower() for x in p.parts[:-1]}
    if parts & GENERATED_DIRS:
        return "generado"
    if parts & TEST_DIRS or ".test." in p.name or ".spec." in p.name:
        return "test"
    if parts & LOGIC_DIRS:
        return "logica"
    if p.name.lower() in CONFIG_NAMES or p.name.lower().startswith(".env"):
        return "config"
    ext = p.suffix.lower()
    if ext in VISUAL_EXT:
        return "visual"
    if ext in MIXED_EXT:
        return "mixto"
    return "otro"


def collect(repo, base):
    changes = {}  # archivo -> (removidas, añadidas)
    cur = None
    out = run(["git", "diff", "-U0", "--no-color", base], repo)
    for line in out.splitlines():
        if line.startswith("diff --git"):
            m = re.search(r" b/(.+)$", line)
            cur = m.group(1) if m else None
            if cur:
                changes.setdefault(cur, ([], []))
        elif cur and line.startswith("+") and not line.startswith("+++"):
            changes[cur][1].append(line[1:])
        elif cur and line.startswith("-") and not line.startswith("---"):
            changes[cur][0].append(line[1:])
    for f in run(["git", "ls-files", "--others", "--exclude-standard"], repo).splitlines():
        try:
            text = (Path(repo) / f).read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        changes[f] = ([], text.splitlines())
    return changes


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo", default=".")
    ap.add_argument("--base", default="HEAD")
    a = ap.parse_args()

    try:
        changes = collect(a.repo, a.base)
    except subprocess.CalledProcessError as e:
        print("No se pudo leer git:", e.stderr.strip() or e)
        return 2

    errors, review, warns = [], [], []
    summary = {}
    for f, (rem, add) in sorted(changes.items()):
        kind = classify(f)
        summary.setdefault(kind, []).append(f)
        if kind == "logica":
            errors.append(f"Cambio en carpeta de lógica: {f} (en `hooks/` o `context/` solo se admite si es puramente de tema)")
        elif kind == "test":
            warns.append(f"Prueba modificada: {f} (las pruebas no deberían cambiar en un rediseño)")
        elif kind == "generado":
            warns.append(f"Archivo generado en el diff: {f} (regenéralo, no lo edites)")
        elif kind == "config":
            warns.append(f"Archivo de configuración modificado: {f} (solo se permiten fuentes/íconos)")
        elif kind == "mixto":
            added_norm = [norm(x) for x in add]
            for r in rem:
                if REMOVED_RE.search(r):
                    nr = norm(r)
                    if nr and not any(nr in x for x in added_norm):
                        review.append(f"{f}: se quitó o cambió `{r.strip()[:110]}`")
            for x in add:
                if ADDED_RE.search(x):
                    review.append(f"{f}: se agregó lógica `{x.strip()[:110]}`")

    print("Archivos cambiados por tipo:")
    for k in ("visual", "mixto", "config", "test", "generado", "logica", "otro"):
        if k in summary:
            print(f"  {k}: {len(summary[k])}")
    for title, items in (("ERRORES", errors), ("REVISAR", review), ("AVISOS", warns)):
        if items:
            print(f"\n{title} ({len(items)}):")
            for i in items:
                print("  -", i)
    if not (errors or review or warns):
        print("\nSin alertas: los cambios parecen solo visuales. Recorre el inventario funcional igualmente.")
    return 2 if errors else (1 if (review or warns) else 0)


if __name__ == "__main__":
    sys.exit(main())
