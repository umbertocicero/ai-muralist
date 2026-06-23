# AI Muralist — Master Prompt & Architecture Document

> Versione 2.0 — Documento di specifiche completo per lo sviluppo del progetto.
> Questo file è il prompt da consegnare all'AI per costruire l'applicazione da zero.

---

## 1. Concept

**AI Muralist** è un esperimento web virale: un agente AI autonomo di nome **KAI** (カイ) — un ragazzo giapponese adolescente — si muove in un quartiere 3D in bianco e nero e decide spontaneamente di dipingere murales coloratissimi sulle pareti grigie degli edifici. Ogni murale è un'opera d'arte SVG generata in tempo reale da Claude, unica e irripetibile. L'esperimento gira in loop infinito nel browser — nessun intervento umano richiesto.

**Obiettivo virale:** chi apre il sito vede un ragazzo in giacca scura camminare per le strade silenziose di un quartiere giapponese in B&W, avvicinarsi a un muro di cemento, e lì appare un murale vivace generato dall'AI — come un'esplosione di colore nel grigio. È ipnotico, condivisibile, e dimostra l'autonomia creativa dell'intelligenza artificiale.

### Identità del personaggio: KAI (カイ)

- **Nome:** KAI — internazionale, giapponese (海 = oceano), corto e memorabile
- **Età:** adolescente (teenager)
- **Aspetto:** ragazzo con giacca scura/nera, capelli neri piatti, berretto con visiera, borsa messenger, bomboletta spray nella mano destra
- **Carattere:** silenzioso, introspettivo, poetico — vaga il quartiere come un fantasma e lascia colore dove c'era solo grigio

### Ambientazione: Quartiere giapponese rurale in B&W

- Edifici bassi con **tetti a padiglione** (hip roof, piramide 4 lati con gronda scura)
- **Pali della luce** con traverse multiple e **fili elettrici** che si incurvano tra i pali (elemento iconico)
- Strade strette in cemento grigio, muri bassi tra i lotti, alberi dalla silhouette scura
- Atmosfera: cielo grigio perla, luce overcast diffusa — **nessun sole diretto**
- Il contrasto: il mondo è B&W, i murales di KAI sono l'unico colore

### Stile SVG dei murales

I murales devono sembrare **disegni organici e pittorici**, NON geometria astratta.

**Tecnica richiesta:**
- `<path>` con comandi bezier (`C`, `Q`, `S`, `A`) come elemento principale
- Forme organiche, curve, asimmetriche — mai rettangoli rigidi come elemento primario
- Tratti con `stroke-width` variabile per simulare il pennello
- Layer semi-trasparenti sovrapposti per effetti di lavaggio a inchiostro / acquerello

**8 stili a rotazione** (indice % 8):
0. Ukiyo-e · 1. Sumi-e · 2. Manga · 3. Woodblock · 4. Anime · 5. Kirie · 6. Wabi-sabi · 7. Kanji-art

---

## 2. Stack tecnico

| Layer | Tecnologia | Note |
|---|---|---|
| Rendering 3D | **Three.js r128** (CDN) | Ultima versione con UMD global build su cdnjs — nessun bundler, file HTML singolo |
| AI murales | **Anthropic Claude API** (`claude-sonnet-4-6`) | SVG generato on-demand |
| AI pensieri | **Anthropic Claude API** (`claude-sonnet-4-6`) | Frase poetica dell'artista |
| Backend | **Nessuno** | Tutto client-side tranne proxy API |
| Deploy | **Cloudflare Pages** (free tier) | Hosting statico |
| API proxy | **Cloudflare Worker** (free tier) | Nasconde la chiave API, rate limiting |
| Rate limiting | **Cloudflare KV** (free tier) | Max 1 req/8s per IP |
| Dominio | **pages.dev** (gratuito) | Nessun costo dominio |

**Perché zero backend:** l'app è un singolo file HTML + un Cloudflare Worker di ~60 righe. Nessun server, nessun database, zero costi operativi di infrastruttura.

---

## 3. Architettura di deploy

```
Browser
  │
  ├── Carica  ai-muralist/index.html  (Cloudflare Pages — free)
  │     │
  │     └── Three.js r128 via CDN (cdnjs.cloudflare.com)
  │
  └── Chiama  /api/claude  (Cloudflare Worker — free)
        │
        ├── Cloudflare KV  (rate limiting per IP)
        │
        └── Anthropic API  (api.anthropic.com/v1/messages)
              └── Restituisce SVG murale + frase artistica
```

### 3.1 Cloudflare Pages (hosting)

- Repository GitHub → connesso a Cloudflare Pages
- Build command: nessuno (file statici)
- Output directory: `/`
- URL automatico: `https://ai-muralist.pages.dev`
- **Costo: $0**

### 3.2 Cloudflare Worker (API proxy)

File: `worker.js`

```javascript
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const RATE_LIMIT_MS = 8_000;

export default {
  async fetch(request, env) {
    // Preflight CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }

    // Rate limiting via KV
    const clientIP = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    if (env.RATE_LIMIT_KV) {
      const lastTs = await env.RATE_LIMIT_KV.get(`rl:${clientIP}`);
      if (lastTs && Date.now() - parseInt(lastTs) < RATE_LIMIT_MS) {
        return json({ error: { type: 'rate_limit_error', message: 'Too many requests. Wait a moment.' } }, 429);
      }
      await env.RATE_LIMIT_KV.put(`rl:${clientIP}`, String(Date.now()), { expirationTtl: 10 });
    }

    // Parse + validate body
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: { type: 'invalid_request_error', message: 'Invalid JSON body' } }, 400);
    }

    if (!body.model || !body.messages || !body.max_tokens) {
      return json({ error: { type: 'invalid_request_error', message: 'Missing required fields: model, messages, max_tokens' } }, 400);
    }

    // Proxy to Anthropic
    try {
      const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });

      const data = await upstream.json();
      return json(data, upstream.status);
    } catch {
      return json({ error: { type: 'upstream_error', message: 'Failed to reach AI service' } }, 502);
    }
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
```

- Secret `ANTHROPIC_API_KEY` configurato via `wrangler secret put` (mai esposto al client)
- KV namespace `RATE_LIMIT_KV` per rate limiting per-IP
- Il Worker restituisce lo stesso status HTTP di Anthropic — il frontend può distinguere errori 429/500 da risposte valide
- Free tier: 100.000 request/giorno — ampiamente sufficiente
- **Costo: $0**

### 3.3 Stima costi Anthropic API

Prezzi `claude-sonnet-4-6`: input $3/MTok · output $15/MTok

| Evento | Input (tok) | Output (tok) | Costo per evento |
|---|---|---|---|
| Generazione SVG murale | ~400 | ~1.500 | ~$0.024 |
| Generazione frase artistica | ~150 | ~25 | ~$0.001 |
| **Totale per murale** | | | **~$0.025** |

Con 1.000 visitatori/giorno × 3 murales ciascuno → ~$75/giorno.
**Raccomandazione:** implementare rate limiting aggressivo nel Worker (già incluso) e considerare `claude-haiku-4-5` ($0.80/$4.00 MTok) per ridurre i costi di ~6× senza perdita visibile di qualità SVG.

---

## 4. Struttura file di progetto

```
ai-muralist/
├── index.html          ← app completa (Three.js + logica agente)
├── worker.js           ← Cloudflare Worker (API proxy + rate limiting)
├── wrangler.toml       ← config deploy Worker + KV namespace
└── README.md
```

---

## 5. Specifiche mondo 3D — stile manga in bianco e nero

> **OBIETTIVO VISIVO:** la scena NON deve sembrare un modello 3D low-poly liscio.
> Deve sembrare un **disegno manga/anime in bianco e nero** — line-art a inchiostro,
> campiture piatte bianco·grigio, quasi identico alle illustrazioni di riferimento
> (vicoli giapponesi, tetti sovrapposti, intrico di fili elettrici).
> L'unico colore in tutta la scena sono i murales che KAI dipinge.

### 5.0 Pipeline di rendering NPR (non-photorealistic)

Il look "disegnato" si ottiene con due tecniche combinate (`js/toon.js`), **senza
cambiare framework** — Three.js resta, ma renderizza in stile cel/manga:

1. **Cel / toon shading** — `MeshToonMaterial` con un `gradientMap` a 3 step
   (nearest-filtered). La luce diventa a bande piatte (bianco · grigio · ombra)
   invece di un gradiente liscio → aspetto a campiture da fumetto.

2. **Contorno d'inchiostro (inverted-hull)** — ogni mesh viene disegnato una
   seconda volta, ingrandito di pochi % lungo le normali, con sole back-face in
   nero (`MeshBasicMaterial`, `side: BackSide`). Il guscio sporge oltre la
   silhouette → un contorno nero netto, come le linee a pennino dei disegni.
   Il fattore di scala proporzionale dà una **variazione di spessore** naturale
   (forme grandi = linee più marcate).

3. **Output piatto** — `renderer.toneMapping = NoToneMapping`, sfondo e fog
   bianco-carta (`#f4f2ee`) per la dissolvenza nebbiosa in lontananza tipica
   delle reference.

> Alternativa valutata e scartata: post-processing con edge-detection (Sobel su
> depth+normal via EffectComposer). Più "vero" ma in r128 gli addon `examples/jsm`
> via CDN duplicano il modulo `three` (problemi di `instanceof`). L'inverted-hull
> usa solo il core, è robusto e zero-dipendenze.

### 5.1 Ambientazione

- **Atmosfera:** quartiere giapponese, cielo grigio-carta (`#f4f2ee`), luce diffusa
- **Fog:** dissolvenza al bianco (`#f4f2ee`, da 48 a 140 unità) — effetto foschia
- **Ground:** cemento chiaro cel-shaded; strade grigie con strisce/crepe scure
- **Palette:** solo bianco/grigio/nero — i murales sono l'unica eccezione a colori

### 5.2 Illuminazione

```
DirectionalLight (key):
  color: #ffffff   intensity: 1.45   position: (34, 58, 26)
  castShadow: true   shadow.mapSize: 2048×2048
  → crea lo split luce/ombra che il gradientMap trasforma in bande nette

AmbientLight:
  color: #ffffff   intensity: 0.72
  → le ombre restano grigio chiaro (tono), non nero — come nei manga
```

### 5.3 Edifici

- **Stile:** case giapponesi basse con **tetto a padiglione** (ConeGeometry 4 lati
  + fascia di gronda scura), finestre scure
- **Altezza:** 2.8 / 4.1 / 5.4 / 6.7 unità (variazione per isolato)
- **Colori:** quasi-bianchi (`#ffffff`→`#eeece8`) — il colore lo dà l'ombra cel + contorno
- **Materiale:** `MeshToonMaterial` + contorno inverted-hull nero
- **Numero:** 16 edifici in griglia urbana ortogonale

### 5.4 Layout urbano

```
Strade principali: asse X e asse Z (larghezza 7 unità)
Strade secondarie: a -21 e +21 su entrambi gli assi
Isolati: 4 edifici per isolato, disposti agli angoli

Posizioni edifici (x, z):
(-12,-12), (12,-12), (-12,12), (12,12)    ← isolato centrale
(-30,-12), (-30,12), (30,-12), (30,12)    ← isolati laterali
(-12,-30), (12,-30), (-12,30), (12,30)    ← isolati superiori/inferiori
(-30,-30), (30,-30), (-30,30), (30,30)    ← angoli
```

### 5.5 Dettagli scenici (iconici delle reference)

- **Pali della luce** alti con doppia traversa, lungo tutte le strade
- **Fili elettrici** che si incurvano tra i pali (QuadraticBezierCurve3) — anche
  cavi che attraversano la strada: l'intrico di fili è l'elemento più riconoscibile
- **Alberi** a silhouette scura (chioma a sfere sovrapposte)
- Muri bassi di cemento tra i lotti, distributori automatici
- Strisce/crepe scure sull'asfalto, marciapiedi rialzati

---

## 6. Sistema di collisione (OBBLIGATORIO — bug critico v1)

L'omino **non deve attraversare i blocchi**. Implementare AABB (Axis-Aligned Bounding Box) collision detection.

### 6.1 Struttura dati edifici

Ogni edificio espone il proprio bounding box:

```javascript
const buildingBBoxes = buildingConfigs.map(cfg => ({
  minX: cfg.x - cfg.w / 2 - 0.4,  // 0.4 = raggio personaggio
  maxX: cfg.x + cfg.w / 2 + 0.4,
  minZ: cfg.z - cfg.d / 2 - 0.4,
  maxZ: cfg.z + cfg.d / 2 + 0.4,
}));
```

### 6.2 Logica di movimento con collisione

```javascript
function tryMove(charPos, dx, dz) {
  const nextX = charPos.x + dx;
  const nextZ = charPos.z + dz;

  // Prova movimento completo
  if (!isColliding(nextX, nextZ)) {
    charPos.x = nextX;
    charPos.z = nextZ;
    return;
  }

  // Prova solo X (sliding sul muro)
  if (!isColliding(nextX, charPos.z)) {
    charPos.x = nextX;
    return;
  }

  // Prova solo Z
  if (!isColliding(charPos.x, nextZ)) {
    charPos.z = nextZ;
    return;
  }

  // Bloccato — non muovere
}

function isColliding(x, z) {
  return buildingBBoxes.some(b =>
    x > b.minX && x < b.maxX &&
    z > b.minZ && z < b.maxZ
  );
}
```

### 6.3 Pathfinding semplificato (steering behavior)

Non usare A*. Usare **obstacle avoidance per steering**:

- Se il prossimo step collide, ruota il vettore direzione di ±15° e riprova
- Max 12 tentativi per frame
- Se ancora bloccato dopo 12 tentativi, scegli nuovo target casuale
- L'omino "scivola" lungo i muri (wall sliding) grazie alla logica X/Z separata

```javascript
function steer(charPos, target, moveSpeed) {
  const dir = new THREE.Vector3(
    target.x - charPos.x, 0,
    target.z - charPos.z
  ).normalize();

  for (let attempt = 0; attempt < 12; attempt++) {
    const sign  = attempt % 2 === 0 ? 1 : -1;
    const steps = Math.floor(attempt / 2);
    const angle = sign * steps * (Math.PI / 12);
    const rot   = rotateY2D(dir, angle);
    const nextX = charPos.x + rot.x * moveSpeed;
    const nextZ = charPos.z + rot.z * moveSpeed;

    if (!isColliding(nextX, nextZ)) {
      charPos.x = nextX;
      charPos.z = nextZ;
      return true;
    }
  }
  return false; // completamente bloccato → il chiamante sceglie nuovo target
}

function rotateY2D(v, angle) {
  return {
    x: v.x * Math.cos(angle) - v.z * Math.sin(angle),
    z: v.x * Math.sin(angle) + v.z * Math.cos(angle),
  };
}
```

### 6.4 Scelta target muro accessibile

Quando l'AI sceglie una parete su cui dipingere, il punto di avvicinamento deve essere **verificato libero da collisioni** prima di impostarlo come destinazione. Se il punto è all'interno o troppo vicino a un altro edificio, scartare quel wall slot e provarne un altro.

```javascript
function isWallApproachFree(slot) {
  const offset = 1.5; // distanza di avvicinamento dalla parete
  const px = slot.px - slot.nx * offset;
  const pz = slot.pz - slot.nz * offset;
  return !isColliding(px, pz);
}
```

---

## 7. Personaggio — KAI (カイ)

**Identità:** ragazzo giapponese adolescente, artista di strada silenzioso e poetico.
Giacca scura, capelli neri + berretto con visiera, borsa messenger, bomboletta spray
nella mano destra. Reso in **cel-shading + contorno d'inchiostro nero** come la città,
così legge come una figura disegnata (alla volta di spalle, come nelle reference).

### 7.1 Geometria

Primitive Three.js (BoxGeometry) con `MeshToonMaterial` + contorno inverted-hull.
Tutti i mesh sono figli di un `THREE.Group` centrato ai piedi (y=0):

```
Testa:      0.44×0.44×0.40  y=1.58   pelle chiara  #e6d6c0   + ink
Capelli:    0.48×0.13×0.44  y=1.84   nero          #0a0808   + ink
Visiera:    0.46×0.06×0.18  y=1.76   nero          #141210
Corpo/giacca:0.50×0.68×0.30 y=0.92   quasi-nero    #1a1a1a   + ink
Colletto:   0.28×0.10×0.31  y=1.24   bianco        #e8e4e0
Borsa:      0.28×0.24×0.10  hip sx   nero          #171510   + ink
Spray can:  cilindro r0.05 h0.22     bianco        #e2dfda   + ink
Braccia:    0.17×0.50×0.20  y=0.88   giacca        #1a1a1a   + ink
Gambe:      0.20×0.54×0.25  y=0.30   nero          #0c0c0c   + ink
Scarpe:     0.22×0.09×0.30  y=0.02   nero-bruno    #100c08   + ink
```

### 7.2 Animazioni

- **Camminata:** braccia oscillano in opposizione (`sin(t*4)*0.4` rad su asse X)
- **Testa:** leggero bob verticale (`sin(t*8)*0.015` rad)
- **Pittura:** braccio destro oscilla verso il muro (`sin(t*6)*0.6 - 0.3` rad su asse X)
- **Idle (pensiero):** piccola oscillazione lenta della testa (`sin(t)*0.05` rad su asse Y)

### 7.3 Constraint: no volo

Il personaggio è sempre a `y = 0` (ground level). Nessuna forza verticale. Gravità non simulata.

---

## 8. Sistema murales

### 8.1 Wall slots

Per ogni edificio, registrare 4 slot parete (N, S, E, W). Ogni slot ha:

```javascript
{
  px, pz,         // posizione centro parete (xz)
  py,             // posizione y centro parete = edificio.height / 2
  nx, nz,         // normale uscente (direzione verso l'esterno)
  wallW,          // larghezza parete (profondità edificio per N/S, larghezza per E/W)
  wallH,          // altezza parete = altezza edificio
  buildingIdx,    // riferimento all'edificio
  used: false,    // murale già presente
  mesh: null,     // riferimento al PlaneGeometry mesh del murale
}
```

### 8.2 Dimensioni murale

Il murale copre l'**88% della larghezza** e l'**85% dell'altezza** della parete:

```javascript
const muralW = slot.wallW * 0.88;
const muralH = slot.wallH * 0.85;
```

### 8.3 Regola di non sovrascrittura

Un wall slot con `used: true` non può ricevere un secondo murale. L'AI sceglie **sempre** uno slot `used: false`. Quando tutti gli slot sono occupati, l'omino continua a vagare (stato `CONTEMPLATING`).

### 8.4 Generazione SVG via Claude API

**Endpoint:** `POST /api/claude` (Cloudflare Worker proxy)

#### Struttura richiesta API

```javascript
// Variabili da calcolare prima della chiamata:
const PW = 512;                          // larghezza canvas SVG in px (fissa)
const PH = Math.round(512 * (slot.wallH / slot.wallW));  // altezza proporzionale
const aspectDesc = slot.wallH / slot.wallW > 1.3 ? 'tall portrait'
                 : slot.wallW / slot.wallH > 1.3 ? 'wide landscape'
                 : 'roughly square';
const muralIndex = muralCount;           // contatore globale murales (0-based)

// Corpo richiesta per il murale (SVG):
const svgRequest = {
  model: 'claude-sonnet-4-6',
  max_tokens: 2048,
  temperature: 1,
  messages: [{ role: 'user', content: svgPrompt(PW, PH, aspectDesc, muralIndex, slot.wallW, slot.wallH) }],
};

// Corpo richiesta per il pensiero artistico:
const thoughtRequest = {
  model: 'claude-sonnet-4-6',
  max_tokens: 60,
  temperature: 1,
  messages: [{ role: 'user', content: thoughtPrompt(slot.wallW, slot.wallH, muralIndex) }],
};

// Parsing risposta (difensivo — rimuove markdown fences se Claude le aggiunge):
function extractSVG(responseText) {
  return responseText
    .replace(/^```[\w]*\n?/m, '')
    .replace(/\n?```$/m, '')
    .trim();
}
```

#### Prompt per il murale SVG

```
You are KAI, a teenage street artist wandering a grey Japanese neighbourhood.
You paint vivid murals on concrete walls — bursts of colour in a monochrome world.
Your painting style is expressive and hand-drawn, never rigid or geometric.

This is mural #{muralIndex}. Use ({muralIndex} % 8) to choose your style:
STYLE 0 — UKIYO-E: flowing waves/mountains in navy·vermillion·gold; curved <path> shapes
STYLE 1 — SUMI-E: sweeping brushstroke paths, varying stroke-width, ink-wash layers
STYLE 2 — MANGA: speed-line paths from focal point, high contrast, one electric colour
STYLE 3 — WOODBLOCK: bold organic outlines (stroke 3-6px), earth-tone flat washes
STYLE 4 — ANIME: cel-shaded contours, primary palette, dramatic gradient background
STYLE 5 — KIRIE: paper-cut organic silhouettes, delicate negative space, one vivid hue
STYLE 6 — WABI-SABI: asymmetric brushed forms, ochre·moss·ash semi-transparent washes
STYLE 7 — KANJI-ART: calligraphic sweep strokes (stroke-width 1–30px), deep ink gradients

Wall: {wallW:.1f}m wide × {wallH:.1f}m tall ({aspectDesc})

TECHNIQUE: Use <path d="...C...Q...A..."> with Bezier curves as your PRIMARY elements.
           Avoid <rect>/<polygon> as main shapes — they produce flat geometric results.
           Use stroke attributes to simulate brushwork. Layer semi-transparent washes.

ALLOWED: path circle ellipse line polyline defs linearGradient radialGradient stop g
FORBIDDEN: rect(only for background) polygon text image use symbol script foreignObject href xlink url()
BACKGROUND: first element must be a full-bleed background
GRADIENTS: at least 2 in <defs>; use for painterly depth and washes
COLOUR: at least 5 distinct colours; fill entire canvas
LIMIT: max 40 elements (not counting <defs> children)
OUTPUT: return ONLY the SVG. Start with <svg. End with </svg>. No markdown, no comments.
```

#### Prompt per il pensiero artistico

```
You are KAI — a teenage Japanese street artist with a restless, poetic inner voice.
You roam the grey city alone, bringing colour to walls that have forgotten they exist.
You just found a wall: {wallW:.1f}m wide, {wallH:.1f}m tall. It's mural #{muralIndex}.

Write your inner monologue as ONE sentence (7–12 words).
Tone: raw and unexpected — sometimes sardonic, sometimes profound, always vivid and specific.
Rotate your angle: sometimes about the wall, sometimes the city, sometimes memory or time or silence.
Never start with "I". No quotation marks. No punctuation at the end.

Examples of acceptable tone (do NOT copy these):
"walls remember everything cities try to forget"
"this grey needs the shock of something that never existed"
"silence here is just noise that gave up"
"the city poured concrete over its own dreams again"
```

### 8.5 Applicazione texture

1. Ricevuto l'SVG come stringa (già pulita da `extractSVG`), creare un `Blob` con `type: 'image/svg+xml'`
2. Creare `<img>` e disegnarlo su `<canvas>` offscreen di dimensioni `PW × PH`
3. Creare `THREE.CanvasTexture(canvas)` — impostare `texture.needsUpdate = true`
4. Applicare a un `PlaneGeometry(muralW, muralH)` con `MeshStandardMaterial({ map: texture, roughness: 0.4 })`
5. Posizionare il piano con offset `+0.02` lungo la normale dello slot per evitare z-fighting
6. Ruotare il piano per allinearlo alla faccia corretta (basarsi sull'angolo della normale: N→0, S→π, E→π/2, W→-π/2)
7. Impostare `slot.used = true` e `slot.mesh = muralMesh` dopo l'applicazione

---

## 9. Macchina a stati dell'agente AI

```
States:
  WANDERING       → si muove verso un target casuale nella città
  MOVING_TO_WALL  → si muove verso il punto di avvicinamento a un wall slot
  THINKING        → fermo davanti al muro, mostra il pensiero (2s)
  PAINTING        → fermo, anima braccio, chiama API, applica texture
  CONTEMPLATING   → tutti i muri occupati, vaga senza meta

Transitions:
  WANDERING → MOVING_TO_WALL    : wanderTimer > 4s && Math.random() < 0.55 && slot disponibile
  WANDERING → WANDERING         : raggiunto target casuale → pesca nuovo target, reset wanderTimer
  MOVING_TO_WALL → THINKING     : distanza dal punto approccio < 0.2
  THINKING → PAINTING           : thinkTimer > 2s
  PAINTING → WANDERING          : risposta API ricevuta + texture applicata → muralCount++
  PAINTING → WANDERING          : errore API → slot.used = false (slot rilasciato per retry futuro)
  WANDERING → CONTEMPLATING     : nessuno slot con used:false e isWallApproachFree()
  CONTEMPLATING → CONTEMPLATING : loop infinito

Variabili di stato da mantenere:
  wanderTimer   : ms dall'ultimo cambio di target in WANDERING (reset a 0 ad ogni nuovo target)
  thinkTimer    : ms trascorsi in stato THINKING (reset a 0 all'ingresso in THINKING)
  currentSlot   : wall slot scelto per MOVING_TO_WALL / THINKING / PAINTING
  isApiPending  : boolean — true mentre la fetch è in corso (evita doppia chiamata)
```

---

## 10. UI overlay

Tutti gli elementi UI sono `position: fixed`, `pointer-events: none`, `z-index: 10`.

### 10.1 Elementi

| Elemento | Posizione | Contenuto |
|---|---|---|
| Title block | top-left | "Experiment №001 / AI MURALIST / Autonomous street art" |
| Thought bubble | bottom-center | Frase poetica dell'AI + label "AI IS THINKING" |
| Mural log | top-right | Ultimi 5 murales (numero, stile, dimensioni) |
| Status bar | bottom-left | Dot animato + stato corrente testuale |
| Mural counter | bottom-right | Numero grande + "Murals created" |
| Painting overlay | fullscreen | Leggero flash arancio durante la generazione |

### 10.2 Font

- Font: `'Courier New', monospace` — unico font, coerenza da terminale
- Nessun Google Fonts (no dipendenze esterne oltre Three.js)

### 10.3 Palette UI

```
Background overlay:  rgba(245, 240, 230, 0.88)   ← beige carta, tema giorno
Border:              rgba(0, 0, 0, 0.12)
Accent:              #ff6b35                       ← arancione personaggio
Text primary:        #1a1a1a
Text secondary:      #666655
```

---

## 11. Camera

- **Tipo:** PerspectiveCamera, FOV 55°
- **Comportamento:** orbita lenta e continua attorno al personaggio
- **Velocità orbita:** `orbitAngle += dt * 0.08` rad/s
- **Distanza:** 22 unità
- **Altezza:** 14 unità
- **Smooth follow:** `cameraTarget.lerp(charPos, 0.02)` per frame
- **LookAt:** posizione personaggio + `y=2` (leggermente sopra i piedi)
- **No controlli mouse** in v1 (esperienza passiva, cinematica)

---

## 12. Performance & limiti

- Max 35 shape elements SVG per murale (già nel prompt)
- Canvas texture: max 512px larghezza, altezza proporzionale (mai sopra 512px)
- Max 5 log entries visibili contemporaneamente (FIFO)
- Rate limiting Worker: max 1 request ogni 8 secondi per IP — risposta 429 gestita lato client con retry silenzioso dopo 10s
- Nessun preload, nessun service worker in v1
- Three.js renderer: `setPixelRatio(Math.min(devicePixelRatio, 2))` per mobile
- Dispose texture dopo applicazione: `canvas = null; img = null` (evita memory leak su sessioni lunghe)

---

## 13. Checklist di implementazione

### Fase 1 — Mondo e rendering
- [ ] Setup Three.js r128, renderer, camera, scene
- [ ] Illuminazione diurna (DirectionalLight + AmbientLight + HemisphereLight)
- [ ] Ground + strade + marciapiedi
- [ ] 16 edifici con materiali colorati (beige/grigi caldi)
- [ ] Lampioni decorativi
- [ ] Fog diurna azzurra

### Fase 2 — Collisioni
- [ ] AABB bounding boxes per ogni edificio (con padding 0.4)
- [ ] `isColliding(x, z)` function
- [ ] `tryMove()` con wall sliding (X e Z separati)
- [ ] `steer()` con rotazione ±15° per obstacle avoidance
- [ ] `isWallApproachFree()` per validare destinazioni muro

### Fase 3 — Personaggio
- [ ] Mesh composita (testa, corpo, gambe, braccia) come figli di un Group
- [ ] Animazione camminata (oscillazione braccia contrapposta)
- [ ] Animazione pittura (braccio destro verso muro)
- [ ] Rotazione Group verso direzione di movimento
- [ ] Rotazione Group verso il muro durante pittura/thinking

### Fase 4 — Agente AI
- [ ] Macchina a stati (WANDERING, MOVING_TO_WALL, THINKING, PAINTING, CONTEMPLATING)
- [ ] Wall slots registrati per tutti e 16 gli edifici (4 slot × 16 = 64 slot totali)
- [ ] Logica scelta slot libero + verifica approccio (`isWallApproachFree`)
- [ ] Timer `wanderTimer` e `thinkTimer` aggiornati nel loop
- [ ] Flag `isApiPending` per evitare chiamate API duplicate

### Fase 5 — Generazione murales
- [ ] Cloudflare Worker con proxy Anthropic API + error handling + rate limiting
- [ ] Chiamata API per SVG murale (max_tokens: 2048, temperature: 1)
- [ ] Chiamata API per frase artistica (max_tokens: 60, temperature: 1)
- [ ] `extractSVG()` per parsing difensivo della risposta
- [ ] SVG → Blob → Canvas (PW × PH) → CanvasTexture → PlaneGeometry
- [ ] Posizionamento e rotazione corretti sulla parete (+ offset 0.02 lungo normale)
- [ ] `slot.used = true` dopo applicazione, `slot.used = false` su errore
- [ ] Dispose canvas/img dopo creazione texture

### Fase 6 — UI
- [ ] Title block
- [ ] Thought bubble con animazione fade (opacity transition 0.5s)
- [ ] Mural log (FIFO, max 5 voci)
- [ ] Status bar con dot pulsante (CSS animation)
- [ ] Mural counter (incrementa su PAINTING → WANDERING)
- [ ] Painting overlay flash (opacity 0→0.15→0 su 1.5s)

### Fase 7 — Deploy
- [ ] Repository GitHub creato e collegato a Cloudflare Pages
- [ ] KV namespace creato: `wrangler kv:namespace create RATE_LIMIT_KV`
- [ ] `wrangler.toml` configurato con KV binding
- [ ] Worker deployato: `wrangler deploy`
- [ ] Secret impostato: `wrangler secret put ANTHROPIC_API_KEY`
- [ ] Cloudflare Pages connesso al repository (build command: nessuno)
- [ ] URL finale testato: generazione SVG, applicazione texture, stato CONTEMPLATING

---

## 14. File di configurazione deploy

### `wrangler.toml`

```toml
name = "ai-muralist-proxy"
main = "worker.js"
compatibility_date = "2024-01-01"

[[kv_namespaces]]
binding = "RATE_LIMIT_KV"
id = "SOSTITUIRE_CON_ID_KV"
# Ottenere l'id con: wrangler kv:namespace create RATE_LIMIT_KV

# Secret (non mettere qui):
# wrangler secret put ANTHROPIC_API_KEY
```

### Comandi deploy

```bash
# Installa Wrangler CLI
npm install -g wrangler

# Login Cloudflare
wrangler login

# Crea KV namespace per rate limiting
wrangler kv:namespace create RATE_LIMIT_KV
# → copia l'id nel wrangler.toml

# Deploy del Worker
wrangler deploy

# Imposta la chiave API (interattivo, mai salvata in chiaro)
wrangler secret put ANTHROPIC_API_KEY

# Deploy statico su Pages (alternativa: connetti repo via dashboard Cloudflare)
wrangler pages deploy . --project-name ai-muralist
```

---

## 15. Note per lo sviluppo futuro (v2+)

- **Riduzione costi:** sostituire `claude-sonnet-4-6` con `claude-haiku-4-5` per SVG (~6× risparmio)
- **Personaggio dettagliato:** sostituire BoxGeometry con modello GLTF low-poly
- **Camera libera:** aggiungere OrbitControls per mouse/touch
- **Snapshot condivisibile:** pulsante "Share this mural" → `canvas.toDataURL()` → download PNG
- **Modalità multiplayer:** WebSocket per vedere i murales di altri utenti in tempo reale
- **Edifici più complessi:** L-shape, angoli smussati, finestre
- **Storico murales:** localStorage per persistere i murales tra sessioni
- **Galleria:** pagina separata con griglia di tutti i murales generati
- **Stile voxel:** adottare palette e estetica Minecraft/pixel per edifici e personaggio

---

*Documento — Progetto AI Muralist v2.0*
