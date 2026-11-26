# Voeding: wat Oscar nog moet doen

Vier stappen, één keer. Daarna gaat alles vanzelf. (Stap 5, NEVO, is al gedaan: NEVO-online 2025/9.0 zit erin.)

## 1. Cloudflare-token als repo-secret (eenmalig, ±3 minuten)

Hiermee zet GitHub de Worker voortaan zelf neer.

1. Ga naar **dash.cloudflare.com**, rechtsboven je profiel, **Profile**, **API Tokens**, **Create Token**.
2. Kies **Create Custom Token** (onderaan), naam bijvoorbeeld `tarapp-voeding deploy`.
3. **Permissions**, voeg deze toe:
   - Account · **Workers Scripts** · Edit
   - Account · **Workers KV Storage** · Edit
   - Account · **Account Settings** · Read
   - User · **Memberships** · Read
   - User · **User Details** · Read
4. **Account Resources**: Include, je eigen account. Tik **Continue to summary**, **Create Token** en kopieer de token.
5. Ga op GitHub naar de repo **Tezt**, **Settings**, **Secrets and variables**, **Actions**, **New repository secret**:
   naam `CLOUDFLARE_API_TOKEN`, plak de token, **Add secret**.
   (Heb je meer dan één Cloudflare-account? Voeg dan ook `CLOUDFLARE_ACCOUNT_ID` toe; die staat rechts op de
   overzichtspagina van je account.)

## 2. De pull request van Tezt samenvoegen

Tik op GitHub in de PR "Voeding in Tarapp" op **Merge**. Daarna gebeurt automatisch:

- GitHub Pages zet de nieuwe Tarapp (versie 37) online; geïnstalleerde apps halen hem vanzelf op.
- De workflow **voeding-worker** maakt de KV-opslag aan en zet de Worker neer.

Controle: open **https://tarapp-voeding.oscar-dillewaard.workers.dev**. Je ziet "✅ De worker draait" en "✅ De opslag
is gekoppeld". (Zette je het secret pas ná het samenvoegen? Ga dan naar **Actions**, **voeding-worker**, **Run
workflow**.)

## 3. De nieuwe HealthBridge-APK installeren

1. In de repo **healthbridge-data**: **Actions**, de laatste groene run van **healthbridge**, onderaan bij
   **Artifacts** `healthbridge-debug-apk` downloaden (pak de zip uit).
2. Open de APK op je telefoon. Hij installeert over de oude heen (zelfde sleutel); je instellingen blijven bewaard.

## 4. Koppelen (op je Android-telefoon, ±30 seconden)

1. Open **Tarapp**, tik onderin op **Voeding** en kies **Oscar**.
2. Tik op **Doelen en instellingen**, dan **Koppel met Healthbridge**, dan **Open Healthbridge**.
3. HealthBridge vraagt "Tarapp koppelen?": tik **Koppelen**. Klaar!

Optioneel: in HealthBridge, **Instellingen**, **Tarapp testen**. Vanaf de volgende run staat je voeding met gram per
product in `days/` (`"source": "tarapp"`).

## 5. NEVO bijwerken (✅ 2025/9.0 is gedaan; alleen weer nodig bij een nieuwe NEVO-versie)

Hiermee krijgt Voeding de Nederlandse NEVO-tabel (ruim 2300 producten). Het akkoord op de voorwaarden van RIVM moet
jij zelf geven; dat mocht ik niet namens jou doen.

1. Open **https://www.rivm.nl/form/nevo-online-gegevensbestand-2**, vink **Akkoord** aan en tik **Versturen**.
2. Download het **CSV-bestand** (NEVO-online 2025/9.0).
3. Stuur het mij in een Claude Code-sessie met beide repo's en zeg "maak NEVO". Ik draai dan
   `node scripts/gen-voeding-nevo.mjs <bestand>`, controleer het en zet het in een PR.
   (Zelf doen kan ook: dat commando in de map Tezt, daarna `npm run test:voeding`, committen en pushen.)

Voeding werkt ook zonder deze stap, met de USDA-basisproducten.

---

*Tara* hoeft niets te doen: zij opent Tarapp, tikt op Voeding en kiest Tara. Haar dagboek gaat niet naar Healthbridge.
