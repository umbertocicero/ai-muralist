# AI Muralist — Master Prompt & Architecture Document

> Versione 1.0 — Documento di specifiche completo per lo sviluppo del progetto.  
> Questo file è il prompt da consegnare all'AI per costruire l'applicazione da zero.

---

## 1. Concept

**AI Muralist** è un esperimento web virale: un agente AI autonomo si muove in una città 3D in miniatura e decide spontaneamente di dipingere murales sulle pareti degli edifici. Ogni murale è un'opera d'arte generata in tempo reale da un modello AI (Claude), unica e irripetibile. L'esperimento gira in loop infinito nel browser — nessun intervento umano richiesto.

**Obiettivo virale:** chi apre il sito vede un piccolo omino arancione camminare per la città, avvicinarsi a una parete, e lì appare un murale generato dall'AI. È ipnotico, condivisibile, e dimostra l'autonomia creativa dell'intelligenza artificiale.

---

## 2. Stack tecnico

| Layer | Tecnologia | Note |
|---|---|---|
| Rendering 3D | **Three.js r128** (CDN) | Nessun bundler, file HTML singolo |
| AI murales | **Anthropic Claude API** (`claude-sonnet-4-6`) | SVG generato on-demand |
| AI pensieri | **Anthropic Claude API** (`claude-sonnet-4-6`) | Frase poetica dell'artista |
| Backend | **Nessuno** | Tutto client-side tranne proxy API |
| Deploy | **Cloudflare Pages** (free tier) | Hosting statico |
| API proxy | **Cloudflare Workers** (free tier) | Nasconde la chiave API |
| Dominio | **pages.dev** (gratuito) | Nessun costo dominio |

**Perché zero backend:** l'app è un singolo file HTML + un Cloudflare Worker di 20 righe. Nessun server, nessun database, zero costi operativi.

---

## 3. Architettura di deploy

```
Browser
  │
  ├── Carica  ai-muralist/index.html  (Cloudflare Pages — free)
  │     │
  │     └── Three.js via CDN (cdnjs.cloudflare.com)
  │
  └── Chiama  /api/claude  (Cloudflare Worker — free)
        │
        └── Anthropic API  (api.anthropic.com/v1/messages)
              └── Restituisce SVG murale + frase artistica
```

### 3.1 Cloudflare Pages (hosting)

- Repository GitHub → connesso a Cloudflare Pages
- Build command: nessuno (file statici)
- Output directory: `/` (o `/dist`)
- URL automatico: `https://ai-muralist.pages.dev`
- **Costo: $0**

### 3.2 Cloudflare Worker (API proxy)

File: `worker.js`

```javascript
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      });
    }

    const body = await request.json();

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    return new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });
  }
};
```

- Secret `ANTHROPIC_API_KEY` configurato nel dashboard Cloudflare (mai esposto al client)
- Free tier: 100.000 request/giorno — ampiamente sufficiente
- **Costo: $0**

### 3.3 Stima costi Anthropic API

| Evento | Token stimati | Costo per evento |
|---|---|---|
| Generazione SVG murale | ~800 output | ~$0.0024 |
| Generazione frase artistica | ~80 output | ~$0.00024 |
| **Totale per murale** | | **~$0.0026** |

Con 1.000 visitatori al giorno che guardano 3 murales ciascuno → ~$8/giorno. Gestibile con rate limiting nel Worker.

---

## 4. Struttura file di progetto

```
ai-muralist/
├── index.html          ← app completa (Three.js + logica agente)
├── worker.js           ← Cloudflare Worker (API proxy)
├── wrangler.toml       ← config deploy Worker
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
  shadow.mapSize: 2048x2048

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

Esempio posizioni edifici (x, z):
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
function steer(charPos, target) {
  const dir = new THREE.Vector3(
    target.x - charPos.x, 0,
    target.z - charPos.z
  ).normalize();

  for (let attempt = 0; attempt < 12; attempt++) {
    const angle = (attempt % 2 === 0 ? 1 : -1) * Math.floor(attempt / 2) * (Math.PI / 12);
    const rotated = rotateY2D(dir, angle);
    const dx = rotated.x * moveSpeed;
    const dz = rotated.z * moveSpeed;

    const nextX = charPos.x + dx;
    const nextZ = charPos.z + dz;

    if (!isColliding(nextX, nextZ)) {
      charPos.x = nextX;
      charPos.z = nextZ;
      return true;
    }
  }
  return false; // completamente bloccato
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
  const offset = 1.5;
  const px = slot.px - slot.nx * offset;
  const pz = slot.pz - slot.nz * offset;
  return !isColliding(px, pz);
}
```

---

## 7. Personaggio (omino)

### 7.1 Geometria

Costruire con primitive Three.js (BoxGeometry):

```
Testa:    0.4 × 0.4 × 0.4   y=1.55   colore: #ffd6b0
Corpo:    0.5 × 0.7 × 0.3   y=0.90   colore: #ff6b35 (arancione, icona dell'esperimento)
Gamba sx: 0.2 × 0.5 × 0.25  y=0.30   x=-0.13   colore: #2d2d44
Gamba dx: 0.2 × 0.5 × 0.25  y=0.30   x=+0.13   colore: #2d2d44
Braccio sx: 0.18 × 0.5 × 0.2  y=0.85  x=-0.38   colore: #ff6b35
Braccio dx: 0.18 × 0.5 × 0.2  y=0.85  x=+0.38   colore: #ff6b35
```

### 7.2 Animazioni

- **Camminata:** braccia oscillano in opposizione (`sin(t*4)*0.4` rad) su asse X
- **Testa:** leggero bob verticale (`sin(t*8)*0.015`)
- **Pittura:** braccio destro oscilla verso il muro (`sin(t*6)*0.6 - 0.3` rad)
- **Idle (pensiero):** piccola oscillazione lenta della testa (`sin(t)*0.05` rad Y)

### 7.3 Constraint: no volo

Il personaggio è sempre a `y = 0` (ground level). Nessuna forza verticale. Gravità non simulata (non serve).

---

## 8. Sistema murales

### 8.1 Wall slots

Per ogni edificio, registrare 4 slot parete (N, S, E, W). Ogni slot ha:

```javascript
{
  px, py, pz,           // posizione centro parete
  nx, nz,               // normale (direzione verso l'esterno)
  wallW, wallH,         // dimensioni parete (w = larghezza, h = altezza edificio)
  buildingIdx,          // riferimento all'edificio
  used: false,          // flag: murale già presente
  mesh: null            // riferimento al Mesh Three.js del murale
}
```

### 8.2 Dimensioni murale

Il murale copre l'**88% della larghezza** e l'**85% dell'altezza** della parete. Queste proporzioni sono fisse e calcolate automaticamente dalla dimensione del wall slot.

```javascript
const muralW = slot.wallW * 0.88;
const muralH = slot.wallH * 0.85;
```

### 8.3 Regola di non sovrascrittura

Un wall slot con `used: true` non può ricevere un secondo murale. L'AI sceglie **sempre** uno slot `used: false`. Quando tutti gli slot sono occupati, l'omino continua a vagare ma non dipinge più (stato "contemplazione").

### 8.4 Generazione SVG via Claude API

**Endpoint:** `POST /api/claude` (Cloudflare Worker proxy)

**Prompt per il murale:**

```
You are an AI street artist. Generate an SVG mural ({pw}x{ph}px, {aspectDesc} wall).

Rules:
- Pure SVG, no external images, no <text> elements
- Bold graphic style: geometric shapes, gradients, abstract or figurative art
- Vivid colors, high contrast, urban energy
- Fill the entire canvas edge to edge
- Maximum 40 SVG elements for browser performance
- Each mural must be visually unique — vary style drastically each time
- Styles to rotate through: geometric abstraction, pixel art, organic forms,
  op-art, surrealism, urban iconography, nature motifs

Return ONLY the SVG code starting with <svg and ending with </svg>.
No explanation, no markdown fences, no comments.
```

**Prompt per il pensiero artistico:**

```
You are an AI street artist wandering a city at daytime.
You just found a blank wall ({wallW}m wide, {wallH}m tall).
Write ONE sentence (max 10 words) expressing your artistic intention.
Raw, poetic, direct. No quotes. No punctuation at end.
```

### 8.5 Applicazione texture

1. Ricevuto l'SVG come stringa, creare un `Blob` con `type: 'image/svg+xml'`
2. Creare `<img>` e disegnarlo su `<canvas>` offscreen (dimensioni `pw × ph`)
3. Creare `THREE.CanvasTexture` dal canvas
4. Applicare a un `PlaneGeometry(muralW, muralH)` con `MeshStandardMaterial`
5. Posizionare il piano sulla parete con offset `+0.02` lungo la normale per evitare z-fighting
6. Ruotare il piano per allinearlo alla faccia corretta dell'edificio

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
  WANDERING → MOVING_TO_WALL    : wanderTimer > 4s && random() < 0.55 && slot disponibile
  WANDERING → WANDERING         : raggiunto target, pesca nuovo target casuale
  MOVING_TO_WALL → THINKING     : distanza dal punto approccio < 0.2
  THINKING → PAINTING           : timeout 2s
  PAINTING → WANDERING          : API risposta ricevuta + texture applicata
  PAINTING → WANDERING          : API errore (slot rilasciato, slot.used = false)
  WANDERING → CONTEMPLATING     : nessun slot disponibile
  CONTEMPLATING → CONTEMPLATING : loop infinito fino a reset manuale
```

---

## 10. UI overlay

Tutti gli elementi UI sono `position: fixed`, `pointer-events: none`, `z-index: 10`.

### 10.1 Elementi

| Elemento | Posizione | Contenuto |
|---|---|---|
| Title block | top-left | "Experiment №001 / AI MURALIST / Autonomous street art" |
| Thought bubble | bottom-center | Frase poetica dell'AI + label "AI IS THINKING" |
| Mural log | top-right | Ultimi 5 murales (numero, titolo, dimensioni) |
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
- **Velocità orbita:** `+= dt * 0.08` rad/s
- **Distanza:** 22 unità
- **Altezza:** 14 unità
- **Smooth follow:** lerp verso posizione target con factor `0.02`
- **LookAt:** posizione personaggio + y=2 (guarda leggermente sopra i piedi)
- **No controlli mouse** in v1 (esperienza passiva, cinematica)

---

## 12. Performance & limiti

- Max 40 elementi SVG per murale (già nel prompt)
- Texture canvas: max 512×512px per murale
- Max 5 log entries visibili contemporaneamente (FIFO)
- Rate limiting nel Worker: max 1 request ogni 8 secondi per IP (evita abuse)
- Nessun preload, nessun service worker in v1
- Three.js renderer: `setPixelRatio(Math.min(devicePixelRatio, 2))` per mobile

---

## 13. Checklist di implementazione

### Fase 1 — Mondo e rendering
- [ ] Setup Three.js, renderer, camera, scene
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
- [ ] Mesh composita (testa, corpo, gambe, braccia)
- [ ] Animazione camminata (oscillazione braccia)
- [ ] Animazione pittura (braccio destra verso muro)
- [ ] Rotazione verso direzione di movimento
- [ ] Rotazione verso il muro durante pittura

### Fase 4 — Agente AI
- [ ] Macchina a stati (WANDERING, MOVING_TO_WALL, THINKING, PAINTING, CONTEMPLATING)
- [ ] Wall slots registrati per tutti gli edifici
- [ ] Logica scelta slot libero + verifica approccio
- [ ] Timer e soglie per transizione stati

### Fase 5 — Generazione murales
- [ ] Cloudflare Worker con proxy Anthropic API
- [ ] Chiamata API per SVG murale
- [ ] Chiamata API per frase artistica
- [ ] SVG → Blob → Canvas → CanvasTexture → PlaneGeometry
- [ ] Posizionamento e rotazione corretti sulla parete
- [ ] Flag `used: true` dopo applicazione

### Fase 6 — UI
- [ ] Title block
- [ ] Thought bubble con animazione fade
- [ ] Mural log (FIFO, max 5)
- [ ] Status bar con dot pulsante
- [ ] Mural counter
- [ ] Painting overlay flash

### Fase 7 — Deploy
- [ ] Repository GitHub creato
- [ ] `wrangler.toml` configurato
- [ ] Worker deployato su Cloudflare (`wrangler deploy`)
- [ ] Secret `ANTHROPIC_API_KEY` impostato (`wrangler secret put ANTHROPIC_API_KEY`)
- [ ] Cloudflare Pages connesso al repository
- [ ] URL finale testato

---

## 14. File di configurazione deploy

### `wrangler.toml`

```toml
name = "ai-muralist-proxy"
main = "worker.js"
compatibility_date = "2024-01-01"

[vars]
# Non mettere la API key qui — usare: wrangler secret put ANTHROPIC_API_KEY
```

### Comandi deploy

```bash
# Installa Wrangler CLI
npm install -g wrangler

# Login Cloudflare
wrangler login

# Deploy del Worker
wrangler deploy

# Imposta la chiave API (interattivo, non salvata in chiaro)
wrangler secret put ANTHROPIC_API_KEY

# Deploy statico su Pages (alternativa: connetti repo via dashboard)
wrangler pages deploy . --project-name ai-muralist
```

---

## 15. Note per lo sviluppo futuro (v2+)

- **Personaggio dettagliato:** sostituire BoxGeometry con modello GLTF low-poly
- **Stile Minecraft/pixel art:** adottare palette e estetica voxel (vedi skill `minecraft-pixel`)
- **Camera libera:** aggiungere OrbitControls per mouse/touch
- **Snapshot condivisibile:** pulsante "Share this mural" → canvas.toDataURL() → download PNG
- **Modalità multiplayer:** WebSocket per vedere i murales di altri utenti in tempo reale
- **Edifici più complessi:** L-shape, angoli smussati, finestre
- **Storico murales:** localStorage per persistere i murales tra sessioni
- **Galleria:** pagina separata con griglia di tutti i murales generati
- **Personalizzazione:** slider per velocità agente, palette artistica preferita

---

*Documento generato da Claude Sonnet 4.6 — Progetto AI Muralist v1.0*
