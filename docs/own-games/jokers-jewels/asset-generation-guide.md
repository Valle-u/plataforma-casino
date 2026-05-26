# Joker's Jewels · Asset Generation Guide

> Guía operativa para generar los assets visuales del slot con IA.
> Camino B del Sprint 2A.x (decidido 2026-05-25).

Sub-fase intermedia entre **2A** (UI con SVGs hechos a mano) y **2B** (animaciones). El objetivo: reemplazar los 8 SVGs simples por **ilustraciones premium generadas con IA** + frame profesional + background con textura.

---

## 1. Stack elegido: Midjourney v7

**Decisión del usuario (2026-05-26)**: usar **Midjourney** después de probar FLUX.1 schnell (errores ZeroGPU recurrentes en HuggingFace Space y calidad inconsistente para forzar estilo 2D cell-shaded).

- **Costo**: $10/mes plan Basic (~200 generaciones rápidas + relax mode ilimitado). Suficiente para los 10 assets + iteración.
- **Calidad**: la más alta del mercado para sprites premium, especialmente con `--style raw` para evitar el sesgo "artístico" default.
- **Acceso**:
  - https://www.midjourney.com/account — suscripción.
  - Discord oficial (comando `/imagine`) o web app https://www.midjourney.com/imagine.
- **Versión recomendada**: **v7** (lo último al 2026-05). Si v7 queda demasiado estilizado o pierde fidelidad al prompt, caer a v6.1.

### Workflow Midjourney en Discord

1. Ir a cualquier canal `#newbies-N` del server oficial (o canal privado si tenés Pro).
2. Escribir: `/imagine prompt: <prompt completo del símbolo + flags>`
3. Esperar ~60s. MJ genera **4 variaciones** automáticamente en una sola grilla 2x2.
4. Botones debajo: `U1-U4` (upscale = elegir una variación a alta resolución), `V1-V4` (variación adicional sobre una elegida), `🔄` (regenerar todo con seed nuevo).
5. Hacer `U` sobre la mejor, después click en la imagen → "Open in browser" → descargar.

### Flags Midjourney que vamos a usar siempre

| Flag | Valor | Por qué |
|---|---|---|
| `--ar 1:1` | aspect ratio cuadrado | Símbolos son 512×512. |
| `--v 7` | versión 7 | Mejor coherencia y respeto al prompt. |
| `--style raw` | desactiva el preset "artístico" de MJ | Crítico para que respete `flat 2D vector` y no agregue floritura cinematográfica. |
| `--s 100` | stylize medio | Más bajo = más fiel al prompt. Default es 100, dejar ahí. Si MJ se va de mambo subir a 50. |
| `--no text, letters, numbers, watermark, signature` | negativos | Evita que invente tipografía. |

**Suffix completo para los 8 símbolos**:
```
--ar 1:1 --v 7 --style raw --s 100 --no text, letters, numbers, watermark
```

Para el **frame** (§3.9): cambiar `--ar 1:1` por `--ar 4:3`.

Para el **backboard** (§3.10): cambiar `--ar 1:1` por `--ar 1:1 --tile` (el flag `--tile` genera patrones seamless reales que se pueden tilear sin costura).

### Fallback si MJ no alcanza para un símbolo puntual

- **DALL-E 3** vía ChatGPT Plus ($20/mes) — mejor para iconos limpios con texto, peor para sprites de juego.
- **FLUX.1 schnell** gratis (HuggingFace) — backup si MJ está saturado.

---

## 2. Especificaciones técnicas comunes

Todos los assets deben cumplir:

| Spec | Valor |
|---|---|
| Formato output | PNG con canal alpha (fondo transparente) |
| Resolución símbolos | 512×512 px |
| Resolución frame/background | 2048×1536 px (escala 4:3) |
| Color depth | 8-bit por canal (24-bit color + 8-bit alpha) |
| Naming convention | `<symbol-code>.png` (joker.png, crown.png, etc.) |
| Ubicación final | `apps/games/jokers-jewels/public/assets/symbols/<code>.png` |

**Workflow típico por asset**:
1. Generar con el prompt.
2. Si el fondo no quedó transparente, usar https://remove.bg (gratis hasta 1 imagen/día) o Photopea.
3. Recortar al cuadrado 512×512 (centrado en el sujeto).
4. Guardar como PNG en el path final.

---

## 3. Prompts — calibrados para Midjourney v7 + match exacto al Joker's Jewels original

> **Importante**: Midjourney v7 por default tiende al estilo "cinematográfico/artístico". Con `--style raw` y prompts explícitos en `flat 2D vector` lo controlamos. Si una generación sale demasiado realista o con efectos de cámara, bajar `--s` a 50 o forzar `--style raw` (ya está en el suffix base).

### Tips de uso para Midjourney v7

- **Suffix base obligatorio** (pegar al final de cada prompt de símbolo): `--ar 1:1 --v 7 --style raw --s 100 --no text, letters, numbers, watermark`
- **Genera 4 variaciones por tirada**: ideal — no hace falta regenerar varias veces para ver variantes.
- **U vs V**: `U1-U4` = upscale a alta resolución (descargar esta). `V1-V4` = nueva variación basada en esa imagen (útil si te gusta una pero querés ajustarla).
- **Reproducibilidad**: si una imagen te encanta y querés más como esa, copiá el `--seed` que MJ usa (lo ves en la metadata de la imagen) y reusalo en el siguiente prompt con `--seed <numero>`.
- **Background transparente**: MJ **NO genera transparencia nativa**. Vas a tener que pasar cada imagen por https://remove.bg después. Por eso los prompts piden `plain neutral background` (blanco/gris), no `transparent background`.
- **Coherencia entre símbolos**: usar `--sref <URL>` con la imagen del joker (después de elegida) como referencia de estilo para los siguientes símbolos. Ej: cuando vas a generar la corona, pasale el sref del joker para que MJ mantenga el mismo estilo cell-shaded.

### Estilo base compartido (referencia mental)

Todos los 8 símbolos deben verse como pertenecientes al mismo juego: ilustración 2D vectorial, **outlines negros gruesos** estilo cell-shading premium, colores **saturados y vibrantes**, **pequeños brillos blancos** tipo estrella, **NO 3D**, **NO foto-realista**, composición centrada, fondo plano neutro.

---

### Mapping ARCHIVO ↔ CÓDIGO ↔ REFERENCIA

| Archivo PNG final | `SymbolCode` en código | Referencia visual del usuario |
|---|---|---|
| `joker.png` | `joker` | `joker-jewells-imgs/joker.png` |
| `crown.png` | `crown` | `joker-jewells-imgs/corona.png` |
| `mandolin.png` | `mandolin` | `joker-jewells-imgs/mandolin.png` |
| `boots.png` | `boots` | `joker-jewells-imgs/botas.png` |
| `bolos.png` | `bolos` | `joker-jewells-imgs/bolos.png` |
| `ruby.png` | `ruby` | `joker-jewells-imgs/ruby.png` |
| `sapphire.png` | `sapphire` | `joker-jewells-imgs/diamante.png` (gema cyan octagonal) |
| `emerald.png` | `emerald` | `joker-jewells-imgs/sapphire.png` (orbe azul esférico) |

> ⚠️ El naming `sapphire` ↔ cyan y `emerald` ↔ azul-orbe es histórico del código. **No cambiar**.

---

### 3.1 Joker (wild) — máscara femenina con cuello en estrella

```
2D vector illustration, premium mobile slot machine symbol, single elegant female jester mask portrait centered, smooth pale white ceramic mask face with subtle shading, large almond eyes with bright golden yellow eyeshadow on upper lids extending diagonally toward the temples in a curved diamond shape and small red curved teardrop marks below the eyes, thin elegant nose, full bright red heart-shaped lips with subtle smile, jet black eyebrows raised playfully, wearing a three-pointed jester hat with the LEFT point in royal blue, MIDDLE point in golden yellow, RIGHT point in bright red, each hat tip has a small round golden bell hanging from a tiny chain, behind the face there is a large six-pointed star-shaped jester collar with alternating bright red and golden yellow pointed petals radiating outward like a sunburst, bold thick black ink outlines, cell-shaded coloring with crisp flat colors, small white star sparkles scattered around, vibrant saturated colors, isolated on plain solid white background, sticker style, flat 2D vector art, NOT 3D, NOT photorealistic --ar 1:1 --v 7 --style raw --s 100 --no text, letters, numbers, watermark
```

### 3.2 Crown — corona dorada con cruces y banner Bonus

```
2D vector illustration, premium mobile slot machine symbol, ornate golden royal crown centered facing forward, three crosses on top: LEFT small fleur-de-lis cross, CENTER larger cross with a small white pearl on top of it, RIGHT small fleur-de-lis cross, crown body shows the interior visible above the band in DEEP RED velvet color, wide golden band at the bottom decorated with multiple round gemstones set in: small white pearls flanking a central LARGE red ruby, with smaller green emerald accents and floral gold filigree details between the gems, gold has bright yellow highlights on the top and warm orange-brown shadows below for volume, BELOW the crown there is a small ornate gold scrolled banner with curled ends, bold thick black ink outlines throughout, cell-shaded flat coloring, small white star sparkles on the gold and pearls, vibrant saturated colors, isolated on plain solid white background, sticker style, flat 2D vector art, NOT 3D, NOT photorealistic --ar 1:1 --v 7 --style raw --s 100 --no text, letters, numbers, watermark
```

> Nota: el banner es ornamental — Midjourney probablemente le meta texto. Si genera "Bonus" en el banner está bien (el original lo tiene). Si genera otra cosa o letras random, regenerar.

### 3.3 Mandolin — instrumento honey wood pera

```
2D vector illustration, premium mobile slot machine symbol, single ornate mandolin instrument centered at a slight angle with the neck going up and to the left, large pear-shaped teardrop wooden body in warm honey golden brown color with darker brown striped wood grain texture, decorative round rosette pattern around the central soundhole in darker brown and gold, six to eight taut strings running down the length of the neck onto the body, long narrow neck extending up at a 30 degree angle with several small golden tuning pegs at the top headstock, small bridge near the bottom of the body, glossy varnished finish suggested with cell-shading, bold thick black ink outlines, cell-shaded flat coloring with crisp highlights, small white star sparkles scattered around, vibrant saturated colors, isolated on plain solid white background, sticker style, flat 2D vector art, NOT 3D, NOT photorealistic --ar 1:1 --v 7 --style raw --s 100 --no text, letters, numbers, watermark
```

### 3.4 Boots — par de botas jester rosa con rayas

```
2D vector illustration, premium mobile slot machine symbol, pair of pink jester boots centered side by side, both boots have pointed curled-up tips pointing OUTWARD (left boot tip curls left, right boot tip curls right), boots have HORIZONTAL stripes alternating between hot pink and lighter pastel pink, each boot has a frilly ruffled cuff at the top in lighter pink, each pointed curled tip has a small round coral pink bell hanging from a tiny golden chain, slight 3/4 perspective showing volume and depth, bold thick black ink outlines, cell-shaded coloring with darker magenta shadows and lighter pink highlights on the stripes, small white star sparkles scattered around, vibrant saturated colors, isolated on plain solid white background, sticker style, flat 2D vector art, NOT 3D, NOT photorealistic --ar 1:1 --v 7 --style raw --s 100 --no text, letters, numbers, watermark
```

### 3.5 Bolos — tres bowling pins (símbolo NUEVO)

```
2D vector illustration, premium mobile slot machine symbol, three vintage bowling pins clustered together facing forward in a triangular arrangement, classic bulbous bottle shape with narrow neck and small round head, LEFT pin has a cream white body with a metallic GOLD top cap and GOLD bottom base disc, MIDDLE pin slightly taller in front has a cream white body with a horizontal RED stripe at the neck and a RED bottom base disc, RIGHT pin has a white body with a horizontal ROYAL BLUE stripe at the neck and a BLUE bottom base disc, glossy ceramic finish with soft white highlights, bold thick black ink outlines on each pin, cell-shaded coloring with crisp flat colors, small white star sparkles scattered around, vibrant saturated colors, isolated on plain solid white background, sticker style, flat 2D vector art, NOT 3D, NOT photorealistic --ar 1:1 --v 7 --style raw --s 100 --no text, letters, numbers, watermark
```

### 3.6 Ruby — gema roja forma pentagonal escudo

```
2D vector illustration, premium mobile slot machine symbol, single large faceted red ruby gemstone centered, classic shield diamond shape (flat horizontal top edge, two slanted upper sides, two longer slanted lower sides converging to a sharp point at the bottom, like an upside-down pentagon or shield), brilliant cut faceting with multiple triangular and trapezoidal flat facets visible, deep crimson red color with dark maroon shadows in the lower facets and bright pink-white highlights in the upper facets creating a star-like sparkle in the center, single bright white star sparkle in the upper right, bold thick black ink outline, cell-shaded flat coloring, small white star sparkles around the gem, vibrant saturated colors, isolated on plain solid white background, sticker style, flat 2D vector art, NOT 3D, NOT photorealistic --ar 1:1 --v 7 --style raw --s 100 --no text, letters, numbers, watermark
```

### 3.7 Sapphire — gema cyan octagonal cushion cut

```
2D vector illustration, premium mobile slot machine symbol, single large faceted cyan turquoise gemstone centered, octagonal cushion princess cut shape (square base with all four corners cut off creating an octagon outline), brilliant cut faceting visible: flat horizontal top facet, angled side facets, and V-shaped bottom facets converging downward, bright cyan teal color with darker teal shadows in lower facets and bright pale cyan-white highlights in upper facets creating a star sparkle in the center, single bright white star sparkle in the upper left, bold thick black ink outline, cell-shaded flat coloring, small white star sparkles around the gem, vibrant saturated colors, isolated on plain solid white background, sticker style, flat 2D vector art, NOT 3D, NOT photorealistic --ar 1:1 --v 7 --style raw --s 100 --no text, letters, numbers, watermark
```

### 3.8 Emerald — orbe esférico azul (NO facetado)

```
2D vector illustration, premium mobile slot machine symbol, single polished spherical glossy orb centered, perfectly round ball shape, deep royal blue color with lighter cyan blue swirl patterns inside suggesting depth and motion like a marble or crystal ball, bright white glossy highlight reflection on the upper right side of the sphere giving it a 3D glass-like appearance while still 2D illustration style, soft cyan halo glow around the orb, bold thick black ink outline around the sphere, cell-shaded coloring with crisp flat colors, small white star sparkles scattered around, vibrant saturated colors, isolated on plain solid white background, sticker style, flat 2D vector art, NOT 3D, NOT photorealistic --ar 1:1 --v 7 --style raw --s 100 --no text, letters, numbers, watermark
```

---

### 3.9 Frame del juego (cromado/metálico) — OPCIONAL, ver §6

```
2D vector illustration, premium mobile slot machine cabinet frame, ornate silver chrome bezel with rounded corners and small art deco scrollwork details at the corners, polished metal look with bright white highlights and dark grey shadows for volume, empty rectangular center area (this is where the game reels will go, keep it completely empty plain white), bold thick black ink outlines, cell-shaded flat coloring, vibrant saturated metallic colors, plain neutral background outside the frame, flat 2D vector art, NOT 3D, NOT photorealistic --ar 4:3 --v 7 --style raw --s 100 --no text, letters, numbers, watermark
```

### 3.10 Backboard (patrón rombo terciopelo del fondo de los reels)

```
Tileable seamless pattern texture, deep royal purple diamond quilted velvet upholstery, regular grid of diamond shapes formed by stitching lines, small golden round button tufting at each diamond intersection point, soft purple shadows in the recesses between diamonds and lighter purple highlights on the raised diamond surfaces, luxurious cabaret casino aesthetic, repeating pattern, plain consistent texture across the entire image --ar 1:1 --v 7 --tile --no text, letters, numbers, watermark
```

> Para `backboard.png` el flag `--tile` de Midjourney genera un patrón seamless real que se puede tilear sin costura. Probarlo poniéndolo en CSS con `background-repeat: repeat` antes de declararlo listo.

---

## 4. Iteración

Cada generación es estocástica. Plan típico por símbolo:

1. **Tirar 4-8 variaciones** del mismo prompt (cambiando seed).
2. **Elegir la mejor** según criterio: composición centrada, fondo limpio (será removido después), estilo 2D consistente con outline negro grueso.
3. **Si no convence**, ajustar el prompt con los troubleshooting tips de abajo.
4. **Repetir hasta tener un set coherente** entre los 8 símbolos.

> ⚠️ **Lo más importante**: que los **8 símbolos compartan estilo 2D cell-shaded**. Si uno sale 3D y los demás 2D, descartar y regenerar — la incoherencia visual destruye la sensación de juego premium.

### Troubleshooting típico con Midjourney v7

| Síntoma | Fix |
|---|---|
| Sale demasiado cinematográfico / realista | Bajar stylize: `--s 50` o incluso `--s 25`. Confirmar que `--style raw` esté presente. |
| Sale "demasiado bonito" estilo pintura digital | `--style raw` debería evitarlo. Si persiste, agregar `vector illustration, sticker, flat colors` y bajar `--s` a 25-50. |
| Outlines negros muy finos o ausentes | Reforzar en prompt: `bold thick black ink outlines, cartoon comic outline style, heavy line weight`. |
| Fondo complejo con escenografía | Reforzar `isolated on plain solid white background, no scenery, no decoration, sticker style`. |
| Aparecen letras random | El `--no text, letters, numbers, watermark` debería cubrirlo. Si insiste, regenerar (`🔄`). |
| Colores apagados / pastel | Agregar `extremely vibrant saturated colors, neon palette, high contrast`. |
| Joker queda masculino o cartoon clown clásico | Reforzar `elegant feminine face, harlequin makeup, jester not clown, NOT a circus clown, NOT cartoon clown`. |
| Gemas ovaladas (marquise) en vez de princess cut | Reforzar `square princess cut gemstone, square shape with sharp corners, NOT oval, NOT marquise, NOT teardrop, NOT round`. Si MJ insiste, probar `--no oval, marquise, round`. |
| Crown sin las 3 gemas en el orden correcto (rojo-verde-rojo) | MJ no respeta orden exacto de colores. Aceptar la que más se parezca y postprocesar en Photopea cambiando colores de las gemas que no calzan. |
| Variaciones inconsistentes entre símbolos (cada uno con estilo distinto) | Una vez que tenés el joker definitivo, copiar su URL y usar `--sref <url-joker>` en los prompts siguientes para forzar coherencia de estilo. |

---

## 5. Procesamiento

### 5.1 Fondo transparente

Si la herramienta no generó fondo transparente (la mayoría no lo hace bien):
- **https://remove.bg** — gratis hasta 1 imagen HD/día, ilimitado en resolución menor. Drag & drop.
- **Photopea** (Photoshop online gratis) — abrir imagen, magic wand sobre el fondo, delete, exportar PNG.
- **rembg local** (Python): `pip install rembg && rembg i input.png output.png`.

### 5.2 Recorte y centrado

Cada símbolo debe estar **centrado en su frame de 512×512** sin demasiado margen pero con suficiente padding para no quedar pegado a los bordes.

Si el sujeto generado quedó descentrado:
- Photopea: crop al cuadrado, alinear al centro.

### 5.3 Naming + ubicación

Guardar cada PNG con el nombre exacto:

```
apps/games/jokers-jewels/public/assets/symbols/
├── joker.png
├── crown.png
├── mandolin.png
├── boots.png
├── bolos.png        ← bowling pins (reemplaza diamond_pink — 2026-05-26)
├── ruby.png         ← pentagonal shield, rojo
├── sapphire.png     ← octagonal cushion, cyan (mapping histórico: cyan ≠ azul)
└── emerald.png      ← orbe esférico, azul (mapping histórico: azul ≠ verde)

apps/games/jokers-jewels/public/assets/
├── frame.png        (frame del juego — opcional, podemos seguir con CSS)
└── backboard.png    (patrón rombo)
```

---

## 6. Integración al código (lo hago yo)

Cuando tengas los 10 PNG listos:

1. Avisame y reviso que estén en el path correcto.
2. Refactorizo `Symbol.tsx` para usar `<img>` con preload en vez de SVG inline.
3. Aplico el `backboard.png` como background del componente `Reels`.
4. (Opcional) Aplico el `frame.png` al wrapper del juego — sino mejoro el CSS actual del frame.
5. Validación visual y ajustes de tamaño/posición.

Esto es ~2-3 horas de trabajo de mi lado.

---

## 7. Polish adicional post-IA

Una vez los símbolos premium están integrados, lo que más mueve la aguja es:

| Polish | Impacto |
|---|---|
| **Tipografía del logo** | Cambiar a fuente similar al original (Google Font: "Lobster", "Permanent Marker", "Bungee Inline"). Aplicar text-shadow + outline para que se parezca al "Joker's Jewels" original. |
| **Botón de spin** | Reemplazar el SVG actual por una versión más metálica/3D con highlights. |
| **Glow al ganar** | Aumentar el brillo del win-line highlight, agregar partículas. |
| **Sound design** | Howler.js + audio packs (Sub-fase 2D). |

---

## 8. Costo estimado total

| Item | Costo |
|---|---|
| Midjourney 1 mes (si elegís Midjourney) | $10 |
| DALL-E vía ChatGPT Plus (si ya lo tenés) | $0 marginal |
| FLUX.1 schnell gratis | $0 |
| remove.bg (si gratis no alcanza) | $0-9 según volumen |
| Fuente personalizada (Google Fonts) | $0 |
| **Total realista** | **$0-30** |

Versus comprar pack de assets en marketplace: $30-200, pero el resultado no es "tu juego" sino assets genéricos.

---

## 9. Checklist final (antes de declarar Sub-fase 2A.x completa)

- [ ] 8 símbolos generados, recortados centrados, fondo transparente, naming correcto.
- [ ] Backboard pattern generado y tileable.
- [ ] (Opcional) Frame generado.
- [ ] Set visualmente coherente (todos los símbolos comparten estilo).
- [ ] Integrados al código (`Symbol.tsx` refactor + `Reels` background).
- [ ] Tipografía del logo mejorada.
- [ ] Comparación visual lado a lado con screenshot del original → "se siente como un slot premium".
- [ ] Performance: cada imagen <100KB después de optimización (TinyPNG, Squoosh).
- [ ] Lazy load configurado (sino el primer load se siente lento).
