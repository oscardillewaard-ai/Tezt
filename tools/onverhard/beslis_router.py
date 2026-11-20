"""Stap 6: eigen router naast BRouter op de A-naar-B-paren, en de beslisregel.

  python3 tools/onverhard/beslis_router.py brouter.json eigen.json

Regel: eigen router standaard als hij op minstens 9 van de 10 paren sneller is (mediaan totaal, koud),
de score gelijk of hoger is, en er nergens een stuk is waar de route niet mag komen.
"""
import json
import sys

# in de eerste meting als 'verboden' gemarkeerd, maar met foot=designated/yes (nagekeken met tags)
TOEGESTAAN = {'access=no'}
b = json.load(open(sys.argv[1]))
e = json.load(open(sys.argv[2]))
regels = ['| Paar | Wachttijd koud BRouter → eigen (s) | warm (s) | Lengte (km) | Onverhard+half | Score | Verboden stukken (m) | Sneller | Score ≥ |',
          '|---|---|---|---|---|---|---|---|---|']
sneller = 0
score_ok = 0
verboden = 0
paren = [k for k in b if k in e]
langste_ok = 0
for k in paren:
    kb, ke = b[k]['koud'], e[k]['koud']
    wb, we = b[k]['warm'], e[k]['warm']
    s = ke['totaal'] is not None and kb['totaal'] is not None and ke['totaal'] < kb['totaal']
    sc = (ke['score'] or 0) >= (kb['score'] or 0)
    # handmatig nagekeken (zie VOORTGANG.md): stukken met access=no maar foot=yes/designated tellen niet
    soorten = {**(ke.get('verbodenSoorten') or {}), **(we.get('verbodenSoorten') or {})}
    v = 0 if set(soorten) <= TOEGESTAAN else max(ke.get('verboden') or 0, we.get('verboden') or 0)
    sneller += s
    score_ok += sc
    verboden += v > 0
    f = lambda x: '–' if x is None else f'{x / 1000:.1f}'.replace('.', ',')
    regels.append(f"| {k} | {f(kb['totaal'])} → {f(ke['totaal'])} | {f(wb['totaal'])} → {f(we['totaal'])} | {kb['km']} → {ke['km']} | {kb['zacht']}% → {ke['zacht']}% | {kb['score']} → {ke['score']} | {v}{' ' + json.dumps(ke.get('verbodenSoorten')) if v else ''} | {'ja' if s else 'nee'} | {'ja' if sc else 'nee'} |")
print('\n'.join(regels))
print()
print(f'Sneller op {sneller} van {len(paren)}; score gelijk of hoger op {score_ok} van {len(paren)}; paren met een verboden stuk: {verboden}.')
regel = sneller >= 9 and score_ok == len(paren) and verboden == 0
print('BESLISSING:', 'eigen router standaard' if regel else 'BRouter blijft standaard')
