"""Getekende landschappen voor de natuurthema's van Tarapp, als SVG.

Bergruggen met middelpuntverschuiving, dennen als getrapte silhouetten en
hoogtelijnen als golvende, niet-kruisende lijnen. Alles met een vaste seed,
zodat elke run hetzelfde plaatje geeft.
"""
import math
import random
from urllib.parse import quote


def f(v):
    return f"{v:.1f}".rstrip("0").rstrip(".")


def ridge(width, base, amp, seed, rough=0.55, iters=6, lift=None):
    """Een bergrug als lijst punten (x, y) van links naar rechts."""
    rnd = random.Random(seed)
    pts = [(0.0, base + rnd.uniform(-amp, amp)), (float(width), base + rnd.uniform(-amp, amp))]
    disp = amp
    for _ in range(iters):
        new = [pts[0]]
        for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
            new.append(((x1 + x2) / 2, (y1 + y2) / 2 + rnd.uniform(-disp, disp)))
            new.append((x2, y2))
        pts = new
        disp *= rough
    if lift:
        pts = [(x, y + lift(x)) for x, y in pts]
    return pts


def smooth_wave(width, base, parts, phase=0.0):
    """Zachte golf: som van sinussen (voor mist en heuvels)."""
    pts = []
    for i in range(0, 81):
        x = width * i / 80
        y = base + sum(a * math.sin(2 * math.pi * k * x / width + ph + phase) for a, k, ph in parts)
        pts.append((x, y))
    return pts


def area(pts, bottom, fill, extra=""):
    d = "M0," + f(bottom) + " " + " ".join(f"L{f(x)},{f(y)}" for x, y in pts) + f" L{f(pts[-1][0])},{f(bottom)} Z"
    return f"<path d='{d}' fill='{fill}' {extra}/>"


def pine(x, base, h, w):
    """Een den: punt bovenaan, vier lagen takken, naar beneden breder."""
    top = base - h
    tiers = 4
    left = []
    for i in range(1, tiers + 1):
        y = top + h * i / tiers
        half = (w / 2) * (0.3 + 0.7 * i / tiers)
        left.append((x - half, y))
        if i < tiers:
            left.append((x - half * 0.42, y - h * 0.035))
    right = [(2 * x - px, py) for px, py in reversed(left)]
    pts = [(x, top)] + left + right
    return "M" + " L".join(f"{f(px)},{f(py)}" for px, py in pts) + " Z"


def forest(width, base, hmin, hmax, step, seed, envelope=lambda x: 1.0, wratio=0.42):
    rnd = random.Random(seed)
    parts = []
    x = rnd.uniform(0, step)
    while x < width + step:
        h = rnd.uniform(hmin, hmax) * envelope(x)
        if h > 2:
            parts.append(pine(x, base + rnd.uniform(-1, 1.5), h, h * wratio * rnd.uniform(0.85, 1.15)))
        x += step * rnd.uniform(0.7, 1.3)
    return " ".join(parts)


def value_noise(seed, n=24):
    rnd = random.Random(seed)
    vals = [rnd.uniform(-1, 1) for _ in range(n + 1)]

    def at(t):  # t in [0, 1]
        x = t * n
        i = min(int(x), n - 1)
        u = x - i
        u = u * u * (3 - 2 * u)
        return vals[i] * (1 - u) + vals[i + 1] * u

    return at


def mountains(w, peaks, seed, jag=2.6, steps=220):
    """Bergketen: driehoekige toppen (x, y, helling) met ruwe randen."""
    n1, n2, n3 = value_noise(seed, 18), value_noise(seed + 1, 46), value_noise(seed + 2, 110)
    pts = []
    for i in range(steps + 1):
        x = w * i / steps
        y = min(py + abs(x - px) * sl for px, py, sl in peaks)
        y += jag * (0.9 * n1(x / w) + 0.6 * n2(x / w) + 0.35 * n3(x / w))
        pts.append((x, y))
    return pts


def path_of(pts, bottom):
    return "M0," + f(bottom) + " " + " ".join(f"L{f(x)},{f(y)}" for x, y in pts) + f" L{f(pts[-1][0])},{f(bottom)} Z"


def marching(W, H, nx, ny, levels, field):
    gx = [W * i / nx for i in range(nx + 1)]
    gy = [H * j / ny for j in range(ny + 1)]
    v = [[field(x, y) for x in gx] for y in gy]
    out = {}
    for lvl in levels:
        segs = []
        for j in range(ny):
            for i in range(nx):
                a, b, c, d = v[j][i], v[j][i + 1], v[j + 1][i + 1], v[j + 1][i]
                idx = (a > lvl) * 8 + (b > lvl) * 4 + (c > lvl) * 2 + (d > lvl)
                if idx in (0, 15):
                    continue

                def ip(p1, p2, v1, v2):
                    t = (lvl - v1) / (v2 - v1)
                    return (p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1]))

                tl, tr, br, bl = (gx[i], gy[j]), (gx[i + 1], gy[j]), (gx[i + 1], gy[j + 1]), (gx[i], gy[j + 1])
                T, R, B, L = ip(tl, tr, a, b), ip(tr, br, b, c), ip(bl, br, d, c), ip(tl, bl, a, d)
                table = {1: [(L, B)], 2: [(B, R)], 3: [(L, R)], 4: [(T, R)], 5: [(L, T), (B, R)], 6: [(T, B)], 7: [(L, T)],
                         8: [(L, T)], 9: [(T, B)], 10: [(L, B), (T, R)], 11: [(T, R)], 12: [(L, R)], 13: [(B, R)], 14: [(L, B)]}
                segs += table[idx]
        out[lvl] = chain(segs)
    return out


def chain(segs):
    """Losse stukjes aan elkaar rijgen tot lijnen."""
    key = lambda p: (round(p[0], 2), round(p[1], 2))
    ends = {}
    for k, (p, q) in enumerate(segs):
        ends.setdefault(key(p), []).append((k, 0))
        ends.setdefault(key(q), []).append((k, 1))
    used = [False] * len(segs)
    lines = []
    for k in range(len(segs)):
        if used[k]:
            continue
        used[k] = True
        line = [segs[k][0], segs[k][1]]
        for direction in (1, 0):
            while True:
                tip = line[-1] if direction else line[0]
                nxt = None
                for m, side in ends.get(key(tip), []):
                    if not used[m]:
                        nxt = (m, side)
                        break
                if not nxt:
                    break
                m, side = nxt
                used[m] = True
                other = segs[m][1 - side]
                if direction:
                    line.append(other)
                else:
                    line.insert(0, other)
        lines.append(line)
    return lines


def topo(W, H, terms, levels, color, nx, ny, index_every=4, width=0.8, par="none", extra=""):
    field = lambda x, y: sum(a * math.sin(2 * math.pi * (kx * x / W + ky * y / H) + ph) for a, kx, ky, ph in terms)
    res = marching(W, H, nx, ny, levels, field)
    parts = []
    for n, lvl in enumerate(levels):
        d = " ".join("M" + " L".join(f"{x:.0f},{y:.0f}" if False else f"{f(x)},{f(y)}" for x, y in line) for line in res[lvl] if len(line) > 2)
        if d:
            sw = width * 1.7 if n % index_every == 0 else width
            parts.append(f"<path d='{d}' fill='none' stroke='{color}' stroke-width='{f(sw)}' stroke-linejoin='round' stroke-linecap='round'/>")
    return svg(W, H, extra + "".join(parts), par=par)


def svg(w, h, body, defs="", par="xMidYMax slice"):
    return f"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 {w} {h}' preserveAspectRatio='{par}'><defs>{defs}</defs>{body}</svg>"


def data_uri(s):
    return "url(\"data:image/svg+xml," + quote(s, safe="/:=,' ") + "\")"


# ---------- Bergen: ochtend in de bergen, mist in het dal ----------

def bergen(w=400, h=80, valley="#edf2f6"):
    far_peaks = [(28, 44, 0.55), (96, 37, 0.62), (178, 22, 0.7), (236, 30, 0.75), (300, 15, 0.68), (356, 26, 0.7), (408, 33, 0.6)]
    far = mountains(w, far_peaks, seed=4, jag=2.2)
    mid_peaks = [(-10, 52, 0.4), (70, 47, 0.45), (150, 44, 0.5), (226, 48, 0.42), (286, 40, 0.5), (352, 46, 0.45), (420, 50, 0.4)]
    mid = mountains(w, mid_peaks, seed=9, jag=1.8)
    near = smooth_wave(w, 61, [(2.4, 1, 0.9), (1.5, 3, 2.2), (0.8, 6, 0.4)])
    mist = smooth_wave(w, 71, [(1.6, 1, 0.4), (1.0, 3, 1.3), (0.5, 7, 2.1)])
    snowline = [(x, 31 + 2.2 * math.sin(x / 7.3) + 1.6 * math.sin(x / 3.1 + 1)) for x in [w * i / 120 for i in range(121)]]
    snow = "M0,0 L" + f(w) + ",0 " + " ".join(f"L{f(x)},{f(y)}" for x, y in reversed(snowline)) + " Z"
    defs = (
        "<linearGradient id='s' x1='0' y1='0' x2='0' y2='1'>"
        "<stop offset='0' stop-color='#9ec3e6'/><stop offset='.58' stop-color='#eef0dc'/><stop offset='1' stop-color='#fde2a0'/></linearGradient>"
        "<radialGradient id='g' cx='262' cy='40' r='64' gradientUnits='userSpaceOnUse'>"
        "<stop offset='0' stop-color='#ffe28f' stop-opacity='.95'/><stop offset='1' stop-color='#ffe28f' stop-opacity='0'/></radialGradient>"
        "<linearGradient id='m' x1='0' y1='0' x2='1' y2='0'><stop offset='0' stop-color='#a7bfd6'/><stop offset='1' stop-color='#93aecb'/></linearGradient>"
        f"<clipPath id='c'><path d='{path_of(far, h)}'/></clipPath>"
    )
    trees = forest(w, 64, 4, 9, 5.2, seed=11, envelope=lambda x: 1.0 if (30 < x < 120 or 190 < x < 260 or x > 320) else 0.0)
    body = (
        f"<rect width='{w}' height='{h}' fill='url(#s)'/>"
        "<circle cx='262' cy='40' r='64' fill='url(#g)'/>"
        "<circle cx='262' cy='40' r='10' fill='#ffc83d'/>"
        + f"<path d='{path_of(far, h)}' fill='url(#m)'/>"
        + f"<path d='{snow}' fill='#ffffff' fill-opacity='.95' clip-path='url(#c)'/>"
        + f"<path d='{path_of(mid, h)}' fill='#6f8cab'/>"
        + f"<path d='{path_of(near, h)}' fill='#46617b'/>"
        + f"<path d='{trees}' fill='#3a536c'/>"
        + f"<path d='{path_of(mist, h)}' fill='{valley}'/>"
    )
    return svg(w, h, body, defs)


# ---------- Bos: dennenbos bij zonsondergang ----------

def bos(w=400, h=76, ground="#13241a"):
    defs = (
        "<linearGradient id='s' x1='0' y1='0' x2='0' y2='1'>"
        "<stop offset='0' stop-color='#173226'/><stop offset='.55' stop-color='#3f6149'/><stop offset='1' stop-color='#b5c595'/></linearGradient>"
        "<radialGradient id='g' cx='290' cy='62' r='95' gradientUnits='userSpaceOnUse'>"
        "<stop offset='0' stop-color='#f6cf63' stop-opacity='.75'/><stop offset='1' stop-color='#f6cf63' stop-opacity='0'/></radialGradient>"
    )
    rays = "".join(
        f"<path d='M290,62 L{f(290 + 260 * math.cos(a - 0.05))},{f(62 - 260 * math.sin(a - 0.05))} L{f(290 + 260 * math.cos(a + 0.05))},{f(62 - 260 * math.sin(a + 0.05))} Z' fill='#f8dc86' fill-opacity='.07'/>"
        for a in (1.95, 2.35, 2.75)
    )
    far = forest(w, 60, 10, 20, 6.2, seed=5, envelope=lambda x: 0.75 if x < 140 else 1.0)
    mid = forest(w, 67, 14, 28, 9.5, seed=8, envelope=lambda x: 0.55 if x < 150 else 1.0)
    near = forest(w, 77, 22, 44, 13, seed=13, envelope=lambda x: 0.35 if x < 160 else (1.0 if x > 330 or 190 < x < 230 else 0.7))
    body = (
        f"<rect width='{w}' height='{h}' fill='url(#s)'/>"
        f"<circle cx='290' cy='62' r='95' fill='url(#g)'/>"
        + rays
        + f"<rect y='58' width='{w}' height='{h - 58}' fill='#5f7f63'/>"
        + f"<path d='{far}' fill='#5f7f63'/>"
        + f"<rect y='65' width='{w}' height='{h - 65}' fill='#2c4a37'/>"
        + f"<path d='{mid}' fill='#2c4a37'/>"
        + f"<rect y='73' width='{w}' height='{h - 73}' fill='{ground}'/>"
        + f"<path d='{near}' fill='{ground}'/>"
    )
    return svg(w, h, body, defs)


def pine_row(w=400, h=26, color="#152a1d"):
    """Rij dennen voor onderin de tabbalk."""
    trees = forest(w, h + 1, 10, 22, 9, seed=31)
    return svg(w, h, f"<path d='{trees}' fill='{color}'/>", par="xMidYMax slice")


# ---------- Trail: hoogtekaart en hoogteprofiel ----------

def contours(w=360, h=240, color="#d6dbc6"):
    terms = [(1.0, 1, 0, 0.3), (0.8, 0, 1, 1.2), (0.6, 1, 1, 2.0), (0.5, 2, -1, 0.7), (0.35, 2, 1, 2.5), (0.25, 3, 1, 1.1), (0.2, 1, 3, 0.4)]
    levels = [round(-2.4 + 0.3 * i, 2) for i in range(17)]
    return topo(w, h, terms, levels, color, 72, 48, width=0.8)


def trail_header(w=400, h=64, line="#ffcb05"):
    """Kaartje voor de bovenbalk: hoogtelijnen en een gestippelde gele route."""
    terms = [(1.0, 1, 0, 0.2), (0.9, 1, 1, 1.4), (0.6, 2, 0, 2.3), (0.5, 3, 1, 0.8), (0.3, 4, -1, 1.7)]
    levels = [round(-2.0 + 0.32 * i, 2) for i in range(13)]
    route = smooth_wave(w, 46, [(7, 1, 1.6), (4, 2, 0.4), (2, 5, 2.0)])
    d = "M" + " L".join(f"{f(x)},{f(y)}" for x, y in route[18:])
    dots = "".join(f"<circle cx='{f(x)}' cy='{f(y)}' r='2.6' fill='{line}'/>" for x, y in (route[18], route[46], route[70]))
    extra = ""
    body_route = f"<path d='{d}' fill='none' stroke='{line}' stroke-width='2.2' stroke-dasharray='5 4' stroke-linecap='round'/>" + dots
    s = topo(w, h, terms, levels, "#ffffff", 50, 16, width=0.7, par="xMidYMid slice")
    s = s.replace("<path", "<g stroke-opacity='.13'><path", 1).replace("</svg>", "</g>" + body_route + "</svg>")
    return s


def profile(w=400, h=64, line="#ffcb05"):
    """Hoogteprofiel als versiering in de bovenbalk (geen echte route)."""
    pts = smooth_wave(w, 40, [(9, 1, 0.3), (6, 3, 1.1), (3.5, 6, 2.4), (1.6, 13, 0.7)])
    d_line = "M" + " L".join(f"{f(x)},{f(y)}" for x, y in pts)
    grid = "".join(f"<path d='M0,{y} H{w}' stroke='#ffffff' stroke-opacity='.05' stroke-width='1' vector-effect='non-scaling-stroke'/>" for y in (16, 28, 40, 52))
    defs = (
        "<linearGradient id='p' x1='0' y1='0' x2='0' y2='1'>"
        f"<stop offset='0' stop-color='{line}' stop-opacity='.22'/><stop offset='1' stop-color='{line}' stop-opacity='0'/></linearGradient>"
    )
    body = grid + area(pts, h, "url(#p)") + f"<path d='{d_line}' fill='none' stroke='{line}' stroke-opacity='.75' stroke-width='1.6' vector-effect='non-scaling-stroke' stroke-linejoin='round'/>"
    return svg(w, h, body, defs, par="none")


# ---------- Zonnebloemen: een veld onder een zomerlucht ----------

GOLDEN = math.pi * (3 - math.sqrt(5))


def sunflower(cx, cy, r, rot=0.0, petals=18, seeds=True, squash=1.0):
    """Zonnebloem: twee kransen bloemblaadjes, bruin hart met zaadjes in een spiraal."""
    out = [f"<g transform='translate({f(cx)} {f(cy)}) scale(1 {f(squash)})'>"]
    for col, off, length, width in (("#e9a00f", 0.5, 0.98, 0.15), ("#ffc928", 0.0, 0.9, 0.14)):
        for i in range(petals):
            a = rot + (i + off) * 360 / petals
            out.append(f"<ellipse cx='{f(r * 0.56)}' rx='{f(r * length * 0.46)}' ry='{f(r * width)}' transform='rotate({f(a)})' fill='{col}'/>")
    out.append(f"<circle r='{f(r * 0.44)}' fill='#6b4219'/><circle r='{f(r * 0.33)}' fill='#4a2b10'/>")
    if seeds:
        n = int(14 + r * 1.6)
        for k in range(1, n):
            rr = r * 0.4 * math.sqrt(k / n)
            out.append(f"<circle cx='{f(rr * math.cos(k * GOLDEN))}' cy='{f(rr * math.sin(k * GOLDEN))}' r='{f(max(0.35, r * 0.035))}' fill='#8a5a24'/>")
    out.append("</g>")
    return "".join(out)


def leaf(x, y, size, angle, color="#4f8a2c"):
    """Hartvormig zonnebloemblad dat vanaf de steel naar buiten wijst."""
    s = size
    d = f"M0,0 C{f(s * 0.25)},{f(-s * 0.45)} {f(s * 0.85)},{f(-s * 0.42)} {f(s)},0 C{f(s * 0.85)},{f(s * 0.42)} {f(s * 0.25)},{f(s * 0.45)} 0,0 Z"
    return f"<path d='{d}' transform='translate({f(x)} {f(y)}) rotate({f(angle)})' fill='{color}'/>"


def flower_symbol(sid, petals, seeds):
    """Zonnebloem met straal 10 als herbruikbaar symbool."""
    body = sunflower(0, 0, 10, petals=petals, seeds=seeds).replace("<g transform='translate(0 0) scale(1 1)'>", "<g id='" + sid + "'>", 1)
    return body


def zonnebloem(w=400, h=80, ground="#fffbef"):
    rnd = random.Random(42)
    defs = (
        "<linearGradient id='s' x1='0' y1='0' x2='0' y2='1'>"
        "<stop offset='0' stop-color='#7fc0ec'/><stop offset='.6' stop-color='#cfe9f6'/><stop offset='1' stop-color='#fff1bf'/></linearGradient>"
        + flower_symbol("b", 18, True)
        + flower_symbol("k", 12, False)
    )
    parts = [f"<rect width='{w}' height='{h}' fill='url(#s)'/>"]
    for cx, cy, sc in ((70, 16, 1.0), (215, 10, 0.8), (330, 20, 0.9)):
        parts.append(f"<g fill='#ffffff' fill-opacity='.85'><ellipse cx='{cx}' cy='{cy}' rx='{f(16 * sc)}' ry='{f(5 * sc)}'/><ellipse cx='{f(cx - 7 * sc)}' cy='{f(cy - 3 * sc)}' rx='{f(8 * sc)}' ry='{f(5 * sc)}'/><ellipse cx='{f(cx + 5 * sc)}' cy='{f(cy - 4 * sc)}' rx='{f(9 * sc)}' ry='{f(6 * sc)}'/></g>")
    hill = smooth_wave(w, 50, [(3, 1, 0.8), (2, 2, 2.4), (1, 5, 0.3)])
    parts.append(area(hill, h, "#8db657"))
    dots = []
    for _ in range(300):
        x = rnd.uniform(0, w)
        top = 50 + 3 * math.sin(2 * math.pi * x / w + 0.8) + 2 * math.sin(4 * math.pi * x / w + 2.4) + math.sin(10 * math.pi * x / w + 0.3)
        y = rnd.uniform(top + 1, top + 14)
        rr = 0.7 + (y - top) * 0.07
        dots.append(f"M{f(x - rr)},{f(y)}a{f(rr)},{f(rr)} 0 1,0 {f(2 * rr)},0a{f(rr)},{f(rr)} 0 1,0 {f(-2 * rr)},0")
    parts.append(f"<path d='{''.join(dots)}' fill='#ffcf33'/>")
    mid = smooth_wave(w, 64, [(1.5, 2, 1.1), (1, 6, 0.2)])
    parts.append(area(mid, h, "#6e9b3c"))
    x = 4.0
    while x < w:
        y = 62 + rnd.uniform(-2, 2)
        sc = rnd.uniform(0.32, 0.44)
        parts.append(f"<use href='#k' transform='translate({f(x)} {f(y)}) rotate({f(rnd.uniform(0, 30))}) scale({f(sc)})'/>")
        x += rnd.uniform(9, 13)
    parts.append(area(smooth_wave(w, 73, [(1.2, 3, 0.5), (0.8, 7, 1.9)]), h, "#4f8a2c"))
    big = [(150, 66, 7.5), (196, 60, 10), (238, 67, 8), (282, 56, 13), (318, 64, 9.5), (352, 54, 14), (392, 63, 10.5), (18, 70, 6), (60, 72, 6.5), (104, 70, 6)]
    for bx, by, br in big:
        parts.append(f"<path d='M{f(bx)},{f(by + br * 0.5)} L{f(bx + 1)},{h}' stroke='#3f7424' stroke-width='{f(max(1.4, br * 0.16))}'/>")
        parts.append(leaf(bx + 0.5, by + br * 1.25, br * 0.95, -28 - rnd.uniform(0, 20)))
        parts.append(leaf(bx + 0.5, by + br * 1.55, br * 0.9, 200 + rnd.uniform(0, 20)))
    for bx, by, br in big:
        parts.append(f"<use href='#b' transform='translate({f(bx)} {f(by)}) rotate({f(rnd.uniform(0, 20))}) scale({f(br / 10)} {f(br / 10 * rnd.uniform(0.9, 1.0))})'/>")
    parts.append(area(smooth_wave(w, 78, [(0.8, 4, 0.2), (0.5, 9, 1.0)]), h, ground))
    return svg(w, h, "".join(parts), defs)


def zonnebloem_dag(size=40):
    """Losse zonnebloem voor 'vandaag' in de week: het nummer staat op het hart."""
    c = size / 2
    out = [f"<g transform='translate({f(c)} {f(c)})'>"]
    for col, off in (("#e9a00f", 0.5), ("#ffc928", 0.0)):
        for i in range(14):
            a = (i + off) * 360 / 14
            out.append(f"<ellipse cx='{f(size * 0.36)}' rx='{f(size * 0.13)}' ry='{f(size * 0.065)}' transform='rotate({f(a)})' fill='{col}'/>")
    out.append(f"<circle r='{f(size * 0.27)}' fill='#5a3714'/></g>")
    return f"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 {size} {size}'>{''.join(out)}</svg>"
