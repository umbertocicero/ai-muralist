# AI Muralist — Master Prompt & Architecture Document

> Versione 2.0 — Documento di specifiche completo per lo sviluppo del progetto.
> Questo file è il prompt da consegnare all'AI per costruire l'applicazione da zero.

---

## 1. Concept

**AI Muralist** è un esperimento web virale: un agente AI autonomo di nome **MURO** si muove in una città 3D in miniatura e decide spontaneamente di dipingere murales sulle pareti degli edifici. Ogni murale è un'opera d'arte SVG generata in tempo reale da Claude, unica e irripetibile. L'esperimento gira in loop infinito nel browser — nessun intervento umano richiesto.

**Obiettivo virale:** chi apre il sito vede un piccolo omino arancione camminare per la città, avvicinarsi a una parete, e lì appare un murale generato dall'AI. È ipnotico, condivisibile, e dimostra l'autonomia creativa dell'intelligenza artificiale.

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

## 5. Specifiche mondo 3D

### 5.1 Ambientazione

- **Ora del giorno:** giorno soleggiato (non notte)
- **Atmosfera:** cielo azzurro chiaro (`#87CEEB`), luce solare diurna calda
- **Fog:** leggera nebbia distanza (`#c9e8f5`, da 40 a 90 unità)
- **Ground:** grigio asfalto chiaro (`#9a9a9a`), con strade più scure

### 5.2 Illuminazione

```
DirectionalLight (sole):
  color: #fff5e0
  intensity: 1.8
  position: (50, 80, 30)
  castShadow: true
  shadow.mapSize: 2048×2048

AmbientLight (cielo):
  color: #c9dff0
  intensity: 0.9

HemisphereLight:
  skyColor: #87CEEB
  groundColor: #6b8e6b
  intensity: 0.4
```

### 5.3 Edifici

- **Stile:** parallelepipedi semplici (BoxGeometry) — no dettagli architettonici
- **Altezza:** massimo 6–7 unità (edifici bassi, v1)
- **Colori:** variazione di grigi caldi e beige (`#d4c9b8`, `#c2b9a7`, `#b8c4c2`, `#cfc8be`)
- **Numero:** 16 edifici disposti in una griglia urbana con strade ortogonali
- **Materiale:** MeshStandardMaterial, roughness 0.85, nessuna reflettività

### 5.4 Layout urbano

```
Strade principali: asse X e asse Z (larghezza 6 unità)
Strade secondarie: a -20 e +20 su entrambi gli assi
Isolati: 4 edifici per isolato, disposti agli angoli

Posizioni edifici (x, z):
(-12,-12), (12,-12), (-12,12), (12,12)    ← isolato centrale
(-30,-12), (-30,12), (30,-12), (30,12)    ← isolati laterali
(-12,-30), (12,-30), (-12,30), (12,30)    ← isolati superiori/inferiori
(-30,-30), (30,-30), (-30,30), (30,30)    ← angoli
```

### 5.5 Dettagli scenici

- Lampioni (CylinderGeometry sottile + sfera emissiva) ogni 3 edifici
- Marciapiedi (PlaneGeometry rialzata di 0.05) lungo le strade principali
- Nessun veicolo, nessun NPC aggiuntivo in v1

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

## 7. Personaggio (omino)

### 7.1 Geometria

Costruire con primitive Three.js (BoxGeometry). Tutti i mesh sono figli di un `THREE.Group` radice centrato ai piedi del personaggio (y=0):

```
Testa:      0.4 × 0.4 × 0.4   y=1.55   colore: #ffd6b0
Corpo:      0.5 × 0.7 × 0.3   y=0.90   colore: #ff6b35  ← arancione icona
Gamba sx:   0.2 × 0.5 × 0.25  y=0.30   x=-0.13   colore: #2d2d44
Gamba dx:   0.2 × 0.5 × 0.25  y=0.30   x=+0.13   colore: #2d2d44
Braccio sx: 0.18 × 0.5 × 0.2  y=0.85   x=-0.38   colore: #ff6b35
Braccio dx: 0.18 × 0.5 × 0.2  y=0.85   x=+0.38   colore: #ff6b35
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
You are MURO, an autonomous AI street artist with a distinctive visual voice.
Generate an SVG mural for a {aspectDesc} wall.

Canvas: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {PW} {PH}" width="{PW}" height="{PH}">
Wall physical size: {wallW:.1f}m wide × {wallH:.1f}m tall
This is mural #{muralIndex}. Use ({muralIndex} % 8) to select your style:

STYLE 0 — BAUHAUS: rigid geometry, bold primary palette + black/white, asymmetric balance
STYLE 1 — ORGANIC: biomorphic flowing shapes, earthy palette with vivid accents
STYLE 2 — PIXEL: strict 8×8 grid, retro 8-color palette, hard pixel edges
STYLE 3 — OP-ART: tessellated pattern, optical illusion depth, high-contrast B&W + one accent color
STYLE 4 — SURREAL: impossible scale, dreamlike juxtapositions, rich saturated 6-color palette
STYLE 5 — GRAFFITI: letterforms dissolved into pure abstract shapes, spray-paint gradients, urban energy
STYLE 6 — COSMOS: nebulae, planets, star fields, deep space gradients, bioluminescent accents
STYLE 7 — BOTANICAL: stylized flora, organic tessellation, seasonal palette

HARD RULES — follow exactly:
• Allowed SVG elements: <rect> <circle> <ellipse> <polygon> <polyline> <path> <line> <defs> <linearGradient> <radialGradient> <stop> <g>
• FORBIDDEN: <text> <image> <use> <symbol> <script> <foreignObject> and any href= xlink: url() references
• First element inside <svg> MUST be a full-bleed background covering the entire viewBox
• Include at least 2 gradient definitions in <defs>
• Use at least 5 distinct fill/stroke colors
• Maximum 35 shape elements (not counting <defs> children)
• Fill the entire canvas — leave no raw white space
• Make every composition feel intentional and complete — foreground, midground, background

OUTPUT: return ONLY the SVG. Start with <svg. End with </svg>. No explanation, no markdown, no comments.
```

#### Prompt per il pensiero artistico

```
You are MURO — an AI street artist with a restless, poetic inner voice.
You roam the city alone, treating blank walls as pages the world forgot.
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
