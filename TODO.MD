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

# TODO secondari
- [ ] Didegna anche su porte e finestre, facendo capire che sotto ci sono porte e finestre, una sorta di overlay trasparente
- [ ] nella daskside del pianeta, essendo al buio, ci devono esere i lampioni accesi che illuminano le strade
- [ ] le scale sono montate al contrario erronemante
- [ ]  tutti gli oggetti creati in city.js andreabbero postati in prop.js e eliminati da city.js
- [ ] Crea un DB per salvare i murales creati, utilizza subaset, tieni info del file (da riutilizzare in futuro), diemnsioni, posizione e utente che lo ha creato, e altre info necessarire.
- [ ] se non confugurato non salvare,aaggiungi flag in un yaml di onfigurazione se salvare o meno
- [ ] aggiungi movimento del mondo circostatne dovuto a vento: alberi, lensuoli, fili, folgie delle piante.
- [ ] movimento kay più fluido nello spazio, nei cambi direzione che devono essere poco frequenti, evitare preventivamente gli impatti se si sa cosa c'è intorno.

# TODO futuri
- [ ] inserisci un laghetto
- [ ] fare in modo che giri in background e salvi le info di murales fatti, dove, posizione in cui si trova. Limitare il tempo di run e renderlo configurabile, con allert che si consumano token
- [ ] permettere la configurazione del prompt per lo stile, o automatico
- [ ] permettere  inserimento licenza e quindi la creazione di un ulteriore omino per cui si puo definire nome, automatic stile per riconoscerlo, anche lui ha tempi di run, stile di prompt, etc.
- [ ] fotogafia o export murales
- [ ] lanciare vecchio scenario salvato con annessi murales
- [ ] reset simulazione in backgroud ogni x giorni o al complatamento degli spazi
