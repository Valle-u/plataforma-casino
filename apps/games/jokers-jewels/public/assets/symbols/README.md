# Symbols assets

Acá van los 8 PNGs de los símbolos del slot, generados según
[`docs/own-games/jokers-jewels/asset-generation-guide.md`](../../../../../docs/own-games/jokers-jewels/asset-generation-guide.md).

## Archivos esperados

```
joker.png         - 512×512 PNG, fondo transparente
crown.png         - idem
mandolin.png      - idem
boots.png         - idem
diamond_pink.png  - idem
ruby.png          - idem
sapphire.png      - idem
emerald.png       - idem
```

## Mientras no estén

`Symbol.tsx` usa los SVGs inline como fallback. Cuando agregues los PNGs
acá, el componente se refactorizará para usarlos en lugar de los SVGs
(2-3 horas de trabajo de integración).

## Optimización

Antes de commitear, pasá cada PNG por TinyPNG (https://tinypng.com) o
Squoosh (https://squoosh.app) para reducir tamaño. Target: <100KB por
imagen. Sino el primer load del juego se va a sentir lento.
