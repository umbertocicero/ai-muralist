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
- [x] sistema la bomboletta impugnata male → bomboletta dentro il pugno, inclinata verso il muro, cap solidale alla bomboletta
- [x] Migliora i cordili di strada rendendoli più realistici di pietra e tridimensionali → cordolo più alto (0.16) con labbro chiaro + giunti di pietra inchiostrati sui 4 lati
- [x] Stampa una mappa della città costruita → js/map.js drawCityMap (strade/edifici tratteggiati/slot murales/pali/KAI, stile manga); debug: window.__map()
- [x] il balcone deve essere coerente con le finestre dietro. se è un balcone la finestra deve arrivare fino a toccarlo a terra, non una finestrella → il balcone porta la sua PORTA-FINESTRA a tutta altezza (vetro fino alla soletta, 2 ante sui balconi larghi); le finestrelle instanced su quel piano vengono saltate
- [x] aggiungi dettagli a tutte le tipologie di porte in stile manga. → serrande con DOGHE orizzontali instanced (leggono subito come シャッター); porta genkan già dettagliata (ante scorrevoli, vetri, pannelli)


- [x] i murales devono coprire con una certa opacità finestre e porte (non esserne bucati) → murale spinto a 0.30 dal muro (oltre ogni sporgenza: davanzali 0.15, porta ≤0.2, AC rientrata a 0.25) con opacità 0.9: le aperture traspaiono sotto la vernice; verificato col raycast (velo→murale→porta) e a schermo (telai in filigrana nel dipinto)
- [x] le porte sembrano garage, migliorare completamente → (a) le serrande a doghe ora SOLO sui negozi (su una casa leggevano come garage; il piano terra residenziale ha finestre); (b) porta genkan ridisegnata: tettoia su mensole, doghe verticali, vetro smerigliato laterale con traversine, maniglione ottone, zoccolo, targhetta, soglia bassa
- [x] Kay entra nei muri quando li costeggia → i muri (rigidi, tangenti al proprio centro) pendono ~0.15 fuori dall'impronta piatta usata dalle collisioni: il pilota ora usa un margine extra 0.14 (isColliding(extra)) — misurato: distanza minima dai muri 0.57 (prima 0.4), 0 collisioni
- [x] la camera nei vicoli stretti impazzisce → isteresi sull'anti-occlusione (aggancia subito, rilascia dopo 0.5s di via libera: niente flip bloccato/libero per frame) + risalita pitch più dolce (5→3.2) e zoom-out più calmo — misurato: 0.3 inversioni di pitch/secondo in 60s di vicoli

# TODO secondari
- [ ] Crea un DB per salvare i murales creati, utilizza subaset, tieni info del file (da riutilizzare in futuro), diemnsioni, posizione e utente che lo ha creato, e altre info necessarire.
- [ ] se non confugurato non salvare, aggiungi flag in un yaml di onfigurazione se salvare o meno


# TODO futuri
- [ ] inserisci un laghetto
- [ ] fare in modo che giri in background e salvi le info di murales fatti, dove, posizione in cui si trova. Limitare il tempo di run e renderlo configurabile, con allert che si consumano token
- [ ] permettere la configurazione del prompt per lo stile, o automatico
- [ ] permettere  inserimento licenza e quindi la creazione di un ulteriore omino per cui si puo definire nome, automatic stile per riconoscerlo, anche lui ha tempi di run, stile di prompt, etc.
- [ ] fotogafia o export murales
- [ ] lanciare vecchio scenario salvato con annessi murales
- [ ] reset simulazione in backgroud ogni x giorni o al complatamento degli spazi
