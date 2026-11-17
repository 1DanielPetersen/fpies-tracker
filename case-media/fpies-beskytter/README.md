# FPIES Beskytter: billeder og film

Billeder og en kort film af FPIES Beskytter til historien på entilen.dk. Alt er optaget fra den rigtige app (produktionsbuild) med opdigtede data mod Firebase-emulatorerne på projektet `demo-fpies`. Den rigtige Firebase og vores egne data er ikke rørt. Den samme opdigtede familie (kode K7Q2PX) går igen i alle filer.

## Filerne

| Fil | Format | Hvad den viser |
|---|---|---|
| `scan-resultat.png` | 1170 × 2532 | Scanneren lige efter et foto af en opdigtet snack-etiket: det røde kort "FARE REGISTRERET" med majsstivelse og maltodextrin på Forbudt-listen, sød kartoffel og gulerod som kendt sikre og en dansk forklaring, der også nævner den utestede kikærtemel. |
| `test-4-dage.png` | 1170 × 2532 | 4-Dages Test med Laks på dag 3 og Broccoli på dag 2, og nedenunder de seneste afsluttede tests: Havre fejlet til Forbudt og Blåbær godkendt til Sikker. |
| `madlister.png` | 1170 × 2532 | Madlister på Sikker Liste med de nyeste fødevarer øverst, hver med datoen den blev tilføjet. |
| `scan-groen.png` | 1170 × 2532 | Scanneren efter et foto af en opdigtet frugtmos med pære, æble og blåbær, hvor alle ingredienser er kendte og sikre (grønt kort). |
| `fpies-film.mp4`, `fpies-film.webm` | 1920 × 1200, 13 sek., loop, ingen lyd | To telefoner på samme familiekode: den venstre scanner etiketten og får det røde svar, skifter til 4-Dages Test og trykker Dag 4 på Laks, og lidt efter står Laks øverst på den højre telefons Sikker Liste. |
| `fpies-film-poster.png` | 1920 × 1200 | Filmens færdige tilstand: Laks er godkendt på den venstre telefon og står øverst på Sikker Liste på den højre. |

Synkroniseringen i filmen er ægte. Begge telefoner kører live mod emulatoren, og Laks nåede den højre telefon cirka 0,2 sek. efter trykket. I filmen vises det cirka 1,5 sek. senere, så man kan nå at se det.

## Scan-svaret er en stub, ikke et rigtigt Gemini-svar

Der var ingen Gemini-nøgle (`VITE_GEMINI_API_KEY`) i miljøet. Begge scan-svar er derfor skrevet i hånden i appens præcise svarformat (`scripts/data/gemini-puffs.json` og `scripts/data/gemini-frugtmos.json`). Appen sender sin rigtige prompt med fotoet, capture-scriptet svarer med stubben, og resten er appens eget resultatkort.

Vil du have et rigtigt svar, så kør `run-all.sh` én gang med `GEMINI_RECORD=1` og nøglen sat i shellen. Svaret gemmes og genbruges derefter. Nøglen kommer aldrig i buildet, i loggen eller i en fil.

## Det kunne appen ikke vise, og hvad jeg gjorde i stedet

- **Den utestede ingrediens på det røde kort.** Appen viser kun "Nye / Ikke Testede" som mærker på et orange kort. På et rødt kort står kikærtemel derfor i forklaringen og i linjen "Registrerede ingredienser".
- **Etiketten.** Den er "Små sprøde puffs med sød kartoffel & gulerod" i stedet for riskiks. Med rismel, solsikkeolie og salt havde der været fire utestede ingredienser i stedet for én, fordi de ikke står på Sikker-listen. Nu er der præcis to majsderivater (majsstivelse, maltodextrin), én utestet (kikærtemel), og resten er kendt sikre.
- **8 til 10 fødevarer på Madlister.** Sikker Liste har 9 fødevarer, men med appens rækkehøjde kan kun 7 være på skærmen over menulinjen.
- **Lidt rullet.** På 4-Dages Test og Madlister er siden rullet cirka 20 px, så den nederste række ikke klippes af menulinjen. Scan-billederne er rullet ned til kortet, som man gør efter et scan.
- **Markering, tryk og bevægelse i filmen.** Den bløde markering af Laks og trykmarkørerne findes kun i filmen. Appen har ingen markering, og dens lister skifter med det samme. I filmen glider listerne på plads på 0,37 sek. Glidet er sat sammen af appens egne skærmbilleder.
- **Kameraet.** Telefonens kamera-app vises ikke. Filmen går direkte fra trykket på "Åbn Kamera for at Scanne" til fotoet.
- **Skrifttypen.** Appens hovedskærme bruger telefonens systemfont (San Francisco på iPhone). Billederne er lavet på Linux med Inter, som ligner mest. Kører du scripts på en Mac, bliver det San Francisco.
- **Kanterne.** Appens egen topbar og menulinje går helt ud til kanten, som på telefonen, og ligger derfor delvist i de yderste 4 %. Alt indhold, der fortæller historien, ligger inden for.
- **Plakaten.** Den viser filmens færdige tilstand (ved 12 sek.). Allersidste billede i filmen er overtoningen tilbage til start, så loopet bliver sømløst.

## Ændring i appen

`src/App.jsx` har to små blokke markeret `CAPTURE BUILD ONLY`. De gør kun noget, når appen bygges med `scripts/vite.capture.config.js` (flaget `VITE_USE_EMULATOR`). Så nægter appen at starte uden et `demo-`-projekt og taler kun med emulatorerne. Et normalt build er uændret og har samme størrelse som på `main`.

## Sådan laver du dem igen

```bash
case-media/scripts/run-all.sh
```

Kræver Node 20+, Java 21+, ffmpeg og Playwright med Chromium. Er `oxipng` installeret, bliver PNG'erne mindre (uden tab). Scriptet bygger capture-versionen, starter emulatorerne og en lokal server, lægger den opdigtede familie ind, tager billederne, laver filmen og tjekker alle filer mod kravene. Capture-browseren blokerer `firestore.googleapis.com`, `identitytoolkit.googleapis.com` og `securetoken.googleapis.com`, og scriptet stopper, hvis appen ikke er capture-buildet.

| Script | Gør |
|---|---|
| `vite.capture.config.js` | Capture-build med demo-config og emulator-flag |
| `start-emulators.sh`, `firebase.json`, `firestore.rules` | Auth- og Firestore-emulatorerne på `demo-fpies` |
| `seed.mjs`, `data/family.mjs` | Den opdigtede familie K7Q2PX |
| `labels/`, `make-labels.mjs` | De opdigtede etiketter. Fotoene ligger færdige i `labels/` (så billederne bliver ens hver gang); kør `make-labels.mjs` kun hvis en etiket skal ændres |
| `capture-stills.mjs` | De fire telefonbilleder |
| `capture-film-steps.mjs`, `render-film.mjs`, `film/film.html` | Filmen og plakaten |
| `verify-media.mjs` | Tjekker pixelstørrelser, filstørrelser og videoformat |
