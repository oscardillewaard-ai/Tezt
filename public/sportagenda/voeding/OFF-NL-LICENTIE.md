# off-nl.json: licentie en bron

`off-nl.json` is een afgeleide database van **Open Food Facts** (https://world.openfoodfacts.org): de producten
die in Nederland verkocht worden en een naam plus kcal, eiwit, koolhydraten en vet hebben. Per product alleen
barcode, naam, merk, kcal, eiwit, koolhydraten, vet, vezel, of het in ml is, en de portiegrootte.

- De database van Open Food Facts valt onder de **Open Database License (ODbL) 1.0**
  (https://opendatacommons.org/licenses/odbl/1-0/); de afzonderlijke inhoud onder de
  **Database Contents License (DbCL) 1.0** (https://opendatacommons.org/licenses/dbcl/1-0/).
- Deze afgeleide database valt daarom ook onder de **ODbL 1.0**. Je mag hem gebruiken, delen en aanpassen,
  zolang je de bron vermeldt en aanpassingen onder dezelfde licentie deelt.
- Bronvermelding in Tarapp: "Productgegevens: Open Food Facts (ODbL)".
- Gemaakt met `scripts/gen-voeding-off-nl.mjs` uit de dagelijkse export van Open Food Facts. De datum staat in
  het veld `gemaakt`.
- Weggelaten: producten zonder naam of zonder een van de vier waarden, en onmogelijke waarden
  (meer dan 950 kcal of meer dan 102 g macro's per 100 g). Verder ongewijzigd.
