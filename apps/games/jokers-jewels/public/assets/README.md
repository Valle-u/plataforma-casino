# Assets del slot Joker's Jewels

Imágenes generadas con IA según
[`docs/own-games/jokers-jewels/asset-generation-guide.md`](../../../../docs/own-games/jokers-jewels/asset-generation-guide.md).

## Estructura

```
assets/
├── symbols/         8 símbolos del slot (joker, crown, etc.)
│   ├── joker.png
│   └── ... (ver symbols/README.md)
├── backboard.png    Patrón seamless del fondo de los reels (terciopelo)
└── frame.png        (Opcional) Frame chrome del juego — si se decide
                     reemplazar el CSS actual.
```

## Naming

Match exacto con los `SymbolCode` del package math
(`packages/games-jokers-jewels/src/config.ts`). Si cambia el
naming en el código, también acá.

## Optimización

Target por imagen:
- Símbolos (512×512): <100KB c/u.
- Backboard (512×512 seamless): <80KB.
- Frame (2048×1536): <300KB.

Optimizar con TinyPNG o Squoosh antes de commitear.
