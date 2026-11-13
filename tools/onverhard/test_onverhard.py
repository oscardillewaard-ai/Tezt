"""Offline tests voor de rekenkern van onverhard.py (geen netwerk nodig).

Draaien:  python -m pytest test_onverhard.py -q
"""
import math

import pytest
from shapely.geometry import box

import onverhard as o


def test_profiel_bevat_law_factor_en_geen_verboden_waarden():
    p = o.maak_profiel(0.3)
    assert "multiply base 3.3333" in p and "NIETLAW" not in p
    assert "multiply base 1.0000" in o.maak_profiel(1.0)
    for verboden in ("woodchips", "pebblestone", "mud", "concrete:plates", "metal", "wood", "min("):
        assert verboden not in p  # deze breken het profiel bij BRouter
    with pytest.raises(ValueError):
        o.maak_profiel(0)


@pytest.mark.parametrize("tags,klasse,zeker", [
    ("highway=path surface=grass route_hiking_nwn=yes", o.ONVERHARD, True),
    ("highway=footway surface=fine_gravel", o.HALF, True),
    ("highway=residential surface=paving_stones", o.OPEN, True),
    ("highway=cycleway surface=asphalt", o.GESLOTEN, True),
    ("highway=path", o.ONVERHARD, False),
    ("highway=track tracktype=grade1", o.GESLOTEN, False),
    ("highway=track tracktype=grade2", o.HALF, False),
    ("highway=footway", o.ONBEKEND, False),
    ("highway=cycleway", o.GESLOTEN, False),
    ("highway=path surface=iets_geks", o.ONVERHARD, False),
    ("", o.ONBEKEND, False),
])
def test_osm_klasse(tags, klasse, zeker):
    k, z, _ = o.osm_klasse(tags)
    assert (k, z) == (klasse, zeker)


@pytest.mark.parametrize("collectie,fysiek,klasse", [
    ("wegdeel", "gesloten verharding", o.GESLOTEN),
    ("wegdeel", "open verharding", o.OPEN),
    ("wegdeel", "half verhard", o.HALF),
    ("wegdeel", "onverhard", o.ONVERHARD),
    ("wegdeel", "transitie", o.ONBEKEND),
    ("ondersteunendwegdeel", "groenvoorziening", o.ONVERHARD),
    ("onbegroeidterreindeel", "erf", o.ONBEKEND),
    ("onbegroeidterreindeel", "zand", o.ONVERHARD),
    ("begroeidterreindeel", "grasland agrarisch", o.ONVERHARD),
    ("begroeidterreindeel", "loofbos", o.ONVERHARD),
    ("begroeidterreindeel", "transitie", o.ONBEKEND),
    ("wegdeel", None, o.ONBEKEND),
])
def test_bgt_klasse(collectie, fysiek, klasse):
    assert o.bgt_klasse(collectie, fysiek) == klasse


def _feature():
    coords = [[4.0 + i * 0.001, 52.0, 1.0] for i in range(5)]
    kop = ["Longitude", "Latitude", "Elevation", "Distance", "WayTags"]
    rijen = [
        [str(round(coords[2][0] * 1e6)), "52000000", "1", "137", "reversedirection=yes highway=path surface=grass"],
        [str(round(coords[4][0] * 1e6)), "52000000", "1", "137", "highway=cycleway surface=asphalt"],
    ]
    return {"geometry": {"coordinates": coords}, "properties": {"messages": [kop] + rijen}}


def test_brouter_berichten_worden_stukken():
    t = o.lees_brouter_route(_feature())
    assert t.segs == [(0, 2, "highway=path surface=grass"), (2, 4, "highway=cycleway surface=asphalt")]
    assert t.lengte() == pytest.approx(274, abs=3)


def test_plak_verwijdert_dubbel_knooppunt():
    t = o.lees_brouter_route(_feature())
    twee = o.plak([t, o.Traject([t.coords[-1], (4.006, 52.0, 1.0)], [(0, 1, "highway=path")])])
    assert len(twee.coords) == 6
    assert twee.segs[-1] == (4, 5, "highway=path")


def _bgt_met(vlakken):
    b = o.Bgt(web=None)
    for collectie, fysiek, niveau, geom in vlakken:
        b.lijst.append(o.Vlak(collectie, fysiek, "", "voetpad" if collectie == "wegdeel" else "", niveau,
                              o.bgt_klasse(collectie, fysiek)))
        b.geoms.append(geom)
    return b


def test_bgt_zoek_wegdeel_snap_en_terrein():
    b = _bgt_met([
        ("wegdeel", "gesloten verharding", 0, box(0, 0, 100, 4)),      # asfaltpad
        ("begroeidterreindeel", "grasland overig", 0, box(0, 4, 100, 60)),
    ])
    op_pad, vlakbij, ver_weg, nergens = b.zoek([(50, 2), (50, 6), (50, 30), (500, 500)],
                                              [0, 0, 0, 0], [None, None, None, None])
    assert op_pad[0] == o.GESLOTEN and op_pad[2] == "wegdeel"
    assert vlakbij[0] == o.GESLOTEN and vlakbij[2] == "wegdeel-nabij"   # 2 m naast het pad: kaartverschuiving
    assert ver_weg[0] == o.ONVERHARD and ver_weg[2] == "terrein"       # geen pad geregistreerd
    assert nergens == (o.ONBEKEND, "geen BGT-vlak op deze plek", "geen")


def test_bgt_zoek_gebruikt_osm_bij_kaartverschuiving():
    b = _bgt_met([
        ("wegdeel", "gesloten verharding", 0, box(0, 0, 100, 4)),
        ("begroeidterreindeel", "grasland overig", 0, box(0, 4, 100, 60)),
    ])
    # OSM zegt expliciet gras: dan telt het grasvlak waar de lijn in ligt, niet de weg ernaast
    assert b.zoek([(50, 6)], [0], ["zacht"])[0][2] == "terrein"
    assert b.zoek([(50, 6)], [0], ["hard"])[0][2] == "wegdeel-nabij"


def test_bgt_zoek_brug_kiest_bovenste_niveau():
    b = _bgt_met([
        ("wegdeel", "onverhard", 0, box(0, 0, 100, 10)),               # pad onder de brug
        ("wegdeel", "gesloten verharding", 1, box(40, -20, 60, 30)),   # brug eroverheen
    ])
    assert b.zoek([(50, 5)], [0], [None])[0][0] == o.ONVERHARD
    assert b.zoek([(50, 5)], [1], [None])[0][0] == o.GESLOTEN


def test_corridor_bboxen_dekken_de_route():
    xy = [(83000 + i * 40, 443000 + i * 25) for i in range(60)]
    bboxen = o.Bgt.corridor_bboxen(xy)
    assert len(bboxen) > 1
    for x, y in xy:
        assert any(b[0] <= x - 10 and x + 10 <= b[2] and b[1] <= y - 10 and y + 10 <= b[3] for b in bboxen)
    assert max(b[2] - b[0] for b in bboxen) <= o.RASTER_M + 2 * o.CORRIDOR_M + 60


def test_analyse_zonder_bgt_en_met_bgt():
    t = o.lees_brouter_route(_feature())
    zonder = o.analyseer(t, None)
    assert zonder.lengte == pytest.approx(t.lengte())
    assert sum(zonder.km("osm").values()) == pytest.approx(zonder.lengte)
    assert zonder.zacht("osm") == pytest.approx(0.5, abs=0.01)
    assert not zonder.twijfels(10)        # surface-tags aanwezig, dus geen twijfel
    # BGT die overal 'gesloten verharding' zegt: het grasdeel wordt een conflict en de BGT wint
    xy = o.naar_rd(t.coords)
    xs, ys = [p[0] for p in xy], [p[1] for p in xy]
    b = _bgt_met([("wegdeel", "gesloten verharding", 0, box(min(xs) - 5, min(ys) - 5, max(xs) + 5, max(ys) + 5))])
    b.haal_corridor = lambda *_: None     # geen netwerk in de test
    met = o.analyseer(t, b)
    assert met.zacht("eind") == 0
    twijfels = met.twijfels(10)
    assert len(twijfels) == 1 and twijfels[0].twijfel == "conflict"
    assert twijfels[0].lengte == pytest.approx(137, abs=3)
    assert met.kosten(1.0) == pytest.approx((137 * 3 + 137 * 4) / 1000, rel=0.03)


def test_law_en_kostenfactor():
    assert o.is_law("highway=path route_hiking_nwn=yes")
    assert not o.is_law("highway=path route_hiking_rwn=yes")
    assert o.kostenfactor(o.ONVERHARD, "highway=primary") == 1.0
    assert o.kostenfactor(o.GESLOTEN, "highway=path") == 3.0
    assert o.kostenfactor(o.GESLOTEN, "highway=residential") == 4.0


def test_dubbel_aandeel():
    heen_en_terug = [(0, 0), (1000, 0), (0, 0)]
    cirkel = [(500 * math.cos(a / 50 * math.pi), 500 * math.sin(a / 50 * math.pi)) for a in range(101)]
    assert o.dubbel_aandeel(heen_en_terug) > 0.6
    assert o.dubbel_aandeel(cirkel) < 0.1


def test_kleur_indicatie_op_egale_vlakken():
    from PIL import Image
    masker = Image.new("L", (200, 200), 255)
    assert o.kleur_indicatie(Image.new("RGB", (200, 200), (95, 118, 80)), masker)[1]["steun"] == "zacht"
    assert o.kleur_indicatie(Image.new("RGB", (200, 200), (150, 148, 146)), masker)[1]["steun"] == "hard"
    assert o.kleur_indicatie(Image.new("RGB", (200, 200), (40, 45, 42)), masker)[1]["steun"] is None


def test_lees_punt():
    assert o.lees_punt("51.9921,4.3481") == (51.9921, 4.3481)
    with pytest.raises(Exception, match="omgedraaid"):
        o.lees_punt("4.3481,51.9921")
    with pytest.raises(Exception, match="buiten Nederland"):
        o.lees_punt("48.85,2.35")
