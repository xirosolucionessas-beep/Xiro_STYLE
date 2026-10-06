#!/usr/bin/env python3
"""Foto funcional de un proyecto Expo/React Native/web para comparar antes y después de un rediseño.

Guardar:   python inventario.py --repo . --out REDISENO_antes.json
Comparar:  python inventario.py --repo . --compare REDISENO_antes.json

Registra: handlers (onPress, onClick...), testID/nativeID/id, rutas de navegación,
endpoints, claves de traducción t('...'), llamadas de red y funciones.
Al comparar, informa lo que existía antes y ya no existe (o bajó de cantidad).
Salida: 0 sin pérdidas, 1 hay pérdidas.
"""
import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

SKIP_DIRS = {"node_modules", "dist", "build", ".expo", ".git", ".gradle", "android", "ios", "coverage", "test", "tests", "__tests__"}
EXTS = {".ts", ".tsx", ".js", ".jsx", ".html"}

PATTERNS = {
    "handlers": re.compile(r"\b(on[A-Z][A-Za-z]*|onclick)\s*=\s*\{?\s*([A-Za-z_$][\w$.]*)"),
    "ids": re.compile(r"\b(testID|nativeID|id)\s*=\s*[\"'{]\s*[\"'`]?([\w\-:.${}]+)"),
    "rutas": re.compile(r"(?:navigate|push|replace|router\.\w+)\(\s*[\"'`]([^\"'`]+)"),
    "endpoints": re.compile(r"[\"'`](/api/[^\"'`\s?]+)"),
    "traducciones": re.compile(r"\bt\(\s*[\"']([^\"']+)[\"']"),
    "red": re.compile(r"\b(fetch|axios\.\w+)\s*\("),
    "funciones": re.compile(r"\bfunction\s+([A-Za-z_$][\w$]*)|\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\("),
}


def scan(repo):
    inv = {k: Counter() for k in PATTERNS}
    for p in Path(repo).rglob("*"):
        if not p.is_file() or p.suffix.lower() not in EXTS:
            continue
        if any(part in SKIP_DIRS for part in p.relative_to(repo).parts[:-1]):
            continue
        text = p.read_text(encoding="utf-8", errors="ignore")
        for name, rx in PATTERNS.items():
            for m in rx.finditer(text):
                key = ":".join(g for g in m.groups() if g)
                inv[name][key] += 1
    return inv


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo", default=".")
    ap.add_argument("--out")
    ap.add_argument("--compare")
    a = ap.parse_args()
    now = scan(a.repo)

    if a.out:
        Path(a.out).write_text(json.dumps({k: dict(v) for k, v in now.items()}, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"Inventario guardado en {a.out}")
        for k, v in now.items():
            print(f"  {k}: {len(v)} distintos, {sum(v.values())} usos")
    if a.compare:
        before = json.loads(Path(a.compare).read_text(encoding="utf-8"))
        lost = 0
        for cat, items in before.items():
            gone = [(k, n, now[cat].get(k, 0)) for k, n in items.items() if now[cat].get(k, 0) < n]
            if gone:
                print(f"\n{cat.upper()}: {len(gone)} con pérdida")
                for k, n, m in gone[:40]:
                    print(f"  - {k}: antes {n}, ahora {m}")
                lost += len(gone)
        if lost:
            print(f"\nTotal con pérdida: {lost}. Cada uno debe aparecer de nuevo o justificarse (p. ej. el handler se renombró en un archivo movido).")
            return 1
        print("Sin pérdidas: todo lo registrado antes sigue en el código.")
    if not (a.out or a.compare):
        ap.error("usa --out o --compare")
    return 0


if __name__ == "__main__":
    sys.exit(main())
