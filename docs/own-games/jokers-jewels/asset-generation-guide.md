# Joker's Jewels · Asset Generation Guide

> Guía operativa para generar los assets visuales del slot con IA.
> Camino B del Sprint 2A.x (decidido 2026-05-25).

Sub-fase intermedia entre **2A** (UI con SVGs hechos a mano) y **2B** (animaciones). El objetivo: reemplazar los 8 SVGs simples por **ilustraciones premium generadas con IA** + frame profesional + background con textura.

---

## 1. Stack recomendado de IA

Tenés 4 opciones. Elegí 1:

### Opción 1 — Midjourney (recomendado por calidad)
- **Costo**: $10/mes plan básico (~200 generaciones).
- **Calidad**: la más alta del mercado para sprites premium.
- **Acceso**: requiere cuenta + Discord.
- **Comando**: `/imagine <prompt>` en Discord.

### Opción 2 — DALL-E 3 (vía ChatGPT Plus)
- **Costo**: $20/mes si ya tenés ChatGPT Plus.
- **Calidad**: muy buena, especialmente para estilos cartoon/illustration.
- **Acceso**: cuenta ChatGPT Plus o vía API.

### Opción 3 — FLUX.1 schnell (GRATIS)
- **Costo**: $0.
- **Calidad**: comparable a Midjourney v6 para este caso de uso.
- **Acceso**: https://fluxpro.art o https://huggingface.co/spaces/black-forest-labs/FLUX.1-schnell
- **Limitación**: rate limit, puede tardar 30-60s por imagen.

### Opción 4 — Stable Diffusion local
- **Costo**: $0, pero requiere GPU decente (8GB+ VRAM).
- **Acceso**: ComfyUI o Automatic1111 instalados localmente.

**Sugerencia**: empezar con **FLUX.1 schnell gratis** para validar el flujo. Si la calidad no alcanza, escalar a Midjourney.

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

## 3. Prompts ultra-detallados

Copiá-pegá cada uno tal cual en la herramienta IA elegida. Si usás Midjourney sumá `--ar 1:1 --v 6 --style raw` al final.

### 3.1 Joker (wild)

```
Vintage casino slot machine symbol, single jester character bust portrait,
white painted clown face with rosy cheeks and bright red lips,
wearing a tricorn jester hat in alternating red and yellow stripes with
small golden bells at each tip, mischievous smile, large blue eyes,
detailed 3D illustration style, glossy plastic look, soft volumetric lighting,
golden rim light, premium mobile game art, transparent background,
centered composition, 512x512, cartoony but polished, no text
```

### 3.2 Crown (corona — top tier después del wild)

```
Vintage casino slot machine symbol, ornate golden royal crown with three pointed peaks,
each peak topped with a small spherical jewel, three gemstones embedded in the band
(left: red ruby, center: green emerald, right: blue sapphire),
gold has high specular highlights and warm reflections, baroque detail,
3D illustration style, polished metal texture, dramatic lighting from above,
transparent background, centered composition, 512x512, premium mobile game art, no text
```

### 3.3 Mandolin

```
Vintage casino slot machine symbol, single ornate mandolin instrument,
pear-shaped wooden body in warm honey-gold color with deep wood grain,
ivory and gold rosette around the soundhole, four steel strings,
short neck with golden tuning pegs, classical italian style,
3D illustration with soft shadows and rim lighting,
transparent background, centered composition, 512x512, premium mobile game art, no text
```

### 3.4 Boots (par de botas con cascabeles)

```
Vintage casino slot machine symbol, pair of magenta pink jester boots
with pointed curled tips, soft velvet texture, two golden bells dangling
from each pointed tip with small chains, slight 3/4 perspective showing both boots,
glossy fabric finish, soft pink highlights, deep magenta shadows,
3D illustration style, soft volumetric lighting,
transparent background, centered composition, 512x512, premium mobile game art, no text
```

### 3.5 Diamond pink (gema rosa)

```
Vintage casino slot machine symbol, single faceted pink diamond gem in marquise cut
(elongated pointed oval), bright magenta pink with white sparkle reflections,
realistic facet refractions, prismatic light dispersion in cool pinks and whites,
floating against transparent background with subtle inner glow,
3D rendered jewelry style, centered composition, 512x512, premium mobile game art, no text
```

### 3.6 Ruby (gema roja)

```
Vintage casino slot machine symbol, single faceted ruby gem in marquise cut
(elongated pointed oval), deep crimson red with white sparkle reflections,
realistic facet refractions, prismatic light dispersion in warm reds and oranges,
floating against transparent background with subtle inner glow,
3D rendered jewelry style, centered composition, 512x512, premium mobile game art, no text
```

### 3.7 Sapphire (gema celeste / aguamarina)

```
Vintage casino slot machine symbol, single faceted aquamarine gem in marquise cut
(elongated pointed oval), bright cyan turquoise with white sparkle reflections,
realistic facet refractions, prismatic light dispersion in cool blues and whites,
floating against transparent background with subtle inner glow,
3D rendered jewelry style, centered composition, 512x512, premium mobile game art, no text
```

### 3.8 Emerald (bola azul cristal — match con el original)

```
Vintage casino slot machine symbol, single polished sphere of deep blue lapis lazuli stone,
glossy spherical gemstone with bright white highlight on upper-left,
deep cobalt blue with subtle internal reflections suggesting depth,
slight shimmer on the surface, floating against transparent background,
3D rendered jewelry style, centered composition, 512x512, premium mobile game art, no text
```

### 3.9 Frame del juego (cromado/metálico)

```
Vintage casino slot machine cabinet frame, ornate silver chrome bezel
with rounded corners and decorative scrollwork, polished metal finish
with realistic highlights and reflections, art deco border details,
no interior content (empty rectangular center area for game),
front view, dark deep purple velvet visible inside,
photorealistic 3D rendering, dramatic studio lighting, transparent background outside the frame,
2048x1536, premium mobile game art, no text
```

### 3.10 Background (patrón rombo del backboard)

```
Tileable seamless pattern, deep royal purple diamond quilted velvet upholstery
with subtle button tufting at the diamond intersections,
rich texture with soft shadows in the recesses,
luxurious cabaret/casino aesthetic, photorealistic fabric rendering,
512x512 seamless tile, premium mobile game art, no text
```

---

## 4. Iteración

Cada generación es estocástica. Plan típico por símbolo:

1. **Tirar 4-8 variaciones** del mismo prompt.
2. **Elegir la mejor** según criterio: composición centrada, fondo realmente transparente o limpio, estilo coherente con el resto de los símbolos.
3. **Si no convence**, ajustar el prompt cambiando 1-2 palabras (ej: `cartoony` → `polished 3D`, o `cabaret` → `royal`).
4. **Repetir hasta tener un set coherente** entre los 8 símbolos (mismo estilo, misma vibe).

> Lo más importante: que los **8 símbolos compartan estilo**. No tiene sentido un joker hyperrealista con gemas cartoon. Si elegís el estilo del primero, el resto deben seguirlo.

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
├── diamond_pink.png
├── ruby.png
├── sapphire.png
└── emerald.png

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
