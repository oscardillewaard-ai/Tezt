"""Markdown-tabellen uit benchmark_snelheid.mjs-uitvoer.

  python3 tools/onverhard/tabel_snelheid.py voor.json [na.json]

Eén bestand: mediaan per fase (ms), koud en warm. Twee bestanden: naast elkaar (voor → na).
"""
import json
import sys

FASEN = ['tegels', 'graaf', 'route', 'bgt', 'ahn', 'water', 'brouter']


def laad(paden):
    d = {}
    for p in paden.split('+'):
        d.update(json.load(open(p)))
    return d


def s(ms):
    return '–' if ms is None else f"{ms / 1000:.1f}".replace('.', ',')


def een(d):
    regels = ['| Geval | Cache | Totaal (s) | Eerste (s) | ' + ' | '.join(FASEN) + ' | tegels n / kB / cache | ok |', '|' + '---|' * (len(FASEN) + 6)]
    for naam, v in d.items():
        for c in ['koud', 'warm']:
            x = v[c]
            t = x['bronnen'].get('tegels', {})
            regels.append(f"| {naam} | {c} | {s(x['totaal'])} | {s(x.get('eerste'))} | " + ' | '.join(s(x['fasen'].get(f)) for f in FASEN) + f" | {t.get('n', 0)} / {t.get('kB', 0)} / {t.get('cache', 0)} | {x['ok']}/{x['van']} |")
    return '\n'.join(regels)


def twee(a, b):
    regels = ['| Geval | Cache | Totaal voor → na (s) | Eerste resultaat na (s) | BGT voor → na | Tegels voor → na | Graaf voor → na | Score voor → na |', '|---|---|---|---|---|---|---|---|']
    for naam in a:
        if naam not in b:
            continue
        for c in ['koud', 'warm']:
            x, y = a[naam][c], b[naam][c]
            regels.append(f"| {naam} | {c} | {s(x['totaal'])} → {s(y['totaal'])} | {s(y.get('eerste'))} | {s(x['fasen'].get('bgt'))} → {s(y['fasen'].get('bgt'))} | {s(x['fasen'].get('tegels'))} → {s(y['fasen'].get('tegels'))} | {s(x['fasen'].get('graaf'))} → {s(y['fasen'].get('graaf'))} | {x.get('score')} → {y.get('score')} |")
    return '\n'.join(regels)


if __name__ == '__main__':
    if len(sys.argv) == 2:
        print(een(laad(sys.argv[1])))
    else:
        print(twee(laad(sys.argv[1]), laad(sys.argv[2])))
