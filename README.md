# Bergtrainer

Upload de GPX van een ultrarace en de GPX van je lokale trainingsberg (bijv. je
skiberg), en Bergtrainer rekent uit hoeveel keer je die berg op moet om
dezelfde hoeveelheid hoogtemeters te trainen. Daarnaast genereert het een
wekelijks opbouwschema (met piek en taper) richting je wedstrijddatum.

## Hoe het werkt

1. **Ultrarace**: upload de GPX-track van de wedstrijd. De app berekent
   afstand en totale hoogtewinst (D+).
2. **Trainingsberg**: upload de GPX van één beklimming/ronde van je
   trainingsberg. Zelfde berekening, maar dan per ronde.
3. De app rekent uit hoeveel herhalingen van de berg nodig zijn om een
   gekozen percentage van de hoogtemeters van de wedstrijd te evenaren.
4. Vul optioneel een wedstrijddatum en aantal trainingen per week in voor een
   wekelijks schema dat opbouwt naar een piek (~110% van de wedstrijd-D+) en
   afbouwt in de laatste week(en) voor de wedstrijd.

Alles draait client-side; er wordt niets naar een server verstuurd. Opgeslagen
routes staan lokaal in de browser (`localStorage`).

## Ontwikkelen

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```
