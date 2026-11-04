"""Bouwt de thema's voor de echte app: SVG-landschappen, lettertypes en themes.css.

Gebruik: python3 -I tools/tarapp-themes/build_app_themes.py public/sportagenda <map met lettertypes>
De lettertypes komen uit de npm-pakketten @fontsource/josefin-sans, fraunces,
barlow-condensed, ibm-plex-mono en fredoka (5.3.0), uitgepakt met `npm pack` +
`tar -xzf`, elk in een map fontsource-<naam>-5.3.0.
Elk thema staat in themes.css onder html[data-thema="..."], zodat het meteen bij
het laden geldt en alleen de plaatjes en letters van het gekozen thema geladen worden.
"""
import pathlib
import re
import shutil
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from landscapes import bergen, bos, contours, mountains, path_of, pine_row, svg, trail_header, zonnebloem, zonnebloem_dag  # noqa: E402

app = pathlib.Path(sys.argv[1])
fontsrc = pathlib.Path(sys.argv[2])
(app / "themes").mkdir(exist_ok=True)
(app / "fonts").mkdir(exist_ok=True)


def ridge_row(w=400, h=24, color="#eef3f7"):
    peaks = [(20, 12, 0.5), (90, 8, 0.6), (160, 13, 0.5), (230, 6, 0.65), (300, 11, 0.55), (370, 7, 0.6), (430, 12, 0.5)]
    return svg(w, h, f"<path d='{path_of(mountains(w, peaks, seed=17, jag=1.2), h)}' fill='{color}'/>")


images = {
    "bergen": bergen(),
    "bergen-sheet": bergen(valley="#ffffff"),
    "bergen-ridge": ridge_row(),
    "bos": bos(),
    "bos-sheet": bos(ground="#172b1f"),
    "bos-pines": pine_row(color="#183022"),
    "trail": trail_header(),
    "contours": contours(),
    "zonnebloem": zonnebloem(),
    "zonnebloem-sheet": zonnebloem(ground="#ffffff"),
    "zonnebloem-dag": zonnebloem_dag(),
}
for name, s in images.items():
    (app / "themes" / f"{name}.svg").write_text(s)

# Lettertypes (latin, woff2) en hun licenties (SIL Open Font License 1.1).
FONTS = [
    ("josefin-sans", "Josefin Sans", [("600", "normal"), ("700", "normal")]),
    ("fraunces", "Fraunces", [("600", "normal"), ("600", "italic")]),
    ("barlow-condensed", "Barlow Condensed", [("600", "normal"), ("700", "normal")]),
    ("ibm-plex-mono", "IBM Plex Mono", [("500", "normal")]),
    ("fredoka", "Fredoka", [("600", "normal")]),
]
faces = []
for slug, family, variants in FONTS:
    pkg = fontsrc / f"fontsource-{slug}-5.3.0"
    shutil.copy(pkg / "LICENSE", app / "fonts" / f"OFL-{slug}.txt")
    for weight, style in variants:
        fn = f"{slug}-latin-{weight}-{style}.woff2"
        shutil.copy(pkg / "files" / fn, app / "fonts" / fn)
        faces.append(
            f"@font-face {{ font-family: '{family}'; font-style: {style}; font-weight: {weight}; font-display: swap; src: url('fonts/{fn}') format('woff2'); }}"
        )

LIGHT_TYPES = """  --c-hardlopen: #ea580c; --c-wedstrijd: #1c2b39; --c-wandelen: #4d7c0f; --c-klimmen: #0284c7;
  --c-boulderen: #92400e; --c-gym: #7c3aed; --c-kracht: #c026d3; --c-thuis: #a16207;
  --c-routine: #e11d48; --c-yoga: #db2777; --c-warming: #dc2626; --c-fietsen: #2563eb; --c-zwemmen: #0891b2;"""

DARK_TYPES = """  --c-hardlopen: #fb9a50; --c-wedstrijd: #f1ead7; --c-wandelen: #b5e06a; --c-klimmen: #5cc8f5;
  --c-boulderen: #dcae7c; --c-gym: #b6a1ff; --c-kracht: #f08ff0; --c-thuis: #f2c14e;
  --c-routine: #ff8296; --c-yoga: #ff94c6; --c-warming: #ff7b6b; --c-fietsen: #79aaff; --c-zwemmen: #4fdbe6;"""

# Een landschap in de bovenbalk maakt die hoger; dat winnen we terug in de week.
COMPACT = """
.weeknav.compact .label { line-height: 1.15; }
.wday { min-height: 44px; }
.wday-label { line-height: 1; }
.wday-label strong { width: 26px; height: 26px; }
.wday .day-add { height: auto; align-self: stretch; }
"""
BANNER_FIT = COMPACT + """
.topbar { min-height: 62px; align-items: flex-start; padding-bottom: 20px; }
.compliment { padding-block: 2px; }
.weeknav.compact { margin-bottom: 6px; }
"""

THEMES = {}

THEMES["bergen"] = f"""
:root {{
  --bg: #edf2f6; --card: #ffffff; --text: #1c2b39; --muted: #5e7184; --line: #d9e2ea;
  --accent: #ffc83d; --accent-ink: #1c2b39; --accent-text: #8a5f00; --accent-soft: #fff4d1;
  --done: #2f855a; --done-soft: #e3f2e9; --danger: #c2413a; --plan: #5a55d6; --block: #2b7a8c;
  --bar: #1c2b39; --bar-text: #ffffff; --day-line: #e1e8ee; --day-alt: #f6f9fb;
{LIGHT_TYPES}
  --head: 'Josefin Sans', 'Avenir Next', 'Segoe UI', sans-serif;
  --soft-shadow: 0 1px 2px rgb(28 43 57 / 0.06), 0 8px 24px rgb(28 43 57 / 0.07);
  color-scheme: light;
}}
html, body {{ background: var(--bg); color: var(--text); }}
{BANNER_FIT}
.topbar {{ background: url('themes/bergen.svg') center bottom / cover no-repeat, #a9c9e6; color: var(--text); }}
.topbar h1 {{ font-family: var(--head); font-weight: 700; text-transform: uppercase; letter-spacing: 0.16em; font-size: 1.22rem; color: var(--text); padding-top: 4px; }}
.topbar .segmented {{ background: rgb(255 255 255 / 0.7); border: 1px solid rgb(255 255 255 / 0.9); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }}
.topbar .segmented button {{ color: var(--text); }}
.topbar .segmented button.on {{ background: var(--accent); color: var(--accent-ink); }}
.segmented {{ background: #e3eaf0; }}
.segmented button.on {{ background: #fff; color: var(--text); }}
.weeknav.compact .iconbtn, .iconbtn {{ background: #fff; border: 1px solid var(--line); border-radius: 12px; color: var(--text); }}
.weeknav .label strong {{ font-family: var(--head); font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; font-size: 1.02rem; }}
.compliment {{ background: #fff7dc; border: 1px solid #ffe6a3; color: #4f3a00; border-radius: 12px; }}
.block-week {{ color: var(--block); }}
.progress {{ background: #dbe4ec; }}
.progress > div {{ background: var(--done); }}
.wdays {{ background: #fff; border: 0; border-radius: 18px; box-shadow: var(--soft-shadow); }}
.wday {{ border-bottom: 1px solid var(--day-line); }}
.wday:nth-child(even) {{ background: var(--day-alt); }}
.wday.today {{ background: linear-gradient(90deg, #fff1c4, #fff9ea 55%, #ffffff); }}
.wday-label span {{ font-family: var(--head); font-weight: 600; letter-spacing: 0.14em; font-size: 0.62rem; color: var(--muted); }}
.wday-label strong {{ font-family: var(--head); font-weight: 700; font-size: 1.12rem; padding-top: 2px; }}
.wday.today .wday-label span {{ color: var(--accent-text); }}
.wday.today .wday-label strong {{ background: var(--accent); color: var(--accent-ink); box-shadow: 0 0 0 3px rgb(255 200 61 / 0.3); }}
.session {{ background: #fff; border: 1px solid #dde5ec; border-radius: 12px; }}
.session.done {{ background: var(--done-soft); border-color: transparent; }}
.check {{ border-color: #a3b3c2; }}
.session.done .check, .set-row.done .check {{ background: var(--done); border-color: var(--done); }}
.wday .day-add {{ color: #8a9bab; }}
.cal-day {{ border-color: var(--line); border-radius: 10px; }}
.cal-day.today {{ border-color: var(--accent); background: var(--accent-soft); }}
.cal-day.today .cal-num {{ color: var(--accent-ink); }}
.tabbar {{ background: url('themes/bergen-ridge.svg') center bottom / 400px 24px repeat-x, #ffffff; border-top: 1px solid #e1e8ee; }}
.tabbar button {{ color: var(--muted); }}
.tabbar button.active {{ color: var(--text); }}
.tabbar button.active span {{ background: var(--accent); color: var(--accent-ink); }}
.card {{ border: 0; border-radius: 18px; box-shadow: var(--soft-shadow); }}
.card h2 {{ font-family: var(--head); font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.95rem; }}
.tot {{ background: var(--bg); }}
.tot strong, .stat-grid strong {{ font-family: var(--head); font-weight: 700; }}
.bar .col {{ background: #dbe4ec; }}
.btn {{ border: 1px solid var(--line); border-radius: 12px; }}
.btn.primary {{ background: var(--accent); border-color: var(--accent); color: var(--accent-ink); box-shadow: 0 4px 14px rgb(255 200 61 / 0.35); }}
.linkbtn {{ color: var(--accent-text); }}
dialog {{ background: #fff; border-radius: 22px 22px 0 0; }}
dialog::before {{ content: ''; display: block; height: 62px; background: url('themes/bergen-sheet.svg') center bottom / cover no-repeat; }}
dialog h2 {{ font-family: var(--head); font-weight: 700; font-size: 1.4rem; letter-spacing: 0.01em; }}
.detail-stats div {{ background: var(--bg); border: 0; border-radius: 14px; }}
.detail-stats strong {{ font-family: var(--head); font-weight: 700; font-size: 1.9rem; }}
.detail-done {{ background: var(--done-soft); }}
.toast {{ background: var(--text); }}
"""

THEMES["bos"] = f"""
:root {{
  --bg: #13241a; --card: #1a3023; --text: #f1ead7; --muted: #a7b6a0; --line: #2a4434;
  --accent: #f2c14e; --accent-ink: #13241a; --accent-text: #f2c14e; --accent-soft: rgb(242 193 78 / 0.13);
  --done: #93d36f; --done-soft: rgb(147 211 111 / 0.13); --danger: #ff7b6b; --plan: #b3a7ff; --block: #74d4c4;
  --bar: #0f1d15; --bar-text: #f1ead7; --day-line: #263f30; --day-alt: #172b1f;
{DARK_TYPES}
  --head: 'Fraunces', Georgia, 'Times New Roman', serif;
  color-scheme: dark;
}}
html, body {{ background: var(--bg); color: var(--text); }}
{BANNER_FIT}
.topbar {{ background: url('themes/bos.svg') center bottom / cover no-repeat, #173226; color: var(--text); }}
.topbar h1 {{ font-family: var(--head); font-style: italic; font-weight: 600; font-size: 1.6rem; color: #f6efd9; text-shadow: 0 1px 10px rgb(0 0 0 / 0.35); }}
.topbar .segmented {{ background: rgb(10 22 15 / 0.55); border: 1px solid rgb(241 234 215 / 0.14); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }}
.topbar .segmented button {{ color: rgb(241 234 215 / 0.8); }}
.topbar .segmented button.on {{ background: var(--accent); color: var(--accent-ink); }}
.segmented {{ background: #20392a; }}
.segmented button.on {{ background: var(--accent); color: var(--accent-ink); }}
.weeknav.compact .iconbtn, .iconbtn {{ background: var(--card); border: 1px solid var(--line); border-radius: 12px; color: var(--text); }}
.weeknav .label strong {{ font-family: var(--head); font-weight: 600; font-size: 1.08rem; }}
.compliment {{ background: rgb(242 193 78 / 0.12); color: #f6dc95; border: 1px solid rgb(242 193 78 / 0.25); border-radius: 12px; font-family: var(--head); font-style: italic; font-weight: 600; }}
.block-week {{ color: var(--block); }}
.progress {{ background: #284332; }}
.progress > div {{ background: var(--done); }}
.wdays {{ background: var(--card); border: 1px solid #284332; border-radius: 18px; box-shadow: 0 10px 30px rgb(0 0 0 / 0.25); }}
.wday {{ border-bottom: 1px solid var(--day-line); }}
.wday:nth-child(even) {{ background: var(--day-alt); }}
.wday.today {{ background: linear-gradient(90deg, rgb(242 193 78 / 0.17), rgb(242 193 78 / 0.02) 70%); }}
.wday-label span {{ color: var(--muted); letter-spacing: 0.12em; font-size: 0.62rem; }}
.wday-label strong {{ font-family: var(--head); font-weight: 600; font-size: 1.15rem; }}
.wday.today .wday-label span {{ color: var(--accent); }}
.wday.today .wday-label strong {{ background: var(--accent); color: var(--accent-ink); box-shadow: 0 0 14px rgb(242 193 78 / 0.45); }}
.session {{ background: #20392a; border: 1px solid #2f4c3a; border-radius: 12px; }}
.session.done {{ background: var(--done-soft); border-color: rgb(147 211 111 / 0.28); }}
.check {{ border-color: #71907a; color: #13241a; }}
.session.done .check, .set-row.done .check {{ background: var(--done); border-color: var(--done); }}
.session.done .s-title {{ text-decoration-color: rgb(241 234 215 / 0.5); }}
.wday .day-add {{ color: #7d927f; }}
.cal-day {{ background: var(--card); border-color: var(--line); }}
.cal-day.today {{ border-color: var(--accent); box-shadow: 0 0 10px rgb(242 193 78 / 0.35); }}
.tabbar {{ background: url('themes/bos-pines.svg') center bottom / 400px 26px repeat-x, #0f1d15; border-top: 1px solid #22392b; }}
.tabbar button {{ color: var(--muted); }}
.tabbar button.active {{ color: var(--text); }}
.tabbar button.active span {{ background: var(--accent); color: var(--accent-ink); }}
.card {{ background: var(--card); border: 1px solid #284332; border-radius: 18px; }}
.card h2 {{ font-family: var(--head); font-weight: 600; font-size: 1.15rem; }}
.tot {{ background: #13241a; border: 1px solid #284332; }}
.tot strong, .stat-grid strong {{ font-family: var(--head); font-weight: 600; color: #f6dc95; }}
.bar .col {{ background: #284332; }}
.btn {{ background: #20392a; border: 1px solid #2f4c3a; border-radius: 12px; color: var(--text); }}
.btn.primary {{ background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }}
.linkbtn {{ color: var(--accent); }}
dialog {{ background: #172b1f; color: var(--text); border-radius: 22px 22px 0 0; }}
dialog::before {{ content: ''; display: block; height: 62px; background: url('themes/bos-sheet.svg') center bottom / cover no-repeat; }}
dialog h2 {{ font-family: var(--head); font-weight: 600; font-size: 1.5rem; }}
.detail-stats div {{ background: #13241a; border: 1px solid #284332; border-radius: 14px; }}
.detail-stats strong {{ font-family: var(--head); font-weight: 600; font-size: 2rem; color: #f6dc95; }}
.detail-done {{ background: var(--done-soft); color: var(--done); }}
.toast {{ background: #20392a; border: 1px solid #2f4c3a; }}
"""

THEMES["trail"] = f"""
:root {{
  --bg: #eef0e4; --card: #fbfbf6; --text: #20271e; --muted: #646b5a; --line: #d5d9c6;
  --accent: #ffcb05; --accent-ink: #20271e; --accent-text: #7d6400; --accent-soft: #fff3bf;
  --done: #3b8a3e; --done-soft: #e3efd9; --danger: #c0392b; --plan: #5b54d1; --block: #2f7f86;
  --bar: #1f3328; --bar-text: #f3f1e4; --day-line: #dde1cf; --day-alt: #f4f5ec;
{LIGHT_TYPES}
  --head: 'Barlow Condensed', 'Arial Narrow', sans-serif;
  --mono: 'IBM Plex Mono', ui-monospace, Menlo, monospace;
  --route: #ffcb05;
  color-scheme: light;
}}
{COMPACT}
html {{ background: var(--bg); }}
body {{ background: url('themes/contours.svg') 0 0 / 360px 240px repeat, var(--bg); color: var(--text); }}
.topbar {{ background: url('themes/trail.svg') center / cover no-repeat, #1f3328; color: var(--bar-text); }}
.topbar h1 {{ font-family: var(--head); font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; font-size: 1.5rem; color: var(--route); }}
.topbar .segmented {{ background: rgb(255 255 255 / 0.1); }}
.topbar .segmented button {{ color: #dfe3cf; font-family: var(--head); font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.85rem; }}
.topbar .segmented button.on {{ background: var(--route); color: var(--accent-ink); }}
.segmented {{ background: #e3e6d6; }}
.segmented button.on {{ background: #fff; color: var(--text); }}
.weeknav.compact .iconbtn, .iconbtn {{ background: var(--card); border: 1px solid #c9cdb8; border-radius: 10px; color: var(--text); }}
.weeknav .label strong {{ font-family: var(--head); font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; font-size: 1.18rem; }}
.weeknav .label .muted {{ font-family: var(--mono); font-size: 0.78rem; }}
.compliment {{ background: var(--card); border: 1px solid #e0e3d3; border-left: 4px solid var(--route); border-radius: 8px; }}
.block-week {{ color: var(--block); }}
.progress {{ background: #dde1cf; }}
.progress > div {{ background: var(--done); }}
.wdays {{ background: var(--card); border: 1px solid #cfd4bf; border-radius: 14px; box-shadow: 0 1px 0 rgb(32 39 30 / 0.05); }}
.wday {{ border-bottom: 1px solid var(--day-line); }}
.wday:nth-child(even) {{ background: var(--day-alt); }}
.wday.today {{ background: #fff7d2; }}
.wday-label {{ position: relative; align-self: stretch; justify-content: center; gap: 1px; }}
.wday-label::before {{ content: ''; position: absolute; top: 0; bottom: 0; left: 50%; width: 3px; margin-left: -1.5px; background: repeating-linear-gradient(to bottom, var(--route) 0 6px, transparent 6px 11px); }}
.wday-label span {{ position: relative; font-family: var(--head); font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; font-size: 0.64rem; color: var(--muted); background: var(--card); padding: 0 3px; border-radius: 3px; }}
.wday-label strong {{ position: relative; width: 26px; height: 26px; background: var(--card); border: 2px solid var(--text); font-family: var(--head); font-weight: 700; font-size: 1.02rem; }}
.wday.today .wday-label span {{ color: var(--accent-text); }}
.wday.today .wday-label strong {{ background: var(--route); border-color: var(--text); color: var(--accent-ink); box-shadow: 0 0 0 3px rgb(255 203 5 / 0.35); }}
.session {{ background: #fff; border: 1px solid #d7dbc9; border-radius: 9px; }}
.session.done {{ background: var(--done-soft); border-color: transparent; }}
.check {{ border-color: #8c937f; }}
.session.done .check, .set-row.done .check {{ background: var(--done); border-color: var(--done); }}
.s-meta {{ font-family: var(--mono); font-size: 0.72rem; }}
.wday .day-add {{ color: #7c836f; }}
.cal-day {{ background: var(--card); border-color: #d5d9c6; border-radius: 8px; }}
.cal-day.today {{ background: var(--accent-soft); border-color: var(--text); }}
.cal-dow {{ font-family: var(--head); font-weight: 700; letter-spacing: 0.08em; }}
.tabbar {{ background: linear-gradient(90deg, var(--route) 55%, transparent 0) top left / 14px 2.5px repeat-x, #1f3328; border-top: 0; }}
.tabbar button {{ color: #c9cfb6; font-family: var(--head); font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; font-size: 0.7rem; }}
.tabbar button.active {{ color: #ffffff; }}
.tabbar button.active span {{ background: var(--route); color: var(--accent-ink); }}
.card {{ background: var(--card); border: 1px solid #d5d9c6; border-radius: 14px; }}
.card h2 {{ font-family: var(--head); font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; font-size: 1.15rem; }}
.tot {{ background: #f2f4ea; border: 1px solid #e0e3d3; }}
.tot strong, .stat-grid strong {{ font-family: var(--head); font-weight: 700; font-size: 1.7rem; }}
.tot-label {{ font-family: var(--mono); font-size: 0.68rem; }}
.bar .col {{ background: #dde1cf; }}
.btn {{ border: 1px solid #c9cdb8; border-radius: 10px; font-family: var(--head); font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; font-size: 1.02rem; }}
.btn.primary {{ background: var(--route); border-color: var(--route); color: var(--accent-ink); }}
.linkbtn {{ color: var(--accent-text); }}
dialog {{ background: var(--card); border-radius: 18px 18px 0 0; }}
dialog::before {{ content: ''; display: block; height: 56px; background: url('themes/trail.svg') center / cover no-repeat, #1f3328; }}
dialog h2 {{ font-family: var(--head); font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; font-size: 1.7rem; }}
.detail-stats div {{ background: #f2f4ea; border: 1px solid #e0e3d3; border-radius: 12px; }}
.detail-stats strong {{ font-family: var(--head); font-weight: 700; font-size: 2.3rem; }}
.detail-stats span {{ font-family: var(--mono); }}
.detail-done {{ background: var(--done-soft); }}
.toast {{ background: #1f3328; }}
"""

THEMES["zonnebloem"] = f"""
:root {{
  --bg: #fffbef; --card: #ffffff; --text: #3d2814; --muted: #7a6248; --line: #efe3c3;
  --accent: #ffc928; --accent-ink: #3d2814; --accent-text: #8f5d00; --accent-soft: #fff1bf;
  --done: #4f8a2c; --done-soft: #e8f3dc; --danger: #c2410c; --plan: #5b54d1; --block: #2f7f86;
  --bar: #3d2814; --bar-text: #fff8e6; --day-line: #f1e7cc; --day-alt: #fffaea;
{LIGHT_TYPES}
  --c-wedstrijd: #3d2814;
  --head: 'Fredoka', 'Nunito', 'Arial Rounded MT Bold', sans-serif;
  color-scheme: light;
}}
html, body {{ background: var(--bg); color: var(--text); }}
{BANNER_FIT}
.topbar {{ background: url('themes/zonnebloem.svg') center bottom / cover no-repeat, #7fc0ec; color: var(--text); }}
.topbar h1 {{ font-family: var(--head); font-weight: 600; font-size: 1.55rem; color: #4a2f14; letter-spacing: 0.01em; }}
.topbar .segmented {{ background: rgb(255 255 255 / 0.75); border: 1px solid rgb(255 255 255 / 0.9); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }}
.topbar .segmented button {{ color: var(--text); font-family: var(--head); font-weight: 600; }}
.topbar .segmented button.on {{ background: var(--accent); color: var(--accent-ink); }}
.segmented {{ background: #f6ecd0; }}
.segmented button.on {{ background: #fff; color: var(--text); }}
.weeknav.compact .iconbtn, .iconbtn {{ background: #fff; border: 1px solid var(--line); border-radius: 12px; color: var(--text); }}
.weeknav .label strong {{ font-family: var(--head); font-weight: 600; font-size: 1.08rem; }}
.compliment {{ background: #fff1bf; border: 1px solid #ffe28a; color: #4a2f14; border-radius: 14px; }}
.block-week {{ color: var(--block); }}
.progress {{ background: #f1e7cc; }}
.progress > div {{ background: var(--done); }}
.wdays {{ background: #fff; border: 1px solid #f1e7cc; border-radius: 18px; box-shadow: 0 6px 20px rgb(122 82 20 / 0.08); }}
.wday {{ border-bottom: 1px solid var(--day-line); }}
.wday:nth-child(even) {{ background: var(--day-alt); }}
.wday.today {{ background: linear-gradient(90deg, #fff0b8, #fff9e6 60%, #ffffff); }}
.wday-label span {{ position: relative; z-index: 1; font-family: var(--head); font-weight: 600; letter-spacing: 0.08em; font-size: 0.64rem; color: var(--muted); }}
.wday-label strong {{ font-family: var(--head); font-weight: 600; font-size: 1.12rem; }}
.wday.today .wday-label span {{ color: var(--accent-text); }}
/* Vandaag staat het dagnummer op het hart van een zonnebloem. */
.wday.today .wday-label strong {{ position: relative; z-index: 0; background: none; color: #fff6d8; font-size: 0.92rem; }}
.wday.today .wday-label strong::before {{ content: ''; position: absolute; inset: -4px; z-index: -1; background: url('themes/zonnebloem-dag.svg') center / contain no-repeat; }}
.session {{ background: #fff; border: 1px solid #f0e4c4; border-radius: 12px; }}
.session.done {{ background: var(--done-soft); border-color: transparent; }}
.check {{ border-color: #c9b48a; }}
.session.done .check, .set-row.done .check {{ background: var(--done); border-color: var(--done); }}
.wday .day-add {{ color: #b39a6b; }}
.cal-day {{ border-color: var(--line); border-radius: 10px; }}
.cal-day.today {{ background: var(--accent-soft); border-color: var(--accent); }}
.cal-day.today .cal-num {{ color: var(--accent-ink); }}
.tabbar {{ background: #ffffff; border-top: 1px solid #f1e7cc; }}
.tabbar button {{ color: var(--muted); font-family: var(--head); font-weight: 600; }}
.tabbar button.active {{ color: var(--text); }}
.tabbar button.active span {{ background: var(--accent); color: var(--accent-ink); }}
.card {{ border: 1px solid #f1e7cc; border-radius: 18px; box-shadow: 0 6px 20px rgb(122 82 20 / 0.06); }}
.card h2 {{ font-family: var(--head); font-weight: 600; font-size: 1.2rem; }}
.tot {{ background: #fff8e1; }}
.tot strong, .stat-grid strong {{ font-family: var(--head); font-weight: 600; }}
.bar .col {{ background: #f1e7cc; }}
.btn {{ border: 1px solid var(--line); border-radius: 14px; font-family: var(--head); font-weight: 600; }}
.btn.primary {{ background: var(--accent); border-color: var(--accent); color: var(--accent-ink); box-shadow: 0 4px 14px rgb(255 201 40 / 0.4); }}
.linkbtn {{ color: var(--accent-text); }}
dialog {{ background: #fff; border-radius: 22px 22px 0 0; }}
dialog::before {{ content: ''; display: block; height: 58px; background: url('themes/zonnebloem-sheet.svg') center bottom / cover no-repeat; }}
dialog h2 {{ font-family: var(--head); font-weight: 600; font-size: 1.45rem; }}
.detail-stats div {{ background: #fff8e1; border: 0; border-radius: 14px; }}
.detail-stats strong {{ font-family: var(--head); font-weight: 600; font-size: 1.9rem; }}
.detail-done {{ background: var(--done-soft); }}
.toast {{ background: var(--text); }}
"""


def scope(css, theme):
    """Zet html[data-thema="..."] voor elke selector, zodat het thema alleen dan geldt."""
    root = f'html[data-thema="{theme}"]'
    out = []
    for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", css):
        sels, body = m.group(1).strip(), m.group(2).strip()
        comment = ""
        if "*/" in sels:
            comment, sels = sels.rsplit("*/", 1)
            comment += "*/\n"
            sels = sels.strip()
        scoped = []
        for sel in (x.strip() for x in sels.split(",")):
            if sel in (":root", "html"):
                scoped.append(root)
            elif sel.startswith("html "):
                scoped.append(root + sel[4:])
            else:
                scoped.append(f"{root} {sel}")
        out.append(f"{comment}{', '.join(scoped)} {{ {' '.join(body.split())} }}")
    return "\n".join(out)


header = """/* Thema's van Tarapp. Het gekozen thema staat als data-thema op <html>; zonder
   thema (Klassiek) geldt alleen styles.css. Landschappen staan in themes/, de
   lettertypes in fonts/ (SIL Open Font License, zie fonts/OFL-*.txt). Gemaakt met
   tools/tarapp-themes/build_app_themes.py: pas dat script aan, niet dit bestand. */
"""
parts = [header, "\n".join(faces)]
titles = {
    "bergen": "Bergen: de zon tussen besneeuwde toppen, mist in het dal",
    "bos": "Bos: een dennenbos bij zonsondergang",
    "trail": "Trail: een stafkaart met een gele route door je week",
    "zonnebloem": "Zonnebloem: een zonnebloemveld onder een zomerlucht",
}
for name, css in THEMES.items():
    parts.append(f"\n/* ---------- {titles[name]} ---------- */")
    parts.append(scope(css, name))
(app / "themes.css").write_text("\n".join(parts) + "\n")
print("themes.css", (app / "themes.css").stat().st_size // 1024, "KB;", len(images), "plaatjes;", len(faces), "lettertypes")
