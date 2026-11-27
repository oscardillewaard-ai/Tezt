# Account (inloggen met Google): wat Oscar zelf moet doen

Eenmalig, ±10 minuten. Daarna staat "Meer → Account" in Tarapp aan. Je hebt al gedaan (of doet eerst):
stap 1 uit `docs/voeding-stappen-voor-oscar.md` (het Cloudflare-token), want de Worker regelt het inloggen.

## 1. Een Google-"client-ID" maken (±5 minuten)

1. Ga naar <https://console.cloud.google.com/> en log in met je eigen Google-account.
2. Bovenin: **Project kiezen → Nieuw project**, naam `Tarapp`, **Maken**. Kies daarna dat project.
3. Menu ☰ → **APIs en services → OAuth-toestemmingsscherm** (heet soms **Google Auth Platform**).
   Klik **Aan de slag**:
   - App-naam: `Tarapp`, e-mail voor ondersteuning: je eigen adres.
   - Doelgroep: **Extern**.
   - Contactgegevens: je eigen adres. Akkoord gaan met het beleid (dat doe jij, niet Claude) → **Maken**.
4. Onder **Doelgroep**: klik **App publiceren** (in productie zetten). Tarapp vraagt alleen naam en
   e-mailadres, daarvoor hoeft Google niets te controleren. Doe je dit niet, dan kan alleen wie je daar
   als "testgebruiker" toevoegt inloggen (dat mag ook, dan is het een extra slot op de deur).
5. Onder **Clients** → **Client maken**:
   - Type: **Webapplicatie**, naam: `Tarapp`.
   - **Geautoriseerde JavaScript-oorsprongen**, voeg toe:
     - `https://oscardillewaard-ai.github.io`
     - `http://localhost:4173` (alleen voor testen op een computer)
   - Omleidings-URI's: leeg laten.
   - **Maken**. Kopieer de **Client-ID** (eindigt op `.apps.googleusercontent.com`).
     Het "clientgeheim" heb je niet nodig.

## 2. Twee repo-secrets zetten (±2 minuten)

GitHub → repo **Tezt** → **Settings → Secrets and variables → Actions → New repository secret**:

| Naam | Waarde |
| --- | --- |
| `TARAPP_GOOGLE_CLIENT_ID` | de Client-ID uit stap 1 |
| `TARAPP_ADMIN_EMAILS` | jouw eigen Gmail-adres (meerdere kan, gescheiden door komma's) |

De beheerder mag altijd in en keurt de rest goed. Je e-mailadres staat zo alleen in de secrets, niet in
de openbare code.

## 3. De Worker opnieuw neerzetten

Gebeurt vanzelf bij het samenvoegen van de pull request. Al samengevoegd voordat je de secrets zette?
GitHub → **Actions → voeding-worker → Run workflow**. Die zet de secrets op de Worker en maakt één
keer de versleutelsleutel `DATA_KEY` aan (die staat alleen bij Cloudflare; niemand hoeft hem te zien).

> ⚠️ Gooi `DATA_KEY` bij Cloudflare nooit weg of vervang hem niet: dan zijn de opgeslagen
> accountgegevens onleesbaar. (Op je apparaten blijft alles gewoon staan.)

## 4. Inloggen en de rest toelaten

1. Tarapp → **Meer → Account → Inloggen met Google**. Jouw gegevens van deze telefoon gaan meteen
   naar je account (eerst wordt er een back-up gemaakt).
2. Op je laptop hetzelfde. Staat daar ook iets, dan kies je **Samenvoegen** of **Account gebruiken**.
3. Tara (of iemand anders) logt in → krijgt "Je aanvraag is verstuurd". Jij ziet bij
   **Meer → Account** "1 aanvraag" → **Goedkeuren**. Daarna kan diegene inloggen en ziet alleen
   de eigen gegevens. **Intrekken** werkt meteen, ook op apparaten waar diegene al ingelogd was.
