# Branches-archief

Branches die bij de verhuizing naar nopaves (2026-11-20) zijn weggehaald of bewust zijn blijven
staan. Een weggehaalde branch is terug te halen met
`git push origin <sha>:refs/heads/<naam>` in de repository waar hij stond (de commits staan nog in
Tezt zolang ze ergens bereikbaar zijn; alle hieronder weggehaalde branches zijn voorouders van de
integratie `8f14bcd` op `claude/admiring-ritchie-23anos`, en hun Nopav.es-inhoud staat in de
geschiedenis van nopaves).

## Tezt: weggehaald (volledig in de integratie, alleen Nopav.es)

| Branch | SHA |
|---|---|
| `ccr-c02c1fc3-wix11n` | `92eabe6555f36051bbd6e04ead7737b0ccbb61e2` |
| `claude/unpaved-routes-planner-ufzrl8` | `d70beeede2725c7c88690220910544e42a008386` |
| `graaf-proef` | `ea114babfded59acb329a68bff08c3e5b2d92209` |
| `snelheid` | `7f1a72014bbfed9371d82a365abd16d5224f3608` |
| `terugzet/na-snelheid` | `7c885b55b65dc6eeac38ae063e4fb4de9a5e8943` |
| `terugzet/na-ux-1` | `6b5853e0d1322bc897fb1fb1b3ced83e2dfe66cd` |
| `terugzet/na-ux-2` | `b30230fd72e91c20c0493f2c1598d6d703555ff2` |
| `terugzet/na-ux-3` | `23b71b20410c446952180bd65d23f25533e4e3e8` |
| `terugzet/voor-graaf` | `7c885b55b65dc6eeac38ae063e4fb4de9a5e8943` |
| `terugzet/voor-ux` | `f58e0da48209ac1b324d7fc35f47bebeeb368d36` |
| `ux-fase-1` | `021edb7fa78c0ddd31fcef0df4834174cb371885` |
| `ux-fase-2` | `4ac66667ed9aaa109f060590b5fbd80a51c91214` |
| `ux-fase-3` | `64fe39c1ec319ae83292d00505d3a339a83b96f3` |

## Tezt: blijven staan

| Branch | SHA | Waarom |
|---|---|---|
| `claude/gpx-ultrarace-trainingen-zf6zci` | `07f22d4e25422e79a9dd66d735c24a1d2965e8f3` | Pages-branch van Tezt (andere projecten); laatste Nopav.es-versie daarop was `7c885b55b65dc6eeac38ae063e4fb4de9a5e8943` |
| `ccr-1c8830ae-uawyv2` | `24b5abc7a050a362260369350c0cb9327ff5950e` | **twijfel**: 9 Nopav.es-commits (UX fase 1, sessiewerk) die niet als zodanig in de integratie zitten; vermoedelijk vervangen door `ux-fase-1`, maar niet nagekeken |
| `claude/admiring-ritchie-23anos` | `8f14bcd96458a4f3b78b79ec4fef9c864ecb0871` | **twijfel**: sessiebranch van de verhuizing (integratie + stap A); alleen Nopav.es, mag weg als de verhuizing af is |
| `ccr-0f6cb907-g58ryk` | `ce43b2af67f0632a61a91163874894ab152442ad` | werk van andere projecten (Move Drie routes to its own repository) |
| `ccr-ba13ab79-5xw17b` | `20ff4a85e44aea7fe60229941dec8aaa287b7865` | werk van andere projecten (Tarapp: trash zone at the top while dragging, so S) |
| `ccr-dd7e09d5-7p41e5` | `b6925e3950dd501312ec8f1949c968ecbb26e6c5` | werk van andere projecten (Prikbord-docs verhuisd naar oscardillewaard-ai/pri) |
| `ccr-ff323ac5-1aq336` | `e122fe8593e55907c4105403a0360b1f4c1f2a76` | werk van andere projecten (Parkenjacht: use the deployed sync worker by defau) |
| `claude/trail-race-gpx-manifest-c1kxr9` | `3e14559dcb8cb3ab999858a278c15261d6829fea` | werk van andere projecten (Show GPX source reliability in the race picker; co) |
