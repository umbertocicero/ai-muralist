# TODO 
- [x] espandere il mondo
- [x] il click su un murales nella sidebar mi morta panando davanti ad ad esso, vedendolo bene
- [x] mostra orario

# TODO prioritari
- [x] cosa sono ttti i puntini nelle ombre, usa lineette come in perfetto disegno manga → toon.js: screentone ora è tratteggio (hatch + cross-hatch), niente puntini
- [x] deve sembrare disegnato a mano, quasi 2d se si è fermi → ink line + grana carta rinforzati (postfx.js)
- [x] Migliora il codice, creando delle factory in city.js → creata cartella js/items/ con factory parametriche (nature/props + index.createItem); city.js delega (sottoinsieme: alberi/piante/bici/distributore/cono/panchina)
- [x] aggiungi più dettagli disegnati a mano → cornici finestre (instanced), panchine, marciapiedi in pietra (giunti lungo i bordi strada), scritte/glifi sulle insegne, piante più fitte
- [~] quando Kay dipinge camera dietro di lui spostata e zoommata → camera-rig: paint-cam over-the-shoulder (watchMural/admireMural). NB: verifica con 5 screenshot ancora da fare a runtime (serve browser)
- [x] Il sole deve essere sempre nello stesso punto → sole FISSO; il pianeta (worldRoot) ruota con l'ora reale di Tokyo, KAI sta sul lato giorno/notte
- [x] il lato notturno è da rivedere (terra semi-trasparente/raggi/ombre) → glow+raggi+luna ora depthTest (pianeta opaco li occlude); lato notte buio via N·L con sole fisso
- [x] Nel lato notturno i lampioni sono accesi con cono di luce verso il basso → atmosphere.js: coni additivi + pozze a terra che si accendono di notte
- [x] strisce pedonali devono essere solo su strada → zebre vincolate dentro la carreggiata, solo su tratti centrali rettilinei
- [x] Pulsante per riposizionare il mondo/ground in basso → componente ResetButton ("Raddrizza") + rig.resetView()
- [x] Aggiorna il README.MD → aggiornato
- [x] Didegna anche su porte e finestre, facendo capire che sotto ci sono porte e finestre, una sorta di overlay trasparente → mural-factory: il murale è un overlay translucido (muralOpacity 0.85) dipinto sopra porte/finestre, che traspaiono sotto la vernice
- [x] nella daskside del pianeta, essendo al buio, ci devono esere i lampioni accesi che illuminano le strade → atmosphere: luminosità lampione bakizzata per emisfero (lens/pozze/coni) + lampioni anche sullo specchio sud → solo il lato notte si accende
- [x] le scale sono montate al contrario erronemante → city `_stairs`: la rampa ora sale verso l'ingresso (gradino alto contro il muro), non verso la strada
- [x] tutti gli oggetti creati in city.js andreabbero postati in prop.js e eliminati da city.js → spostati in js/items/props.js i 13 builder discreti (lamppost, antenna, waterTower, plankFence, acUnit, nobori, planterBox, roadSign, curveMirror, aFrameBarrier, scooter, stairs, keiCar) + registrati in items/index.js; city.js ora delega via createItem (thin wrapper) e tiene solo la generazione strutturale (blocchi/tetti/facciate/strade)
- [x] elimina orario e bordo della pagina → rimossi TimeBar (#clock) e la cornice inchiostrata (#paper .frame)
- [x] aggiungi molti più lampioni sia nella zona diurna che notturan, nella zona notturan devono essere tutti accesi → città: doppio passaggio sui palazzi + fila lungo le strade principali (86→150 teste); atmosphere: rampa notte ripida (ogni lampione oltre il terminatore è a piena luce)
- [x] I graffiti su pareti sottoesposte o sovraesposse da lla luce si devono vedere sempre, non devono essere influenzate da esse. → TRE fix: (1) CAUSA VERA trovata col raycast: il muro (rigido, tangente al SUO centro) divergeva ~5° dal piano del murale (tangente al proprio punto) e su certe facciate si piegava SOPRA la vernice ingoiandola → il murale ora è piazzato nel frame rigido dell'edificio, perfettamente parallelo alla parete a 0.14; (2) cornice PRIMER cotta nella texture (margine carta + filo di china) che stacca il murale da qualunque muro, buio o bruciato; (3) opacità 0.93 + vignetta/grana del postfx che risparmiano i pixel saturi. Più fog:false (già fatto)
- [x] il percorso di Kay deve avere una certa randomicità → meandering nel pilota (bias casuale mean-reverting sulla rotta, azzerato vicino ai target) + 30% dei target di passeggiata è un punto casuale della città: due sessioni identiche divergono subito (misurato: endpoint a 59 unità dopo 60s), sempre 0 collisioni
- [x] pagina MAP live → components/MapOverlay.js + js/map.js (base cacheata + layer live ~8fps): bottone MAP apre l'overlay con Kai in tempo reale (punto+direzione+scia sbiadita), i murales dipinti (quadretti arancio, slot vuoti in filigrana) e contatore live; mobile ok
- [x] aggiungi movimento del mondo circostatne dovuto a vento: alberi, lensuoli, fili, folgie delle piante. → raffica condivisa in city.update (alberi + futon) + vento GPU in vertex shader (js/wind.js): fili che ondeggiano (pancia della campata, estremi fissi ai pali) e foglie che frusciano — costo CPU: 2 uniform/frame, FPS invariati (61 vs 60 misurati)
- [x] le case affondate per la curvatura accorciavano visivamente il piano terra (porte/finestre mangiate dallo zoccolo) → city._datumLift: ogni elemento di facciata (porte, finestre, serrande, AC, pipe, balconi+porta-finestra, insegne negozio/tetto, siding) è rialzato della sagitta locale, tornando sul piano-datum dell'edificio: piano terra a piena altezza e coerente
- [x] movimento kay più fluido nello spazio, nei cambi direzione che devono essere poco frequenti, evitare preventivamente gli impatti se si sa cosa c'è intorno. → city.steer riscritto come pilota locale: baffi di percezione a distanza fissa (0.8/1.7m avanti + fianchi ±24°), heading persistente con virata limitata (archi continui), isteresi di lato (aggira su UN lato finché non è libero), passo sempre collision-guarded (scivola lungo i muri, mai dentro). Misurato su 120s: 0 collisioni/3600 frame, 0.2% stalli, virata media 1.9°/frame
- [x] crea house.js con dentro tutti gli oggetti che la richuardano, come balconi, finestre, etc. → js/items/house.js: geometrie finestre/serrande instanced, tetti (gable/hip/tiles/corrugated), siding, balcone, shopfront, insegna da tetto, porta genkan, AC (fixtures.js fuso dentro)
- [x] panni sul balcone quando si muovono entrano erronemante nel balcone → oscillazione clampata verso l'ESTERNO (rotation.x ∈ [0.1amp, amp], mai negativa)
- [x] Migliora i cordili di strada rendendoli più realistici di pietra e tridimensionali → cordolo più alto (0.16) con labbro chiaro + giunti di pietra inchiostrati sui 4 lati
- [x] Stampa una mappa della città costruita → js/map.js drawCityMap (strade/edifici tratteggiati/slot murales/pali/KAI, stile manga); debug: window.__map()
- [x] il balcone deve essere coerente con le finestre dietro. se è un balcone la finestra deve arrivare fino a toccarlo a terra, non una finestrella → il balcone porta la sua PORTA-FINESTRA a tutta altezza (vetro fino alla soletta, 2 ante sui balconi larghi); le finestrelle instanced su quel piano vengono saltate
- [x] aggiungi dettagli a tutte le tipologie di porte in stile manga. → serrande con DOGHE orizzontali instanced (leggono subito come シャッター); porta genkan già dettagliata (ante scorrevoli, vetri, pannelli)


- [x] i murales devono coprire con una certa opacità finestre e porte (non esserne bucati) → murale spinto a 0.30 dal muro (oltre ogni sporgenza: davanzali 0.15, porta ≤0.2, AC rientrata a 0.25) con opacità 0.9: le aperture traspaiono sotto la vernice; verificato col raycast (velo→murale→porta) e a schermo (telai in filigrana nel dipinto)
- [x] le porte sembrano garage, migliorare completamente → (a) le serrande a doghe ora SOLO sui negozi (su una casa leggevano come garage; il piano terra residenziale ha finestre); (b) porta genkan ridisegnata: tettoia su mensole, doghe verticali, vetro smerigliato laterale con traversine, maniglione ottone, zoccolo, targhetta, soglia bassa
- [x] Kay entra nei muri quando li costeggia → i muri (rigidi, tangenti al proprio centro) pendono ~0.15 fuori dall'impronta piatta usata dalle collisioni: il pilota ora usa un margine extra 0.14 (isColliding(extra)) — misurato: distanza minima dai muri 0.57 (prima 0.4), 0 collisioni
- [x] la camera nei vicoli stretti impazzisce → isteresi sull'anti-occlusione (aggancia subito, rilascia dopo 0.5s di via libera: niente flip bloccato/libero per frame) + risalita pitch più dolce (5→3.2) e zoom-out più calmo — misurato: 0.3 inversioni di pitch/secondo in 60s di vicoli

- [x] le scale poggiate a caso non hanno senso → rimosse le rampe libere da _buildStreetProps (e makeStairs dalla factory); i gradini d'ingresso ora sono lo STOOP a 2 alzate integrato nella porta genkan
- [x] le porte non sembrano porte disegnate in stile manga → porta ridipinta nella tavolozza B&N del mondo (il colore è solo dei murales): anta grigio-china con doghe verticali come tratti di penna, tettoia scura come i tetti, barre chiare sul vetro smerigliato, maniglione chiaro (highlight disegnato), targhetta, stoop in cemento
- [x] le case sono erroneamente sulle strade (viste dalla mappa) → il check di piazzamento misurava solo il CENTRO del lotto: nuovo _obbClearOfRoads campiona l'intero perimetro (angoli + metà lati) contro ogni strada, con restringimento progressivo o scarto del lotto — verificato: 0 violazioni su 45 edifici, mappa pulita anche all'incrocio

# TODO secondari
- [x] i balconi devono avere le stessere caratteristiche delle finestre in termini di dettagli. → house.js makeBalcony: la porta-finestra ha ora la stessa ricetta delle finestre instanced — telaio scuro dietro il vetro, griglia di traversine (montanti laterali + traversa = 4 luci), soglia in cemento sporgente sotto l'anta
- [x] Crea un DB per salvare i murales creati, utilizza subaset, tieni info del file (da riutilizzare in futuro), dimensioni, posizione e utente che lo ha creato, e altre info necessarire. → Cloudflare D1 (schema.sql): svg completo (riusabile), dimensioni muro, posizione+normale, stile, thought, user_id anonimo per browser, created_at; worker GET/POST /murals; ripristino al boot sul mondo seedato
- [x] se non confugurato non salvare, aggiungi flag in un yaml di onfigurazione se salvare o meno → config.yaml (save_murals: true|false, + worker_url/model/mode opzionali) letto al boot da js/settings.js; senza worker o con flag off non salva nulla
- [x] aggiungi una sezione settings che permette di attivare la creazione di murales da parte di ai e la relativa form per configurarla (api key e modello da usare), nella stessa sezione se si sceglie demo mode allora usa gli svg pre configurati, altrimenti se configurato prendi le info dalla cache e si possono editare, oppure te le fa inserire. → components/SettingsPanel.js (bottone ⚙): modo demo/AI, api key propria (cache localStorage, editabile; usata via worker come x-user-api-key o diretta ad Anthropic se non c'è worker), modello, worker url override
- [x] aggiungi in setting se salvare su DB o no, all'avvio prende sempre le info dei murals creati da DB se disponibili, e le applica al mondo → toggle "save murals" nel pannello; il RESTORE gira sempre quando un worker è noto (anche in demo) e prevale: l'agente non sceglie muri finché i murales salvati non hanno ripreso i loro slot

# TODO grafici / UI manga

## 1. UI in stile manga: bordi disegnati a mano + speech bubble
**Obiettivo:** trasformare `.panel` (attualmente rettangoli arrotondati semitrasparenti, stile HUD sci-fi) e componenti Vue in elementi manga disegnati a mano, coerenti con l'estetica inchiostrata della scena sotto.

**Scope:**
- **index.html (CSS)**: classe `.panel` (riga 26) e `.ui` (riga 25)
  - Aggiungere bordo doppio irregolare (primary border + thin offset stroked border con jitter ±0.3° via `clip-path` o SVG mask)
  - Background: mantenere semi-trasparente carta ma ridurre blur-backdrop (meno "futurista", più "pagina")
  - Border-radius: ridurre da `2px` a `0px` (angoli retti = manga)
- **index.html (CSS) / #thought (riga 115-118)**:
  - Trasformare da box rettangolare a **speech bubble** SVG o CSS con coda triangolare
  - La coda punta verso KAI (dinamica: calcolare angolo camera→KAI, ruotare la coda di conseguenza — vedi js/camera-rig.js per posizione rig.target)
  - Contenitore: `<svg>` con `<path>` e `<text>`, oppure CSS clip-path per il triangolo
- **components/**: titoli (BootScreen.js, SettingsPanel.js, MuralLog.js)
  - Aggiungere font brush/manga (es. "Segoe Print", "Marker Felt", oppure import web font da Google Fonts tipo "Caveat" / "Fredoka One")
  - `.exp`, `.name`, `.sub` classi (riga 34-36 index.html): applicare font brush ai titoli, letterspacing più naturale
- **components/ThoughtBubble.js**:
  - Attualmente template minimalista (riga 8-12); ridisegnare con classe `.bubble` che istanzia SVG speech bubble
  - Stato reattivo: `bubbleAngle` (calcolato da posizione KAI nel 3D → projection screen)
  - La coda segue KAI: `transform: rotate({{ bubbleAngle }}deg)`

**File da modificare:** `index.html` (CSS), `components/ThoughtBubble.js`, `js/main.js` (calcolare `ui.bubbleAngle` nel loop)
**Stima complessità:** medio (CSS custom properties + 1 componente Vue riscritta)

---

## 2. Speed lines + SFX onomatopea durante azione
**Obiettivo:** aggiungere effetti cinetici manga — linee di velocità radiali quando KAI cammina/corre, e onomatopee testuali che compaiono/scompaiono durante PAINTING.

**Scope:**
- **Speed lines (WANDERING / MOVING_TO_WALL)**:
  - Nuovo canvas overlay (o THREE.js ScreenSpace 2D layer) che disegna **速度線** come raggi radiali dietro KAI
  - Trigger: attivi solo quando `agent.state ∈ [WANDERING, MOVING_TO_WALL]` e `velocity > threshold` (vedi js/agent.js riga ~50)
  - Animazione: 8-12 linee radiali da un punto dietro KAI, opacità fade-out, durata 200ms, loop continuo
  - Parametri configurabili in `config.js` (density, length, opacity, speed)
  
- **SFX onomatopea (PAINTING state)**:
  - Testo SVG/DOM overlay che appare quando entra PAINTING (vedi agent.js riga ~100)
  - Rotazione casuale: SFX come "シャー" (sha~a = suono spray), "ドクドク" (doku-doku = goccia), "ザッザッ" (za-za = brush strokes)
  - Lista di 5-8 onomatopee in array in `config.js`, scelta random o ciclica per stile
  - Animazione: fade-in rapido (100ms), wobble leggero (±1-2°), fade-out su timer (vedi PAINTING duration: `config.paintSeconds`)
  - Posizione: random in prossimità del muro dove KAI dipinge (screen-space offset dal centro)

**File da modificare:** 
- `js/config.js` (aggiungere `speedLines` + `sfxOnomatopoeia` params)
- `js/agent.js` (scrivere a `ui.speedLinesActive`, `ui.currentSfx`, `ui.sfxPosition` quando cambia state)
- Nuovo `components/SpeedLines.js` (canvas layer con RAF draw loop)
- Nuovo `components/SfxOverlay.js` (SVG text element con animazione)
- `components/` index o `js/main.js`: istanziare i due componenti

**Stima complessità:** medio-alto (logica state + 2 componenti animati)

---

## 3. Panel-frame: bordo nero irregolare attorno al viewport (manga page closure)
**Obiettivo:** aggiungere un bordo inchiostrato spesso e irregolare attorno ai 4 lati del viewport come ultimo layer del post-processing, dando la sensazione che l'intera scena sia una **pagina di manga disegnata**.

**Scope:**
- **postfx.js (MangaPost shader)**:
  - Attualmente (riga 31-99) il fragment shader fa Sobel edge + paper + vignette
  - Aggiungere uniforms: `uFrameWidth` (spessore in pixels, es. 12-20px), `uFrameNoise` (randomness del bordo, 0-1)
  - Nel fragment shader, dopo il vignette (riga 92), aggiungere controllo se il pixel è dentro un margine dalla schermata
  - Se sì, campionare Perlin noise (o valore hash pseudorandom) per dare texture irregolare al bordo (non rettilineo)
  - Mix gradualmente verso nero scuro (0.05 come le ink lines, riga 80) con smoothstep su distanza dal bordo
  - Opzione alternativa (più semplice): doppio bordo con offset (inner frame sottile + outer frame spesso con jitter)
  
- **index.html (CSS)**:
  - Aggiungere `::before` o `::after` pseudo-element su `#canvas-root` con `pointer-events: none`
  - Box-shadow inset spesso e irregolare (via SVG filter/feDisplacementMap), oppure immagine PNG border distorted
  - Alternativa semplice: border SVG disegnato a mano e deployato come background-image

**File da modificare:** 
- `js/postfx.js` (fragment shader: aggiungere frame border + noise)
- `js/config.js` (aggiungere `visual.frameWidth`, `visual.frameNoise`)
- Opzionale: `index.html` CSS se si usa ::before overlay

**Stima complessità:** bassa-medio (una uniforme nel shader + 10 righe di glsl)

---

## 4. KAI protagonist contrast: verificare e rafforzare ink outline del personaggio
**Obiettivo:** assicurare che KAI sia sempre ben leggibile — il protagonista in manga ha contorno ink più marcato di tutto il resto. Attualmente da lontano è una macchiolina indistinta.

**Scope:**
- **character.js (createCharacter() / mesh building)**:
  - Controllare come viene applicato `addInk()` a KAI (vedi toon.js riga 166)
  - Verificare il parametro `k` (expansion factor) per il character — probabilmente è lo stesso di edifici (default 1.012)
  - Soluzione: creare una variante `addInk(mesh, k=1.035, color=0x000000)` specifica per KAI (k più alto = outline più spesso)
  - Alternativa: aumentare `inkDefault` (riga 74 config.js) solo per KAI, non globale
  
- **Visibilità da lontano**:
  - Controllare LOD: KAI ha geometria semplificata da certi angoli? (vedi character.js, potrebbe usare Three.js LOD)
  - Se sì, assicurare che LOD bassa mantenga silhouette chiara (non ridurre sagoma)
  - Testare a distanza: camera zoom minimo (default `camRadius: 22` riga 374 config.js)
  
- **Test**:
  - Screenshot a schermo intero con KAI piccolo in lontananza (urban zoom out)
  - Confrontare contrast ink outline KAI vs. edifici vicini
  - Se ancora blurry, aumentare k verso 1.05+ o raddoppiare geometria outline

**File da modificare:**
- `js/character.js` (riga addInk call)
- `js/toon.js` (aggiungere parametro `isProtagonist` a addInk? oppure hardcode KAI)
- `js/config.js` (aggiungere `characterInkScale` opzionale)
- Test: lanciare app e fare screenshot con Playwright a zoom vari

**Stima complessità:** bassa (poche righe di codice, soprattutto test visuale)

- [ ] sistema la bomboletta impugnata male → bomboletta dentro il pugno, inclinata verso il muro, cap solidale alla bomboletta

# TODO futuri
- [ ] inserisci un laghetto
- [ ] fare in modo che giri in background e salvi le info di murales fatti, dove, posizione in cui si trova. Limitare il tempo di run e renderlo configurabile, con allert che si consumano token
- [ ] fin quando almeno persona è connessa kay gira e genera, se nessuno è connesso kay si ferma.
- [ ] permettere la configurazione del prompt per lo stile, o automatico
- [ ] permettere  inserimento licenza e quindi la creazione di un ulteriore omino per cui si puo definire nome, automatic stile per riconoscerlo, anche lui ha tempi di run, stile di prompt, etc.
- [ ] fotogafia o export murales
- [ ] lanciare vecchio scenario salvato con annessi murales
- [ ] reset simulazione in backgroud ogni x giorni o al complatamento degli spazi
- [ ] pulsante con sccritto nuovo mondo, e l'utente può scegliere di inserire un suo personaggio, io gli do il mondo lui se lo naviga con la propria api (feature a pagamento)
- [ ] il personaggio si può customizzare
- [ ] login
- [ ] tabella audit, chi genera cosa e quando
