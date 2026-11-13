#!/usr/bin/env python3
"""onverhard.py - plan hardlooproutes met zo veel mogelijk onverharde ondergrond.

Routering:   BRouter (eigen profiel, OpenStreetMap-data)
Ondergrond:  BGT (Basisregistratie Grootschalige Topografie) via PDOK
Luchtfoto:   PDOK luchtfoto RGB (WMS)

Gebruik:
    python onverhard.py "lat,lon" ["lat,lon" ...] "lat,lon" -o route
    python onverhard.py "lat,lon" --rondje 15 -o rondje

Zie README.md voor uitleg, keuzes en beperkingen.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import html
import io
import json
import math
import sys
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from xml.etree import ElementTree
from xml.sax.saxutils import escape as xml_escape

import numpy as np
import requests
import shapely
from pyproj import Transformer
from shapely.geometry import LineString, box, shape
from shapely.ops import substring
from shapely.strtree import STRtree

VERSIE = "1.0"
USER_AGENT = f"onverhard-planner/{VERSIE}"

BROUTER_URL = "https://brouter.de/brouter"
BGT_URL = "https://api.pdok.nl/lv/bgt/ogc/v1/collections/{collectie}/items"
LUCHTFOTO_WMS = "https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0"
CRS_RD = "http://www.opengis.net/def/crs/EPSG/0/28992"

# Ondergrondklassen van het rapport, van zacht naar hard.
ONVERHARD = "onverhard"
HALF = "half verhard"
OPEN = "open verharding"
GESLOTEN = "gesloten verharding"
ONBEKEND = "onbekend"
KLASSEN = [ONVERHARD, HALF, OPEN, GESLOTEN, ONBEKEND]
ZACHT = {ONVERHARD, HALF}
HARD = {OPEN, GESLOTEN}

BGT_COLLECTIES = ["wegdeel", "ondersteunendwegdeel", "onbegroeidterreindeel", "begroeidterreindeel"]

# Instelbare afstanden (meters, in RD-coordinaten).
STUK_M = 50.0        # maximale lengte van een routestuk in het rapport
STAP_M = 5.0         # afstand tussen meetpunten binnen een stuk
CORRIDOR_M = 15.0    # zo ver rond de route halen we BGT-vlakken op
RASTER_M = 500.0     # de corridor wordt per rastercel van deze grootte opgehaald
SNAP_M = 3.0         # ligt de lijn zo dicht bij een wegdeel, dan telt dat wegdeel

TTL_ROUTE = 7 * 86400
TTL_PROFIEL = 2 * 3600
TTL_BGT = 30 * 86400
TTL_LUCHTFOTO = 90 * 86400

_NAAR_RD = Transformer.from_crs(4326, 28992, always_xy=True)
_NAAR_WGS = Transformer.from_crs(28992, 4326, always_xy=True)


class BronFout(Exception):
    """Een externe bron (BRouter of PDOK) gaf een fout."""

    def __init__(self, bron: str, melding: str):
        super().__init__(f"{bron}: {melding}")
        self.bron = bron
        self.melding = melding


def groep(klasse: str) -> str | None:
    """'zacht', 'hard' of None (onbekend)."""
    if klasse in ZACHT:
        return "zacht"
    if klasse in HARD:
        return "hard"
    return None


def nl(getal: float, decimalen: int = 2) -> str:
    return f"{getal:.{decimalen}f}".replace(".", ",")


def meld(tekst: str = "") -> None:
    print(tekst, flush=True)


def waarschuw(tekst: str) -> None:
    print(f"LET OP: {tekst}", file=sys.stderr, flush=True)


# ---------------------------------------------------------------------------
# Web: HTTP met cache, herhaalpogingen en nette foutmeldingen
# ---------------------------------------------------------------------------

class Web:
    """HTTP-client met een eenvoudige bestandscache (map cache/)."""

    def __init__(self, cachemap: Path | None, ververs: bool = False):
        self.cachemap = cachemap
        self.ververs = ververs
        self._lokaal = threading.local()
        self._slot = threading.Lock()
        self._brouter_slot = threading.Lock()
        self._brouter_laatst = 0.0
        self.teller = Counter()

    def _sessie(self) -> requests.Session:
        s = getattr(self._lokaal, "sessie", None)
        if s is None:
            s = requests.Session()
            s.headers["User-Agent"] = USER_AGENT
            self._lokaal.sessie = s
        return s

    def _pad(self, soort: str, sleutel: str, ext: str) -> Path:
        naam = hashlib.sha1(sleutel.encode()).hexdigest()
        return self.cachemap / soort / f"{naam}.{ext}"

    def cache_lees(self, soort: str, sleutel: str, ext: str, ttl: float) -> bytes | None:
        if self.cachemap is None or self.ververs:
            return None
        pad = self._pad(soort, sleutel, ext)
        try:
            if time.time() - pad.stat().st_mtime > ttl:
                return None
            data = pad.read_bytes()
        except OSError:
            return None
        with self._slot:
            self.teller["cache"] += 1
        return data

    def cache_schrijf(self, soort: str, sleutel: str, ext: str, data: bytes) -> None:
        if self.cachemap is None:
            return
        pad = self._pad(soort, sleutel, ext)
        try:
            pad.parent.mkdir(parents=True, exist_ok=True)
            tijdelijk = pad.with_suffix(f".{threading.get_ident()}.tmp")
            tijdelijk.write_bytes(data)
            tijdelijk.replace(pad)
        except OSError as e:  # een kapotte cache mag de planner niet stoppen
            waarschuw(f"cache niet beschrijfbaar ({e})")

    def vraag(self, bron: str, methode: str, url: str, *, params=None, data=None,
              headers=None, timeout: float = 90, pogingen: int = 4) -> requests.Response:
        """Doe een verzoek; herhaal bij netwerkfouten en 'probeer later'-antwoorden."""
        wachttijden = [2, 6, 15]
        laatste = "onbekende fout"
        for poging in range(pogingen):
            if bron == "BRouter":  # de publieke BRouter-server begrenst het tempo
                with self._brouter_slot:
                    wacht = 1.0 - (time.time() - self._brouter_laatst)
                    if wacht > 0:
                        time.sleep(wacht)
                    self._brouter_laatst = time.time()
            try:
                r = self._sessie().request(methode, url, params=params, data=data,
                                           headers=headers, timeout=timeout)
            except requests.RequestException as e:
                laatste = f"netwerkfout: {e.__class__.__name__}: {e}"
            else:
                with self._slot:
                    self.teller["net"] += 1
                druk = r.status_code in (429, 502, 503, 504) or (
                    r.status_code == 403 and "retry later" in r.text[:200].lower())
                if not druk:
                    return r
                laatste = f"HTTP {r.status_code}: {r.text[:200].strip()}"
            if poging < pogingen - 1:
                time.sleep(wachttijden[min(poging, len(wachttijden) - 1)])
        raise BronFout(bron, f"{laatste} (na {pogingen} pogingen)")


# ---------------------------------------------------------------------------
# Bron 1: BRouter
# ---------------------------------------------------------------------------

PROFIEL = """\
# onverhard-planner: voorkeur voor onverharde paden (hardlopen)
---context:global
assign processUnusedTags = true
assign validForFoot = true
assign turnInstructionMode = 1
---context:way
assign isunpaved = surface=unpaved|ground|dirt|grass|sand|earth|clay|rock
assign ishalf = surface=gravel|fine_gravel|compacted
assign ispaved = surface=asphalt|paved|concrete|paving_stones|sett|cobblestone|grass_paver
assign footok = foot=yes|designated|permissive
assign forbidden = or highway=motorway|motorway_link|trunk|trunk_link|construction|proposed
                   or ( and access=private|no not footok ) foot=no|private
assign base =
  if forbidden then 10000
  else if isunpaved then 1
  else if ishalf then 1.1
  else if ispaved then
     ( if highway=path|track|footway|pedestrian|bridleway then 3 else if highway=primary|primary_link then 8 else if highway=secondary|secondary_link then 6 else 4 )
  else if highway=track then
     ( if tracktype=grade1 then 3 else if tracktype=grade2 then 1.2 else 1.3 )
  else if highway=path|bridleway then 1.3
  else if highway=footway|pedestrian|steps then 2.5
  else if highway=residential|living_street|service|unclassified|cycleway|tertiary|tertiary_link then 4
  else if highway=secondary|secondary_link then 6
  else if highway=primary|primary_link then 8
  else 10000
assign islaw = or route_hiking_nwn=yes route_hiking_iwn=yes
assign costfactor = if islaw then base else multiply base NIETLAW
assign turncost = 0
assign initialcost = 0
---context:node
assign initialcost = 0
"""


def maak_profiel(law: float) -> str:
    """Profieltekst voor BRouter.

    --law 0.3 betekent: een LAW-pad kost 0,3x zoveel als hetzelfde pad zonder
    LAW. Omdat BRouter geen kostenfactor onder 1 hoort te krijgen, maken we
    niet de LAW-paden goedkoper maar alle andere wegen 1/law keer duurder; dat
    geeft exact dezelfde verhoudingen.
    """
    if not 0.05 <= law <= 1.0:
        raise ValueError("--law moet tussen 0.05 en 1.0 liggen")
    return PROFIEL.replace("NIETLAW", f"{1.0 / law:.4f}")


@dataclass
class Traject:
    """Een route: coordinaten plus per stuk de OSM-tags volgens BRouter."""
    coords: list            # [(lon, lat, hoogte)]
    segs: list              # [(i0, i1, 'highway=path surface=grass ...')]
    punten: list = field(default_factory=list)  # opgegeven punten [(lat, lon)]

    def lengte(self) -> float:
        return lijn_lengte(naar_rd(self.coords))


def naar_rd(coords) -> list:
    if not coords:
        return []
    xs, ys = _NAAR_RD.transform([c[0] for c in coords], [c[1] for c in coords])
    return list(zip(xs, ys))


def lijn_lengte(xy) -> float:
    return sum(math.dist(a, b) for a, b in zip(xy, xy[1:]))


def lees_brouter_route(feature: dict) -> Traject:
    """Zet een BRouter-GeoJSON-feature om in een Traject.

    properties.messages is een tabel met in de eerste rij de kolomnamen. Elke
    volgende rij beschrijft het stuk dat EINDIGT op (Longitude, Latitude).
    """
    coords = [tuple(c[:3]) if len(c) >= 3 else (c[0], c[1], None)
              for c in feature["geometry"]["coordinates"]]
    berichten = feature.get("properties", {}).get("messages") or []
    if len(coords) < 2:
        raise BronFout("BRouter", "route zonder geometrie ontvangen")
    if len(berichten) < 2:
        return Traject(coords, [(0, len(coords) - 1, "")])
    kop = berichten[0]
    k_lon, k_lat, k_tags = kop.index("Longitude"), kop.index("Latitude"), kop.index("WayTags")
    sleutels = [(round(c[0] * 1e6), round(c[1] * 1e6)) for c in coords]
    segs, vorige = [], 0
    for rij in berichten[1:]:
        doel = (int(rij[k_lon]), int(rij[k_lat]))
        try:
            i = sleutels.index(doel, vorige)
        except ValueError:
            # afrondingsverschil: neem het dichtstbijzijnde punt verderop
            rest = range(vorige, len(coords))
            i = min(rest, key=lambda j: abs(sleutels[j][0] - doel[0]) + abs(sleutels[j][1] - doel[1]))
        if i > vorige:
            tags = " ".join(t for t in rij[k_tags].split() if not t.startswith("reversedirection="))
            segs.append((vorige, i, tags))
            vorige = i
    if vorige < len(coords) - 1:
        segs.append((vorige, len(coords) - 1, segs[-1][2] if segs else ""))
    return Traject(coords, segs)


def plak(trajecten: list) -> Traject:
    """Plak deeltrajecten (van punt naar punt) achter elkaar."""
    coords, segs = [], []
    for t in trajecten:
        verschuiving = len(coords)
        if coords and t.coords and coords[-1][:2] == t.coords[0][:2]:
            verschuiving -= 1
            coords.extend(t.coords[1:])
        else:
            coords.extend(t.coords)
        segs.extend((i0 + verschuiving, i1 + verschuiving, tags) for i0, i1, tags in t.segs)
    return Traject(coords, segs)


class BRouter:
    def __init__(self, web: Web, law: float = 1.0):
        self.web = web
        self.law = law
        self.profiel = maak_profiel(law)
        self._sleutel = hashlib.sha1(self.profiel.encode()).hexdigest()[:16]
        self._id = None

    def profiel_id(self, vernieuw: bool = False) -> str:
        """Upload het profiel (of hergebruik het id; dat blijft maar kort geldig)."""
        if self._id and not vernieuw:
            return self._id
        if not vernieuw:
            bewaard = self.web.cache_lees("brouter", "profiel|" + self._sleutel, "txt", TTL_PROFIEL)
            if bewaard:
                self._id = bewaard.decode()
                return self._id
        r = self.web.vraag("BRouter", "POST", BROUTER_URL + "/profile",
                           data=self.profiel.encode(), headers={"Content-Type": "text/plain"})
        if r.status_code != 200:
            raise BronFout("BRouter", f"profiel uploaden mislukt: HTTP {r.status_code} {r.text[:200].strip()}")
        try:
            antwoord = r.json()
        except ValueError:
            raise BronFout("BRouter", f"onleesbaar antwoord op profiel-upload: {r.text[:200].strip()}")
        if antwoord.get("error"):
            raise BronFout("BRouter", f"profiel geweigerd: {antwoord['error']}")
        if not antwoord.get("profileid"):
            raise BronFout("BRouter", f"geen profileid ontvangen: {r.text[:200].strip()}")
        self._id = antwoord["profileid"]
        self.web.cache_schrijf("brouter", "profiel|" + self._sleutel, "txt", self._id.encode())
        return self._id

    def route(self, punten: list, alternatief: int = 0) -> Traject:
        """Route langs punten [(lat, lon), ...]. Let op: BRouter wil lon voor lat."""
        lonlats = "|".join(f"{lon:.6f},{lat:.6f}" for lat, lon in punten)
        sleutel = f"route|{self._sleutel}|{lonlats}|{alternatief}"
        bewaard = self.web.cache_lees("brouter", sleutel, "json.gz", TTL_ROUTE)
        if bewaard:
            try:
                return lees_brouter_route(json.loads(gzip.decompress(bewaard)))
            except (ValueError, KeyError, OSError):
                pass  # kapotte cache: opnieuw ophalen
        for poging in (0, 1):
            pid = self.profiel_id(vernieuw=poging == 1)
            r = self.web.vraag("BRouter", "GET", BROUTER_URL, timeout=150, params={
                "lonlats": lonlats, "profile": pid, "alternativeidx": alternatief, "format": "geojson"})
            tekst = r.text.strip()
            if r.status_code == 200 and tekst.startswith("{"):
                try:
                    feature = r.json()["features"][0]
                    traject = lees_brouter_route(feature)
                except (ValueError, KeyError, IndexError) as e:
                    raise BronFout("BRouter", f"onverwacht antwoord ({e.__class__.__name__}): {tekst[:200]}")
                self.web.cache_schrijf("brouter", sleutel, "json.gz", gzip.compress(json.dumps(feature).encode()))
                return traject
            # Een verlopen profiel-id geeft HTTP 500 zonder tekst: 1x opnieuw uploaden.
            if poging == 0 and (r.status_code == 500 or "profile" in tekst.lower()):
                continue
            raise BronFout("BRouter", f"HTTP {r.status_code}: {tekst[:300] or '(leeg antwoord)'}")
        raise BronFout("BRouter", "geen route ontvangen")


# ---------------------------------------------------------------------------
# OSM-tags -> ondergrondklasse
# ---------------------------------------------------------------------------

OSM_SURFACE = {}
for _k, _waarden in {
    ONVERHARD: "unpaved ground dirt earth grass sand mud clay rock woodchips soil",
    HALF: "gravel fine_gravel compacted pebblestone shells",
    OPEN: "paving_stones sett cobblestone unhewn_cobblestone bricks grass_paver",
    GESLOTEN: "asphalt concrete paved concrete:plates concrete:lanes chipseal metal wood",
}.items():
    for _w in _waarden.split():
        OSM_SURFACE[_w] = _k


def tags_dict(tags: str) -> dict:
    return dict(t.split("=", 1) for t in tags.split() if "=" in t)


def osm_klasse(tags: str) -> tuple:
    """Geef (klasse, zeker, uitleg) op basis van OSM-tags.

    zeker=True alleen als er een surface-tag is; anders is het een aanname op
    basis van het wegtype (dezelfde aanname die het routeprofiel doet).
    """
    t = tags_dict(tags)
    surface, highway = t.get("surface"), t.get("highway", "")
    if surface in OSM_SURFACE:
        return OSM_SURFACE[surface], True, f"surface={surface}"
    voor = f"surface={surface} (onbekende waarde), " if surface else ""
    if highway == "track":
        graad = t.get("tracktype")
        if graad == "grade1":
            return GESLOTEN, False, voor + "aanname: track grade1"
        if graad == "grade2":
            return HALF, False, voor + "aanname: track grade2"
        return ONVERHARD, False, voor + f"aanname: track{' ' + graad if graad else ''} zonder surface"
    if highway in ("path", "bridleway"):
        return ONVERHARD, False, voor + f"aanname: {highway} zonder surface"
    if highway in ("footway", "pedestrian", "steps"):
        return ONBEKEND, False, voor + f"{highway} zonder surface"
    if highway in ("cycleway", "residential", "living_street", "service", "unclassified", "tertiary",
                   "tertiary_link", "secondary", "secondary_link", "primary", "primary_link"):
        return GESLOTEN, False, voor + f"aanname: {highway} zonder surface"
    return ONBEKEND, False, voor + (f"{highway} zonder surface" if highway else "geen tags")


def is_law(tags: str) -> bool:
    """Loopt hier een landelijke of internationale wandelroute (LAW) overheen?"""
    t = tags_dict(tags)
    return t.get("route_hiking_nwn") == "yes" or t.get("route_hiking_iwn") == "yes"


def kostenfactor(klasse: str, tags: str) -> float:
    """De kostenfactor uit het routeprofiel, maar met een gegeven ondergrondklasse.

    Hiermee rekenen we in ronde 2 uit wat een route 'kost' als we de ondergrond
    van het eindoordeel (BGT) invullen in plaats van de OSM-tags.
    """
    if klasse == ONVERHARD:
        return 1.0
    if klasse == HALF:
        return 1.1
    highway = tags_dict(tags).get("highway", "")
    if klasse in HARD:
        if highway in ("path", "track", "footway", "pedestrian", "bridleway", "steps"):
            return 3.0
        if highway in ("primary", "primary_link"):
            return 8.0
        if highway in ("secondary", "secondary_link"):
            return 6.0
        return 4.0
    return 2.5  # onbekend: tussen pad en weg in


def osm_niveau(tags: str) -> int:
    """+1 op een brug, -1 in een tunnel, anders 0 (voor de BGT-hoogteligging)."""
    t = tags_dict(tags)
    if t.get("bridge", "no") != "no":
        return 1
    if t.get("tunnel", "no") != "no":
        return -1
    return 0


# ---------------------------------------------------------------------------
# Bron 2: BGT via PDOK (OGC API Features)
# ---------------------------------------------------------------------------

BGT_LABEL = {
    "wegdeel": "wegdeel",
    "ondersteunendwegdeel": "ondersteunend wegdeel (berm)",
    "onbegroeidterreindeel": "onbegroeid terreindeel",
    "begroeidterreindeel": "begroeid terreindeel",
}


def bgt_klasse(collectie: str, fysiek: str | None) -> str:
    """Vertaal BGT fysiek_voorkomen naar een rapportklasse."""
    f = (fysiek or "").strip().lower()
    if f in (GESLOTEN, OPEN, HALF, ONVERHARD):
        return f
    if f in ("groenvoorziening", "zand"):
        return ONVERHARD
    if f in ("", "transitie", "erf", "waardeonbekend", "niet-bgt"):
        return ONBEKEND
    if collectie == "begroeidterreindeel":
        return ONVERHARD  # gras, bos, heide, duin, akker, ...
    return ONBEKEND


@dataclass
class Vlak:
    collectie: str
    fysiek: str
    plus: str
    functie: str
    niveau: int
    klasse: str

    def uitleg(self) -> str:
        delen = [BGT_LABEL[self.collectie]]
        if self.functie:
            delen.append(self.functie)
        tekst = ", ".join(delen) + ": " + (self.fysiek or "?")
        if self.plus:
            tekst += f" ({self.plus})"
        return tekst


def _teken(n: int) -> int:
    return (n > 0) - (n < 0)


class Bgt:
    """Haalt BGT-vlakken op rond een route en zoekt per punt het vlak op."""

    def __init__(self, web: Web, snap: float = SNAP_M, draden: int = 4):
        self.web = web
        self.snap = snap
        self.draden = draden
        self.vlakken: dict = {}     # (collectie, lokaal_id) -> index
        self.lijst: list = []       # Vlak
        self.geoms: list = []
        self.boom = None
        self._boom_n = 0
        self.gehaald: set = set()   # (collectie, bbox) die al opgehaald zijn
        self.fouten: list = []
        self.verzoeken = 0
        self.buiten_bbox = 0
        self.onbereikbaar = False   # True zodra een hele ronde verzoeken mislukt

    # -- ophalen ----------------------------------------------------------
    @staticmethod
    def corridor_bboxen(xy: list) -> list:
        """Verdeel de corridor rond de route in kleine bboxen (RD, meters).

        De route wordt per rastercel van RASTER_M opgeknipt; per bezoek aan een
        cel vragen we alleen de strakke bbox van dat routedeel op (+ CORRIDOR_M).
        Zo blijven de verzoeken klein en krijgen overlappende routes
        (alternatieven) dezelfde bboxen, wat de cache ten goede komt.
        """
        dicht = []
        for a, b in zip(xy, xy[1:]):
            n = max(1, math.ceil(math.dist(a, b) / 25.0))
            dicht.extend((a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n) for i in range(n))
        dicht.append(xy[-1])
        bboxen, groep_, cel = [], [], None
        for p in dicht:
            c = (math.floor(p[0] / RASTER_M), math.floor(p[1] / RASTER_M))
            if cel is not None and c != cel:
                bboxen.append(groep_ + [p])  # grenspunt hoort bij beide groepen
                groep_ = []
            cel = c
            groep_.append(p)
        bboxen.append(groep_)
        uit, gezien = [], set()
        for g in bboxen:
            xs, ys = [p[0] for p in g], [p[1] for p in g]
            bb = (math.floor((min(xs) - CORRIDOR_M) / 10) * 10, math.floor((min(ys) - CORRIDOR_M) / 10) * 10,
                  math.ceil((max(xs) + CORRIDOR_M) / 10) * 10, math.ceil((max(ys) + CORRIDOR_M) / 10) * 10)
            if bb not in gezien:
                gezien.add(bb)
                uit.append(bb)
        return uit

    def _haal(self, collectie: str, bb: tuple) -> list:
        """Haal een collectie binnen een bbox op (met paginering); geeft compacte dicts."""
        sleutel = f"{collectie}|{bb[0]},{bb[1]},{bb[2]},{bb[3]}"
        bewaard = self.web.cache_lees("bgt", sleutel, "json.gz", TTL_BGT)
        if bewaard:
            try:
                return json.loads(gzip.decompress(bewaard))
            except (ValueError, OSError):
                pass
        url = BGT_URL.format(collectie=collectie)
        params = {
            "f": "json", "limit": 1000,
            "bbox": ",".join(str(int(v)) for v in bb),
            "bbox-crs": CRS_RD, "crs": CRS_RD,
            # zonder datetime levert de API ook alle historische versies
            "datetime": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        vak = box(*bb)
        uit, buiten = [], 0
        for _pagina in range(200):
            r = self.web.vraag("PDOK BGT", "GET", url, params=params, timeout=120)
            if r.status_code != 200:
                raise BronFout("PDOK BGT", f"{collectie}: HTTP {r.status_code}: {r.text[:200].strip()}")
            crs = r.headers.get("Content-Crs", "")
            if "28992" not in crs:
                raise BronFout("PDOK BGT", f"{collectie}: onverwacht CRS in antwoord ({crs or 'geen Content-Crs'})")
            try:
                d = r.json()
            except ValueError:
                raise BronFout("PDOK BGT", f"{collectie}: onleesbaar antwoord")
            for f in d.get("features", []):
                p = f.get("properties", {})
                if p.get("eind_registratie") is not None or f.get("geometry") is None:
                    continue  # historische versie
                if (p.get("status") or "bestaand") != "bestaand":
                    continue  # plan/historie
                try:
                    g = shape(f["geometry"])
                except Exception:
                    continue
                if g.is_empty or g.geom_type not in ("Polygon", "MultiPolygon"):
                    continue
                if not g.intersects(vak):
                    buiten += 1  # controle: resultaat moet echt in de bbox liggen
                    continue
                uit.append({
                    "id": p.get("lokaal_id") or f.get("id"),
                    "fv": p.get("fysiek_voorkomen") or "",
                    "pfv": p.get("plus_fysiek_voorkomen") or "",
                    "fn": p.get("functie") or "",
                    "hl": int(p.get("relatieve_hoogteligging") or 0),
                    "wkt": shapely.to_wkt(g, rounding_precision=2),
                })
            url = next((l["href"] for l in d.get("links", []) if l.get("rel") == "next"), None)
            params = None
            if not url:
                break
        if buiten:
            self.buiten_bbox += buiten
        self.web.cache_schrijf("bgt", sleutel, "json.gz", gzip.compress(json.dumps(uit).encode()))
        return uit

    def _haal_taken(self, taken: list) -> None:
        """Haal (collectie, bbox)-paren op in een paar draden en zet de vlakken in het geheugen."""
        taken = [t for t in taken if t not in self.gehaald]
        if not taken or self.onbereikbaar:
            return

        def werk(taak):
            try:
                return taak, self._haal(*taak), None
            except BronFout as e:
                return taak, [], e
            except Exception as e:  # nooit een draad laten crashen
                return taak, [], BronFout("PDOK BGT", f"{e.__class__.__name__}: {e}")

        with ThreadPoolExecutor(max_workers=self.draden) as pool:
            resultaten = list(pool.map(werk, taken))
        if len(taken) >= 4 and all(fout for _, _, fout in resultaten):
            self.onbereikbaar = True  # PDOK ligt eruit: niet blijven proberen
        for taak, features, fout in resultaten:
            self.verzoeken += 1
            if fout:
                self.fouten.append(fout.melding)
                continue
            self.gehaald.add(taak)
            collectie = taak[0]
            for f in features:
                sleutel = (collectie, f["id"])
                if sleutel in self.vlakken:
                    continue
                try:
                    g = shapely.from_wkt(f["wkt"])
                except Exception:
                    continue
                self.vlakken[sleutel] = len(self.lijst)
                self.lijst.append(Vlak(collectie, f["fv"], f["pfv"], f["fn"], f["hl"],
                                       bgt_klasse(collectie, f["fv"])))
                self.geoms.append(g)

    def _boom(self) -> STRtree:
        if self.boom is None or self._boom_n != len(self.geoms):
            self._geom_arr = np.array(self.geoms, dtype=object)
            self._is_weg = np.array([v.collectie == "wegdeel" for v in self.lijst], dtype=bool)
            self.boom = STRtree(self.geoms)
            self._boom_n = len(self.geoms)
        return self.boom

    def haal_corridor(self, xy: list, meetpunten: list) -> None:
        """Zorg dat de BGT-vlakken rond deze route in het geheugen staan.

        Stap 1: de wegdelen voor de hele corridor. Stap 2: de bermen en
        terreindelen alleen voor de bboxen waar een meetpunt NIET op een
        wegdeel ligt. In de stad ligt bijna alles op een wegdeel; dat scheelt
        dus veel verzoeken aan PDOK.
        """
        bboxen = self.corridor_bboxen(xy)
        self._haal_taken([("wegdeel", bb) for bb in bboxen])
        if not meetpunten:
            return
        pts_xy = np.array(meetpunten, dtype=float)
        los = np.ones(len(pts_xy), dtype=bool)
        if self.geoms:
            pi, vi = self._boom().query(shapely.points(pts_xy), predicate="dwithin", distance=0.01)
            los[pi[self._is_weg[vi]]] = False
        rest = []
        for bb in bboxen:
            in_bb = ((pts_xy[:, 0] >= bb[0]) & (pts_xy[:, 0] <= bb[2])
                     & (pts_xy[:, 1] >= bb[1]) & (pts_xy[:, 1] <= bb[3]))
            if (in_bb & los).any():
                rest.extend((c, bb) for c in BGT_COLLECTIES[1:])
        self._haal_taken(rest)

    # -- opzoeken ---------------------------------------------------------
    def zoek(self, punten: list, niveaus: list, osm_groepen: list) -> list:
        """Zoek voor elk punt (x, y) het BGT-oordeel: [(klasse, uitleg, bron)].

        bron is 'wegdeel' (lijn ligt op een wegdeel), 'wegdeel-nabij' (binnen
        snap-afstand van een wegdeel), 'terrein' (geen pad geregistreerd, de
        lijn ligt in een terrein- of bermvlak) of 'geen'.
        """
        leeg = (ONBEKEND, "geen BGT-vlak op deze plek", "geen")
        if not self.lijst or not punten:
            return [leeg] * len(punten)
        pts = shapely.points(np.array(punten, dtype=float))
        pi, vi = self._boom().query(pts, predicate="dwithin", distance=self.snap)
        afstand = shapely.distance(pts[pi], self._geom_arr[vi])
        per_punt: dict = {}
        for p, v, d in zip(pi.tolist(), vi.tolist(), afstand.tolist()):
            per_punt.setdefault(p, []).append((d, self.lijst[v]))
        rang = {c: i for i, c in enumerate(BGT_COLLECTIES)}
        uit = []
        for i in range(len(punten)):
            kandidaten = per_punt.get(i)
            if not kandidaten:
                uit.append(leeg)
                continue
            niveau, og = niveaus[i], osm_groepen[i]

            def op_niveau(lijst):
                goed = [k for k in lijst if _teken(k[1].niveau) == niveau]
                return goed or lijst

            binnen = op_niveau([k for k in kandidaten if k[0] <= 0.01])
            binnen.sort(key=lambda k: (rang[k[1].collectie], -k[1].niveau))
            direct = binnen[0][1] if binnen else None
            if direct and direct.collectie == "wegdeel":
                uit.append((direct.klasse, direct.uitleg(), "wegdeel"))
                continue
            nabij = op_niveau([k for k in kandidaten if k[0] > 0.01 and k[1].collectie == "wegdeel"])
            nabij.sort(key=lambda k: k[0])
            if nabij:
                keuze = nabij[0]
                if og:  # OSM heeft een surface-tag: gebruik die om kaartverschuiving op te lossen
                    eens = [k for k in nabij if groep(k[1].klasse) == og]
                    if eens:
                        keuze = eens[0]
                    elif direct and groep(direct.klasse) == og:
                        keuze = None  # het terreinvlak waar de lijn in ligt klopt met OSM
                if keuze:
                    uit.append((keuze[1].klasse, f"{keuze[1].uitleg()} op {nl(keuze[0], 1)} m van de lijn",
                                "wegdeel-nabij"))
                    continue
            if direct:
                uit.append((direct.klasse, f"geen pad geregistreerd; lijn ligt in {direct.uitleg()}", "terrein"))
            else:
                uit.append(leeg)
        return uit


# ---------------------------------------------------------------------------
# Analyse: route -> stukken met OSM-, BGT- en eindoordeel
# ---------------------------------------------------------------------------

@dataclass
class Stuk:
    van: float               # meters vanaf de start
    tot: float
    xy: list                 # RD-coordinaten
    tags: list               # OSM-tagregels in dit stuk
    osm: str
    osm_zeker: bool
    osm_uitleg: str
    bgt: str = ONBEKEND
    bgt_uitleg: str = "BGT niet geraadpleegd"
    bgt_bron: str = "geen"
    bgt_aandeel: float = 0.0
    eind: str = ONBEKEND
    twijfel: str = ""        # soort twijfel ('' = geen)
    twijfel_tekst: str = ""
    foto: str = ""
    indicatie: str = ""

    @property
    def lengte(self) -> float:
        return self.tot - self.van

    def midden_xy(self) -> tuple:
        p = LineString(self.xy).interpolate(0.5, normalized=True)
        return p.x, p.y


def bepaal_eind_en_twijfel(s: Stuk) -> None:
    """BGT wint als die iets weet; markeer conflicten en gissingen als twijfel."""
    s.eind = s.bgt if s.bgt != ONBEKEND else s.osm
    s.twijfel = s.twijfel_tekst = ""
    go, gb = groep(s.osm), groep(s.bgt)
    if gb and go and gb != go:
        if s.osm_zeker:
            s.twijfel = "conflict"
            s.twijfel_tekst = f"OSM zegt {s.osm} ({s.osm_uitleg}), BGT zegt {s.bgt}"
        elif s.bgt_bron == "terrein":
            s.twijfel = "bgt-zwak"
            s.twijfel_tekst = (f"OSM vermoedt {s.osm} ({s.osm_uitleg}); de BGT kent hier geen pad "
                               f"en de lijn ligt in {s.bgt} terrein")
    elif gb is None:
        if s.osm == ONBEKEND:
            s.twijfel = "onbekend"
            s.twijfel_tekst = f"geen van beide bronnen kent de ondergrond ({s.osm_uitleg}; {s.bgt_uitleg})"
        elif not s.osm_zeker:
            s.twijfel = "osm-aanname"
            s.twijfel_tekst = f"alleen een OSM-aanname ({s.osm_uitleg}); BGT: {s.bgt_uitleg}"


@dataclass
class Analyse:
    traject: Traject
    xy: list
    stukken: list            # fijn (max STUK_M)
    samengevoegd: list       # aaneengesloten stukken met hetzelfde oordeel
    lengte: float
    bgt_gebruikt: bool
    dubbel: float = 0.0

    def km(self, bron: str) -> dict:
        """Meters per klasse volgens 'osm', 'bgt' of 'eind'."""
        tot = {k: 0.0 for k in KLASSEN}
        for s in self.stukken:
            tot[getattr(s, bron)] += s.lengte
        return tot

    def law(self) -> float:
        """Aandeel van de route over een LAW (0..1)."""
        return sum(s.lengte for s in self.stukken if is_law(s.tags[0])) / self.lengte if self.lengte else 0.0

    def kosten(self, law_factor: float = 1.0) -> float:
        """Routekosten in 'gewogen km' met de ondergrond van het eindoordeel."""
        totaal = 0.0
        for s in self.stukken:
            f = kostenfactor(s.eind, s.tags[0])
            totaal += s.lengte * (f if is_law(s.tags[0]) else f / law_factor)
        return totaal / 1000.0

    def zachte_stukken(self, aantal: int = 5) -> list:
        """De langste aaneengesloten zachte stukken: [(van, tot, x, y, klassen)]."""
        reeksen, huidig = [], None
        for s in self.stukken:
            if s.eind in ZACHT:
                if huidig is None:
                    huidig = [s.van, s.tot, [], set()]
                    reeksen.append(huidig)
                huidig[1] = s.tot
                huidig[2].extend(s.xy if not huidig[2] else s.xy[1:])
                huidig[3].add(s.eind)
            else:
                huidig = None
        reeksen.sort(key=lambda r: r[0] - r[1])
        uit = []
        for van, tot, xy, klassen in reeksen[:aantal]:
            p = LineString(xy).interpolate(0.5, normalized=True)
            uit.append((van, tot, p.x, p.y, sorted(klassen, key=KLASSEN.index)))
        return uit

    def zacht(self, bron: str = "eind") -> float:
        """Aandeel onverhard + half verhard (0..1)."""
        v = self.km(bron)
        return (v[ONVERHARD] + v[HALF]) / self.lengte if self.lengte else 0.0

    def twijfels(self, minimaal: float) -> list:
        return [s for s in self.samengevoegd if s.twijfel and s.lengte >= minimaal]


def dubbel_aandeel(xy: list) -> float:
    """Aandeel van de route dat (bijna) over hetzelfde stuk heen en terug gaat."""
    if len(xy) < 2:
        return 0.0
    lijn = LineString(xy)
    n = max(2, int(lijn.length / 10))
    cellen: dict = {}
    for i in range(n + 1):
        p = lijn.interpolate(i / n, normalized=True)
        cellen.setdefault((round(p.x / 15), round(p.y / 15)), []).append(i * lijn.length / n)
    dubbel = sum(len(v) for v in cellen.values() if max(v) - min(v) > 150)
    return dubbel / (n + 1)


def analyseer(traject: Traject, bgt: Bgt | None) -> Analyse:
    """Knip de route in stukken en bepaal per stuk OSM-, BGT- en eindoordeel."""
    xy = naar_rd(traject.coords)
    stukken, afstand = [], 0.0
    for i0, i1, tags in traject.segs:
        punten = [xy[i0]] + [p for a, p in zip(xy[i0:i1], xy[i0 + 1:i1 + 1]) if p != a]
        if len(punten) < 2:
            continue
        lijn = LineString(punten)
        lengte = lijn.length
        if lengte < 0.01:
            continue
        klasse, zeker, uitleg = osm_klasse(tags)
        n = max(1, math.ceil(lengte / STUK_M))
        for j in range(n):
            deel = lijn if n == 1 else substring(lijn, lengte * j / n, lengte * (j + 1) / n)
            stukken.append(Stuk(afstand + lengte * j / n, afstand + lengte * (j + 1) / n,
                                list(deel.coords), [tags], klasse, zeker, uitleg))
        afstand += lengte

    bgt_gebruikt = False
    if bgt is not None and stukken:
        punten, niveaus, groepen_, eigenaar = [], [], [], []
        for si, s in enumerate(stukken):
            lijn = LineString(s.xy)
            k = max(3, math.ceil(lijn.length / STAP_M))
            niveau = osm_niveau(s.tags[0])
            og = groep(s.osm) if s.osm_zeker else None
            for j in range(k):
                p = lijn.interpolate((j + 0.5) / k, normalized=True)
                punten.append((p.x, p.y))
                niveaus.append(niveau)
                groepen_.append(og)
                eigenaar.append(si)
        bgt.haal_corridor(xy, punten)
        oordelen = bgt.zoek(punten, niveaus, groepen_)
        per_stuk: dict = {}
        for si, o in zip(eigenaar, oordelen):
            per_stuk.setdefault(si, []).append(o)
        for si, s in enumerate(stukken):
            lijst = per_stuk[si]
            # per stuk wint de klasse met de grootste overlap (meeste meetpunten)
            klasse, stemmen = Counter(o[0] for o in lijst).most_common(1)[0]
            _, uitleg, bron = Counter(o for o in lijst if o[0] == klasse).most_common(1)[0][0]
            s.bgt, s.bgt_uitleg, s.bgt_bron, s.bgt_aandeel = klasse, uitleg, bron, stemmen / len(lijst)
        bgt_gebruikt = bool(bgt.lijst)
    for s in stukken:
        bepaal_eind_en_twijfel(s)

    samen = []
    for s in stukken:
        v = samen[-1] if samen else None
        if v and (v.osm, v.osm_zeker, v.bgt, v.eind, v.twijfel) == (s.osm, s.osm_zeker, s.bgt, s.eind, s.twijfel):
            v.tot = s.tot
            v.xy = v.xy + s.xy[1:]
            for t in s.tags:
                if t not in v.tags:
                    v.tags.append(t)
        else:
            samen.append(Stuk(s.van, s.tot, list(s.xy), list(s.tags), s.osm, s.osm_zeker, s.osm_uitleg,
                              s.bgt, s.bgt_uitleg, s.bgt_bron, s.bgt_aandeel, s.eind, s.twijfel, s.twijfel_tekst))
    return Analyse(traject, xy, stukken, samen, afstand, bgt_gebruikt, dubbel_aandeel(xy))


# ---------------------------------------------------------------------------
# Plannen: punt-naar-punt (met BGT-ronde) en rondje
# ---------------------------------------------------------------------------

def _zelfde(a: Traject, b: Traject) -> bool:
    return len(a.coords) == len(b.coords) and all(p[:2] == q[:2] for p, q in zip(a.coords, b.coords))


def plan_route(punten: list, br: BRouter, bgt: Bgt | None, alternatieven: int) -> tuple:
    """Plan van punt naar punt. Geeft (traject, logregels voor het rapport).

    Ronde 1: BRouter met alleen OSM-kennis (alternatief 0).
    Ronde 2: per deeltraject leggen we de alternatieven 0..n-1 van BRouter
    langs de BGT en rekenen we de routekosten opnieuw uit met de ondergrond
    van het eindoordeel. Het alternatief met de laagste kosten wint. Zo worden
    stukken die volgens de BGT verhard zijn ontmoedigd, en blijft een
    eventuele LAW-voorkeur (--law) meetellen.
    """
    gekozen, log = [], []
    for nr, (a, b) in enumerate(zip(punten, punten[1:]), 1):
        opties = [(0, br.route([a, b], 0))]  # een fout hier is fataal: zonder route geen rapport
        for i in range(1, alternatieven if bgt is not None else 1):
            try:
                t = br.route([a, b], i)
            except BronFout as e:
                waarschuw(f"alternatief {i} voor deel {nr} niet beschikbaar ({e.melding})")
                continue
            if not any(_zelfde(t, o[1]) for o in opties):
                opties.append((i, t))
        if bgt is None:
            gekozen.append(opties[0][1])
            continue
        scores = []
        for i, t in opties:
            an = analyseer(t, bgt)
            scores.append(dict(deel=nr, alt=i, km=an.lengte / 1000, osm=an.zacht("osm"), eind=an.zacht("eind"),
                               law=an.law(), kosten=an.kosten(br.law), gekozen=False, bgt=an.bgt_gebruikt,
                               traject=t))
        # zonder BGT-gegevens heeft ronde 2 geen zin: houd alternatief 0
        beste = min(scores, key=lambda s: s["kosten"]) if scores[0]["bgt"] else scores[0]
        beste["gekozen"] = True
        gekozen.append(beste.pop("traject"))
        for sc in scores:
            sc.pop("traject", None)
            log.append(sc)
    traject = plak(gekozen)
    traject.punten = list(punten)
    return traject, log


def _verplaats(punt_xy: tuple, peiling: float, afstand: float) -> tuple:
    """Punt op 'afstand' meter in kompasrichting 'peiling' (graden)."""
    h = math.radians(peiling)
    return punt_xy[0] + afstand * math.sin(h), punt_xy[1] + afstand * math.cos(h)


def plan_rondje(start: tuple, km: float, br: BRouter, bgt: Bgt | None, kandidaten: int, bgt_top: int) -> tuple:
    """Plan een rondje van ongeveer km kilometer vanaf start.

    Voor elke windrichting leggen we een cirkel door het startpunt en zetten we
    drie tussenpunten op die cirkel. De straal wordt bijgesteld tot de lengte
    klopt. Binnen +-10% kiest de BGT de meest onverharde kandidaat; stukken die
    heen en terug over hetzelfde pad gaan tellen als minpunt.
    """
    doel = km * 1000.0
    sx, sy = _NAAR_RD.transform(start[1], start[0])
    lijst, log = [], []
    for n in range(kandidaten):
        peiling = 360.0 * n / kandidaten
        straal = doel / (4 * math.sqrt(2) * 1.3)  # vierkant in de cirkel, 30% omweg t.o.v. hemelsbreed
        beste, fout = None, None
        for _ronde in range(4):
            midden = _verplaats((sx, sy), peiling, straal)
            via = [_verplaats(midden, peiling + 180 + hoek, straal) for hoek in (90, 180, 270)]
            lonlat = [_NAAR_WGS.transform(x, y) for x, y in via]
            punten = [start] + [(lat, lon) for lon, lat in lonlat] + [start]
            try:
                t = br.route(punten, 0)
            except BronFout as e:
                fout = e.melding
                break
            lengte = t.lengte()
            if beste is None or abs(lengte - doel) < abs(beste[1] - doel):
                beste = (t, lengte, punten)
            if abs(lengte - doel) / doel <= 0.04:
                break
            straal *= max(0.5, min(2.0, doel / lengte))
        if beste is None:
            log.append(dict(richting=peiling, fout=fout or "geen route"))
            continue
        t, lengte, punten = beste
        t.punten = punten
        an = analyseer(t, None)
        lijst.append(dict(richting=peiling, km=lengte / 1000, osm=an.zacht("osm"), dubbel=an.dubbel,
                          binnen=abs(lengte - doel) / doel <= 0.10, traject=t, eind=None, gekozen=False))
    if not lijst:
        raise BronFout("BRouter", "geen enkel rondje gevonden: " + "; ".join(str(l.get("fout")) for l in log))

    def score(k, bron):
        return k[bron] - 0.5 * k["dubbel"]

    goed = [k for k in lijst if k["binnen"]]
    if not goed:
        dichtst = min(lijst, key=lambda k: abs(k["km"] - km))
        waarschuw(f"geen kandidaat binnen 10% van {nl(km, 1)} km; de dichtstbijzijnde is {nl(dichtst['km'])} km")
        goed = [dichtst]
    goed.sort(key=lambda k: score(k, "osm"), reverse=True)
    top = goed[:max(1, bgt_top)]
    if bgt is not None:
        for k in top:
            an = analyseer(k["traject"], bgt)
            k["eind"] = an.zacht("eind") if an.bgt_gebruikt else None
    bruikbaar = [k for k in top if k["eind"] is not None]
    winnaar = max(bruikbaar, key=lambda k: score(k, "eind")) if bruikbaar else top[0]
    winnaar["gekozen"] = True
    traject = winnaar["traject"]
    for k in lijst:
        k.pop("traject")
        log.append(k)
    log.sort(key=lambda k: k["richting"])
    return traject, log


# ---------------------------------------------------------------------------
# Bron 3: luchtfoto (PDOK WMS)
# ---------------------------------------------------------------------------

def luchtfoto_laag(web: Web) -> str:
    """Lees GetCapabilities en kies de actuele laag met hoge resolutie (+-8 cm)."""
    sleutel = "capabilities"
    data = web.cache_lees("luchtfoto", sleutel, "xml", TTL_BGT)
    if not data:
        r = web.vraag("PDOK luchtfoto", "GET", LUCHTFOTO_WMS,
                      params={"service": "WMS", "request": "GetCapabilities"}, timeout=60)
        if r.status_code != 200:
            raise BronFout("PDOK luchtfoto", f"GetCapabilities: HTTP {r.status_code}")
        data = r.content
        web.cache_schrijf("luchtfoto", sleutel, "xml", data)
    try:
        wortel = ElementTree.fromstring(data)
    except ElementTree.ParseError as e:
        raise BronFout("PDOK luchtfoto", f"GetCapabilities onleesbaar ({e})")
    namen = [el.text for el in wortel.iter() if el.tag.endswith("}Name") and el.text]
    if "Actueel_orthoHR" in namen:
        return "Actueel_orthoHR"
    hr = sorted(n for n in namen if n.endswith("_orthoHR"))
    if hr:
        return hr[-1]
    if "Actueel_ortho25" in namen:
        return "Actueel_ortho25"
    raise BronFout("PDOK luchtfoto", "geen bruikbare laag gevonden in GetCapabilities")


def kleur_indicatie(beeld, masker) -> tuple:
    """Grove kleurmaat van de strook onder de routelijn. Een indicatie, geen meting."""
    from PIL import ImageFilter, ImageStat
    stat = ImageStat.Stat(beeld, masker)
    if not stat.count or stat.count[0] < 30:
        return "te weinig beeld", {}
    r, g, b = stat.mean
    helder = (r + g + b) / 3
    verzadiging = (max(r, g, b) - min(r, g, b)) / max(1.0, max(r, g, b))
    groen = g - (r + b) / 2
    # textuur: hoe sterk wijkt elke pixel af van zijn omgeving (egaal asfalt = laag)
    grijs = beeld.convert("L")
    from PIL import ImageChops
    verschil = ImageChops.difference(grijs, grijs.filter(ImageFilter.GaussianBlur(4)))
    textuur = ImageStat.Stat(verschil, masker).mean[0]
    maten = dict(r=round(r), g=round(g), b=round(b), helder=round(helder),
                 verzadiging=round(verzadiging, 2), groen=round(groen / max(1.0, helder), 3),
                 textuur=round(textuur, 1))
    # Drempels zijn afgesteld op stukken waar OSM en BGT het eens zijn (winterbeeld,
    # lage zon). Bewust voorzichtig: bij twijfel geven we geen richting.
    steun = None
    if helder < 75:
        tekst = "donker (schaduw of bomen): niet te beoordelen"
    elif maten["groen"] >= 0.07 and g > b and g >= r - 2:
        tekst, steun = "groenig: wijst op begroeiing (gras), dus onverhard", "zacht"
    elif maten["groen"] <= 0.02 and verzadiging <= 0.10:
        soort = "grijs en egaal" if textuur < 4 else "grijs"
        tekst, steun = f"{soort}: wijst op verharding", "hard"
    elif r - b >= 18:
        tekst = "warm getint: zand, aarde of klinkers (geen richting)"
    else:
        tekst = "geen duidelijk kleursignaal"
    maten["steun"] = steun
    return tekst, maten


def maak_luchtfotos(web: Web, analyse: Analyse, genummerd: list, map_uit: Path, meters: float,
                    pixels: int = 1000) -> int:
    """Sla per twijfelstuk een luchtfoto-uitsnede op met de route erop getekend.

    genummerd is een lijst (nummer, stuk); het nummer is dat uit de twijfellijst.
    """
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        raise BronFout("luchtfoto", "Pillow ontbreekt (pip install pillow); uitsnedes overgeslagen")
    laag = luchtfoto_laag(web)
    map_uit.mkdir(parents=True, exist_ok=True)
    route = LineString(analyse.xy)
    try:
        font = ImageFont.load_default(size=20)
        klein = ImageFont.load_default(size=16)
    except TypeError:  # oudere Pillow
        font = klein = ImageFont.load_default()
    gemaakt = 0
    for nr, s in genummerd:
        mx, my = s.midden_xy()
        h = meters / 2
        bb = (round(mx - h, 1), round(my - h, 1), round(mx + h, 1), round(my + h, 1))
        sleutel = f"{laag}|{bb}|{pixels}"
        data = web.cache_lees("luchtfoto", sleutel, "img", TTL_LUCHTFOTO)
        if not data:
            r = web.vraag("PDOK luchtfoto", "GET", LUCHTFOTO_WMS, timeout=60, params={
                "service": "WMS", "version": "1.3.0", "request": "GetMap", "layers": laag, "styles": "",
                "crs": "EPSG:28992", "bbox": ",".join(str(v) for v in bb),
                "width": pixels, "height": pixels, "format": "image/jpeg"})
            if r.status_code != 200 or not r.headers.get("content-type", "").startswith("image/"):
                raise BronFout("PDOK luchtfoto", f"GetMap: HTTP {r.status_code}: {r.text[:200].strip()}")
            data = r.content
            web.cache_schrijf("luchtfoto", sleutel, "img", data)
        try:
            foto = Image.open(io.BytesIO(data)).convert("RGB")
        except Exception as e:
            raise BronFout("PDOK luchtfoto", f"afbeelding onleesbaar ({e})")
        schaal = pixels / meters

        def px(p):
            return (p[0] - bb[0]) * schaal, (bb[3] - p[1]) * schaal

        # kleurmaat: strook van 2 m breed onder de lijn van dit stuk
        masker = Image.new("L", foto.size, 0)
        ImageDraw.Draw(masker).line([px(p) for p in s.xy], fill=255, width=max(2, round(2 * schaal)))
        s.indicatie, maten = kleur_indicatie(foto, masker)
        if maten.get("steun") and s.twijfel == "conflict":
            s.indicatie += f" (past bij {'OSM' if groep(s.osm) == maten['steun'] else 'de BGT'})"

        # route tekenen als twee randlijnen, zodat de ondergrond zichtbaar blijft
        teken = ImageDraw.Draw(foto)

        def omlijn(lijn, kleur, dikte):
            vorm = lijn.intersection(box(*bb).buffer(10)).buffer(3.0, cap_style="flat")
            for poly in getattr(vorm, "geoms", [vorm]):
                if poly.is_empty or poly.geom_type != "Polygon":
                    continue
                teken.line([px(p) for p in poly.exterior.coords], fill=kleur, width=dikte)

        omlijn(route, (255, 255, 255), 2)
        omlijn(LineString(s.xy), (255, 0, 200), 4)
        # schaalbalk 20 m
        x0, y0 = 20, pixels - 24
        teken.rectangle([x0 - 6, y0 - 26, x0 + 20 * schaal + 6, y0 + 10], fill=(255, 255, 255))
        teken.line([(x0, y0), (x0 + 20 * schaal, y0)], fill=(0, 0, 0), width=4)
        teken.text((x0, y0 - 24), "20 m", fill=(0, 0, 0), font=klein)

        regels = [
            f"Twijfelstuk {nr}: km {nl(s.van / 1000)}-{nl(s.tot / 1000)} ({round(s.lengte)} m)   noorden boven",
            f"OSM: {s.osm} ({s.osm_uitleg})",
            f"BGT: {s.bgt} ({s.bgt_uitleg})",
            f"Kleurindicatie (geen meting): {s.indicatie}",
            f"Roze = dit stuk, wit = rest van de route. Bron: PDOK luchtfoto {laag}, {round(meters)} x {round(meters)} m",
        ]
        doek = Image.new("RGB", (pixels, pixels + 28 * len(regels) + 14), (255, 255, 255))
        doek.paste(foto, (0, 0))
        tekstteken = ImageDraw.Draw(doek)
        for i, regel in enumerate(regels):
            tekstteken.text((12, pixels + 8 + 28 * i), regel[:110], fill=(20, 20, 20), font=font)
        naam = f"twijfel_{nr:02d}.png"
        doek.save(map_uit / naam, optimize=True)
        s.foto = f"{map_uit.name}/{naam}"
        gemaakt += 1
    return gemaakt


# ---------------------------------------------------------------------------
# Uitvoer: GPX, HTML en terminal
# ---------------------------------------------------------------------------

def schrijf_gpx(pad: Path, traject: Traject, naam: str) -> None:
    regels = ['<?xml version="1.0" encoding="UTF-8"?>',
              f'<gpx version="1.1" creator="{USER_AGENT}" xmlns="http://www.topografix.com/GPX/1/1">',
              f"  <metadata><name>{xml_escape(naam)}</name>"
              f"<time>{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}</time></metadata>"]
    for i, (lat, lon) in enumerate(traject.punten):
        label = "Start" if i == 0 else ("Finish" if i == len(traject.punten) - 1 else f"Via {i}")
        regels.append(f'  <wpt lat="{lat:.6f}" lon="{lon:.6f}"><name>{label}</name></wpt>')
    regels.append(f"  <trk><name>{xml_escape(naam)}</name><trkseg>")
    for lon, lat, hoogte in traject.coords:
        ele = f"<ele>{hoogte:.1f}</ele>" if hoogte is not None else ""
        regels.append(f'    <trkpt lat="{lat:.6f}" lon="{lon:.6f}">{ele}</trkpt>')
    regels.append("  </trkseg></trk>")
    regels.append("</gpx>")
    pad.write_text("\n".join(regels) + "\n", encoding="utf-8")


def tabel_data(analyse: Analyse) -> list:
    rijen = []
    for k in KLASSEN:
        rij = {"klasse": k}
        for bron in ("osm", "bgt", "eind"):
            m = analyse.km(bron)[k]
            rij[bron] = {"km": round(m / 1000, 3), "pct": round(100 * m / analyse.lengte, 1) if analyse.lengte else 0}
        rijen.append(rij)
    return rijen


def rapport_data(analyse: Analyse, twijfels: list, meta: dict) -> dict:
    """Alles wat het HTML-rapport (en --json) nodig heeft."""
    def latlon(xy):
        lons, lats = _NAAR_WGS.transform([p[0] for p in xy], [p[1] for p in xy])
        return [[round(la, 6), round(lo, 6)] for lo, la in zip(lons, lats)]

    nummers = {id(s): i for i, s in enumerate(twijfels, 1)}
    stukken = []
    for s in analyse.samengevoegd:
        stukken.append({
            "lijn": latlon(s.xy), "van": round(s.van), "tot": round(s.tot),
            "osm": s.osm, "osm_zeker": s.osm_zeker, "osm_uitleg": s.osm_uitleg, "tags": s.tags[:4],
            "bgt": s.bgt, "bgt_uitleg": s.bgt_uitleg, "bgt_bron": s.bgt_bron, "eind": s.eind,
            "twijfel": s.twijfel, "twijfel_tekst": s.twijfel_tekst, "nr": nummers.get(id(s), 0),
            "foto": s.foto, "indicatie": s.indicatie,
        })
    lijst = []
    for s in twijfels:
        lon, lat = _NAAR_WGS.transform(*s.midden_xy())
        lijst.append({"nr": nummers[id(s)], "van": round(s.van), "tot": round(s.tot), "lengte": round(s.lengte),
                      "lat": round(lat, 6), "lon": round(lon, 6), "osm": s.osm, "bgt": s.bgt, "eind": s.eind,
                      "soort": s.twijfel, "tekst": s.twijfel_tekst, "foto": s.foto, "indicatie": s.indicatie})
    kort = [s for s in analyse.samengevoegd if s.twijfel and id(s) not in nummers]
    return {
        "meta": meta,
        "lengte_km": round(analyse.lengte / 1000, 3),
        "zacht_pct": {b: round(100 * analyse.zacht(b), 1) for b in ("osm", "bgt", "eind")},
        "dubbel_pct": round(100 * analyse.dubbel, 1),
        "law_pct": round(100 * analyse.law(), 1),
        "zachte_stukken": [
            dict(van=round(van), tot=round(tot), klassen=klassen,
                 **dict(zip(("lon", "lat"), (round(v, 6) for v in _NAAR_WGS.transform(x, y)))))
            for van, tot, x, y, klassen in analyse.zachte_stukken()],
        "bgt_gebruikt": analyse.bgt_gebruikt,
        "tabel": tabel_data(analyse),
        "stukken": stukken,
        "twijfels": lijst,
        "twijfel_kort": {"aantal": len(kort), "meter": round(sum(s.lengte for s in kort))},
        "punten": [[lat, lon] for lat, lon in analyse.traject.punten],
    }


def schrijf_html(pad: Path, data: dict) -> None:
    sjabloon = (Path(__file__).with_name("rapport_sjabloon.html")).read_text(encoding="utf-8")
    json_tekst = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    pad.write_text(sjabloon.replace("__TITEL__", html.escape(data["meta"]["naam"]))
                   .replace("/*__DATA__*/null", json_tekst), encoding="utf-8")


def toon_samenvatting(analyse: Analyse, twijfels: list, data: dict) -> None:
    meld()
    meld(f"Totale afstand: {nl(analyse.lengte / 1000)} km")
    meld()
    meld(f"{'Ondergrond':<22}{'OSM':>16}{'BGT':>18}{'Eindoordeel':>18}")
    for rij in data["tabel"]:
        cellen = "".join(f"{nl(rij[b]['km']):>8} km {nl(rij[b]['pct'], 1):>5}%" for b in ("osm", "bgt", "eind"))
        meld(f"{rij['klasse']:<22}{cellen}")
    z = data["zacht_pct"]
    meld(f"{'zacht (onv. + half)':<22}" + "".join(f"{'':>11}{nl(z[b], 1):>6}%" for b in ("osm", "bgt", "eind")))
    aanname = sum(s.lengte for s in analyse.stukken if not s.osm_zeker and s.osm != ONBEKEND)
    meld(f"  OSM: waarvan {nl(aanname / 1000)} km een aanname is (geen surface-tag).")
    if not analyse.bgt_gebruikt:
        meld("  BGT: niet beschikbaar; het eindoordeel is alleen op OSM gebaseerd.")
    else:
        terrein = sum(s.lengte for s in analyse.stukken if s.bgt_bron == "terrein")
        meld(f"  BGT: waarvan {nl(terrein / 1000)} km zonder geregistreerd pad (oordeel uit het terreinvlak).")
    meld("  Eindoordeel: BGT als die iets weet, anders OSM.")
    meld(f"  Over een LAW (landelijke wandelroute): {nl(data['law_pct'], 1)}% van de route.")
    if analyse.dubbel > 0.02:
        meld(f"  Heen en terug over hetzelfde pad: ongeveer {nl(100 * analyse.dubbel, 0)}% van de route.")
    meld()
    if data["zachte_stukken"]:
        meld("Langste zachte stukken (eindoordeel):")
        for z in data["zachte_stukken"]:
            meld(f"  km {nl(z['van'] / 1000)}-{nl(z['tot'] / 1000)} ({nl((z['tot'] - z['van']) / 1000)} km) "
                 f"{' + '.join(z['klassen'])}, midden bij {z['lat']:.5f},{z['lon']:.5f}")
        meld()
    if not twijfels:
        meld("Twijfelstukken: geen.")
    else:
        meld(f"Twijfelstukken ({len(twijfels)}, samen {nl(sum(s.lengte for s in twijfels) / 1000)} km):")
        for t in data["twijfels"]:
            meld(f"  #{t['nr']:<2} km {nl(t['van'] / 1000)}-{nl(t['tot'] / 1000)} ({t['lengte']} m) "
                 f"bij {t['lat']:.5f},{t['lon']:.5f}")
            meld(f"      {t['tekst']}")
            meld(f"      eindoordeel: {t['eind']}" + (f" | luchtfoto (indicatie): {t['indicatie']}" if t["indicatie"] else "")
                 + (f" -> {t['foto']}" if t["foto"] else ""))
    kort = data["twijfel_kort"]
    if kort["aantal"]:
        woord = "kort twijfelstukje" if kort["aantal"] == 1 else "korte twijfelstukjes"
        meld(f"  (+ {kort['aantal']} {woord}, samen {kort['meter']} m, niet apart genoemd)")


def toon_planlog(log: list, rondje: bool) -> None:
    if not log:
        return
    meld()
    if rondje:
        meld("Kandidaten voor het rondje (zacht = onverhard + half verhard):")
        meld(f"  {'richting':>8} {'km':>7} {'zacht OSM':>10} {'zacht BGT':>10} {'dubbel':>7}")
        for k in log:
            if "fout" in k:
                meld(f"  {round(k['richting']):>7}°  mislukt: {k['fout']}")
                continue
            eind = f"{nl(100 * k['eind'], 1)}%" if k["eind"] is not None else "-"
            vlag = " <- gekozen" if k["gekozen"] else ("" if k["binnen"] else "  (buiten 10%)")
            meld(f"  {round(k['richting']):>7}° {nl(k['km']):>7} {nl(100 * k['osm'], 1):>9}% {eind:>10} "
                 f"{nl(100 * k['dubbel'], 0):>6}%{vlag}")
    else:
        meld("Ronde 2 - BRouter-alternatieven langs de BGT gelegd")
        meld("  (zacht = onverhard + half verhard; kosten = gewogen km met de BGT-ondergrond, laagste wint):")
        meld(f"  {'deel':>4} {'alt':>4} {'km':>7} {'zacht OSM':>10} {'zacht eind':>11} {'LAW':>7} {'kosten':>8}")
        for k in log:
            meld(f"  {k['deel']:>4} {k['alt']:>4} {nl(k['km']):>7} {nl(100 * k['osm'], 1):>9}% "
                 f"{nl(100 * k['eind'], 1):>10}% {nl(100 * k['law'], 0):>6}% {nl(k['kosten'], 1):>8}"
                 f"{' <- gekozen' if k['gekozen'] else ''}")


# ---------------------------------------------------------------------------
# Hoofdprogramma
# ---------------------------------------------------------------------------

def lees_punt(tekst: str) -> tuple:
    try:
        lat, lon = (float(d) for d in tekst.replace(";", ",").split(","))
    except ValueError:
        raise argparse.ArgumentTypeError(f"'{tekst}' is geen \"lat,lon\"")
    if not (50.5 <= lat <= 53.8 and 3.0 <= lon <= 7.4):
        if 50.5 <= lon <= 53.8 and 3.0 <= lat <= 7.4:
            raise argparse.ArgumentTypeError(f"'{tekst}': lat en lon lijken omgedraaid (verwacht \"lat,lon\")")
        raise argparse.ArgumentTypeError(f"'{tekst}' ligt buiten Nederland")
    return lat, lon


def maak_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Plan hardlooproutes met zo veel mogelijk onverharde ondergrond (Nederland).",
        epilog='Voorbeeld: python onverhard.py "51.9921,4.3481" "51.9255,4.4679" -o route')
    p.add_argument("punten", nargs="+", type=lees_punt, metavar='"lat,lon"',
                   help="start, eventuele tussenpunten en eind (bij --rondje: alleen de start)")
    p.add_argument("-o", "--uit", default="route", help="voorvoegsel van de uitvoerbestanden (standaard: route)")
    p.add_argument("--rondje", type=float, metavar="KM", help="plan een rondje van ongeveer KM km vanaf het startpunt")
    p.add_argument("--law", type=float, default=1.0, metavar="FACTOR",
                   help="kostenfactor voor LAW-paden: 1.0 = geen voorkeur, 0.3 = sterke voorkeur")
    p.add_argument("--alternatieven", type=int, default=4, metavar="N",
                   help="aantal BRouter-alternatieven per deeltraject dat langs de BGT gelegd wordt (1 = uit)")
    p.add_argument("--kandidaten", type=int, default=8, metavar="N", help="aantal richtingen voor --rondje")
    p.add_argument("--bgt-kandidaten", type=int, default=3, metavar="N",
                   help="zoveel rondjes worden langs de BGT gelegd (de beste volgens OSM)")
    p.add_argument("--geen-bgt", action="store_true", help="sla de BGT-controle over (alleen OSM)")
    p.add_argument("--geen-luchtfoto", action="store_true", help="maak geen luchtfoto-uitsnedes")
    p.add_argument("--max-luchtfotos", type=int, default=12, metavar="N",
                   help="hooguit zoveel uitsnedes (de langste twijfelstukken eerst)")
    p.add_argument("--luchtfoto-meter", type=float, default=120.0, metavar="M", help="zijde van de uitsnede in meters")
    p.add_argument("--min-twijfel", type=float, default=30.0, metavar="M",
                   help="twijfelstukken korter dan dit worden niet apart genoemd")
    p.add_argument("--snap", type=float, default=SNAP_M, metavar="M",
                   help="ligt de lijn zo dicht bij een BGT-wegdeel, dan telt dat wegdeel")
    p.add_argument("--json", action="store_true", help="schrijf ook <uit>.json met alle cijfers")
    p.add_argument("--cache", default=str(Path(__file__).resolve().parent / "cache"), metavar="MAP",
                   help="map voor de cache van API-antwoorden")
    p.add_argument("--geen-cache", action="store_true", help="gebruik geen cache")
    p.add_argument("--ververs", action="store_true", help="negeer bestaande cache en haal alles opnieuw op")
    return p


def main(argv=None) -> int:
    args = maak_parser().parse_args(argv)
    if args.rondje is not None and len(args.punten) != 1:
        print("Fout: geef bij --rondje precies een startpunt op.", file=sys.stderr)
        return 2
    if args.rondje is None and len(args.punten) < 2:
        print("Fout: geef minstens een start- en een eindpunt op (of gebruik --rondje KM).", file=sys.stderr)
        return 2
    if args.rondje is not None and not 1 <= args.rondje <= 100:
        print("Fout: --rondje moet tussen 1 en 100 km liggen.", file=sys.stderr)
        return 2
    uit = Path(args.uit)
    if uit.parent != Path("."):
        uit.parent.mkdir(parents=True, exist_ok=True)
    naam = uit.name
    web = Web(None if args.geen_cache else Path(args.cache), ververs=args.ververs)
    try:
        br = BRouter(web, args.law)
    except ValueError as e:
        print(f"Fout: {e}", file=sys.stderr)
        return 2
    bgt = None if args.geen_bgt else Bgt(web, snap=args.snap)
    gelukt, mislukt = [], []

    # 1. route plannen ------------------------------------------------------
    try:
        if args.rondje is not None:
            meld(f"Rondje van ongeveer {nl(args.rondje, 1)} km plannen (BRouter, {args.kandidaten} richtingen)...")
            traject, log = plan_rondje(args.punten[0], args.rondje, br, bgt, args.kandidaten, args.bgt_kandidaten)
        else:
            meld(f"Route plannen langs {len(args.punten)} punten (BRouter, LAW-factor {args.law})...")
            traject, log = plan_route(args.punten, br, bgt, max(1, args.alternatieven))
    except BronFout as e:
        print(f"\nFOUT bij {e.bron}: {e.melding}", file=sys.stderr)
        print("Er is geen route gemaakt, dus ook geen GPX of rapport.", file=sys.stderr)
        return 1

    gpx_pad = uit.with_name(naam + ".gpx")
    schrijf_gpx(gpx_pad, traject, naam)
    gelukt.append(f"{gpx_pad} (route)")

    # 2. ondergrond bepalen -------------------------------------------------
    analyse = analyseer(traject, bgt)
    if bgt is not None:
        if bgt.fouten:
            telling = Counter(bgt.fouten).most_common(1)[0]
            mislukt.append(f"PDOK BGT: {len(bgt.fouten)} van {bgt.verzoeken} verzoeken mislukt "
                           f"(bv. {telling[0]}); die stukken staan als 'onbekend' in de BGT-kolom"
                           + (" en ronde 2 is overgeslagen" if bgt.onbereikbaar else ""))
        if bgt.buiten_bbox:
            waarschuw(f"{bgt.buiten_bbox} BGT-vlakken lagen buiten de gevraagde bbox en zijn genegeerd")
        if analyse.bgt_gebruikt:
            gelukt.append(f"BGT-controle ({len(bgt.lijst)} vlakken langs de route)")
    twijfels = analyse.twijfels(args.min_twijfel)

    # 3. luchtfoto's --------------------------------------------------------
    foto_map = uit.with_name(naam + "_luchtfoto")
    if twijfels and not args.geen_luchtfoto and args.max_luchtfotos > 0:
        nummers = {id(s): i for i, s in enumerate(twijfels, 1)}  # zelfde nummer als in de lijst
        selectie = sorted(twijfels, key=lambda s: -s.lengte)[:args.max_luchtfotos]
        selectie.sort(key=lambda s: s.van)
        try:
            n = maak_luchtfotos(web, analyse, [(nummers[id(s)], s) for s in selectie], foto_map,
                                args.luchtfoto_meter)
            gelukt.append(f"{foto_map}/ ({n} luchtfoto-uitsnedes)")
        except BronFout as e:
            mislukt.append(f"{e.bron}: {e.melding}")

    # 4. rapport ------------------------------------------------------------
    meta = {
        "naam": naam, "gemaakt": datetime.now().strftime("%Y-%m-%d %H:%M"), "law": args.law,
        "rondje_km": args.rondje, "versie": VERSIE, "min_twijfel": args.min_twijfel,
        "planlog": log,
    }
    data = rapport_data(analyse, twijfels, meta)
    html_pad = uit.with_name(naam + ".html")
    try:
        schrijf_html(html_pad, data)
        gelukt.append(f"{html_pad} (kaart en tabel)")
    except OSError as e:
        mislukt.append(f"HTML-rapport niet geschreven: {e}")
    if args.json:
        json_pad = uit.with_name(naam + ".json")
        slank = dict(data, stukken=[{k: v for k, v in s.items() if k != "lijn"} for s in data["stukken"]])
        json_pad.write_text(json.dumps(slank, ensure_ascii=False, indent=1), encoding="utf-8")
        gelukt.append(f"{json_pad} (cijfers)")

    toon_planlog(log, args.rondje is not None)
    toon_samenvatting(analyse, twijfels, data)
    meld()
    meld("Gelukt:")
    for g in gelukt:
        meld(f"  - {g}")
    if mislukt:
        meld("Niet (helemaal) gelukt:")
        for m in mislukt:
            meld(f"  - {m}")
    meld(f"({web.teller['net']} API-verzoeken, {web.teller['cache']} antwoorden uit de cache)")
    return 0 if not mislukt else 3


if __name__ == "__main__":
    sys.exit(main())
