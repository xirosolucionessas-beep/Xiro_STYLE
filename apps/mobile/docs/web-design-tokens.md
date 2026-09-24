# Tokens de diseño web

> Generado desde `src/web/tokens.ts` con `npm run docs:tokens -w @xiro/mobile`. No editar a mano.
> Solo aplica a la **web**; Android/iOS siguen usando `src/ui/theme.ts`.

Objetivo: WCAG 2.2 AA — 4.5:1 texto normal · 3:1 texto grande, iconos y bordes de controles.

## Colores — tema oscuro

| Token | Valor |
|---|---|
| `background` | `#0d0d0f` |
| `surface` | `#1a1a1d` |
| `surfaceAlt` | `#24221d` |
| `surfaceTint` | `#221e2b` |
| `border` | `#726d60` |
| `borderSubtle` | `#37342b` |
| `text` | `#ffffff` |
| `textMuted` | `#b9b3a7` |
| `accent` | `#d9b636` |
| `accentTint` | `rgba(217, 182, 54, 0.14)` |
| `onAccent` | `#17130a` |
| `danger` | `#e56565` |
| `success` | `#53c878` |
| `warning` | `#f2c94c` |
| `overlay` | `rgba(0, 0, 0, 0.7)` |
| `focus` | `#d9b636` |

### Contraste verificado (dark)

| Par | Ratio | Mínimo | Resultado |
|---|---|---|---|
| Texto sobre fondo (`#ffffff` / `#0d0d0f`) | 19.42:1 | 4.5:1 | Cumple |
| Texto sobre superficie (`#ffffff` / `#1a1a1d`) | 17.36:1 | 4.5:1 | Cumple |
| Texto sobre superficie elevada (`#ffffff` / `#24221d`) | 15.89:1 | 4.5:1 | Cumple |
| Texto secundario sobre fondo (`#b9b3a7` / `#0d0d0f`) | 9.31:1 | 4.5:1 | Cumple |
| Texto secundario sobre superficie (`#b9b3a7` / `#1a1a1d`) | 8.33:1 | 4.5:1 | Cumple |
| Texto secundario sobre superficie elevada (`#b9b3a7` / `#24221d`) | 7.62:1 | 4.5:1 | Cumple |
| Acento (texto/enlaces) sobre fondo (`#d9b636` / `#0d0d0f`) | 9.89:1 | 4.5:1 | Cumple |
| Acento sobre superficie (`#d9b636` / `#1a1a1d`) | 8.84:1 | 4.5:1 | Cumple |
| Acento sobre superficie elevada (`#d9b636` / `#24221d`) | 8.09:1 | 4.5:1 | Cumple |
| Texto sobre superficie lavanda (`#ffffff` / `#221e2b`) | 16.30:1 | 4.5:1 | Cumple |
| Texto secundario sobre superficie lavanda (`#b9b3a7` / `#221e2b`) | 7.81:1 | 4.5:1 | Cumple |
| Acento sobre superficie lavanda (`#d9b636` / `#221e2b`) | 8.30:1 | 4.5:1 | Cumple |
| Acento sobre chip seleccionado (fondo) (`#d9b636` / `#2a2514`) | 7.79:1 | 4.5:1 | Cumple |
| Acento sobre chip seleccionado (superficie) (`#d9b636` / `#353021`) | 6.70:1 | 4.5:1 | Cumple |
| Texto del botón primario (`#17130a` / `#d9b636`) | 9.43:1 | 4.5:1 | Cumple |
| Peligro (texto) sobre fondo (`#e56565` / `#0d0d0f`) | 5.90:1 | 4.5:1 | Cumple |
| Peligro sobre superficie (`#e56565` / `#1a1a1d`) | 5.28:1 | 4.5:1 | Cumple |
| Peligro sobre superficie elevada (`#e56565` / `#24221d`) | 4.83:1 | 4.5:1 | Cumple |
| Éxito (texto) sobre fondo (`#53c878` / `#0d0d0f`) | 9.15:1 | 4.5:1 | Cumple |
| Éxito sobre superficie elevada (toast) (`#53c878` / `#24221d`) | 7.49:1 | 4.5:1 | Cumple |
| Aviso (texto) sobre fondo (`#f2c94c` / `#0d0d0f`) | 12.24:1 | 4.5:1 | Cumple |
| Aviso sobre superficie elevada (`#f2c94c` / `#24221d`) | 10.01:1 | 4.5:1 | Cumple |
| Borde de control sobre fondo (`#726d60` / `#0d0d0f`) | 3.76:1 | 3:1 | Cumple |
| Borde de control sobre superficie (`#726d60` / `#1a1a1d`) | 3.37:1 | 3:1 | Cumple |
| Borde de control sobre superficie elevada (`#726d60` / `#24221d`) | 3.08:1 | 3:1 | Cumple |
| Anillo de foco sobre fondo (`#d9b636` / `#0d0d0f`) | 9.89:1 | 3:1 | Cumple |
| Anillo de foco sobre superficie (`#d9b636` / `#1a1a1d`) | 8.84:1 | 3:1 | Cumple |
| Icono/borde de acento sobre fondo (`#d9b636` / `#0d0d0f`) | 9.89:1 | 3:1 | Cumple |
| Botón Google: texto (`#e3e3e3` / `#131314`) | 14.47:1 | 4.5:1 | Cumple |
| Botón Google: borde sobre el fondo de página (`#8e918f` / `#0d0d0f`) | 6.10:1 | 3:1 | Cumple |
| Botón Google: borde sobre su propio fondo (`#8e918f` / `#131314`) | 5.83:1 | 3:1 | Cumple |
| Botón Apple: texto (`#000000` / `#ffffff`) | 21.00:1 | 4.5:1 | Cumple |

## Colores — tema claro

| Token | Valor |
|---|---|
| `background` | `#faf8f2` |
| `surface` | `#ffffff` |
| `surfaceAlt` | `#f3efe3` |
| `surfaceTint` | `#ece6f1` |
| `border` | `#857f6b` |
| `borderSubtle` | `#e2dccb` |
| `text` | `#1a160a` |
| `textMuted` | `#6d6656` |
| `accent` | `#7a5c00` |
| `accentTint` | `rgba(122, 92, 0, 0.12)` |
| `onAccent` | `#ffffff` |
| `danger` | `#b32d2d` |
| `success` | `#1b7038` |
| `warning` | `#805a00` |
| `overlay` | `rgba(0, 0, 0, 0.5)` |
| `focus` | `#7a5c00` |

### Contraste verificado (light)

| Par | Ratio | Mínimo | Resultado |
|---|---|---|---|
| Texto sobre fondo (`#1a160a` / `#faf8f2`) | 17.00:1 | 4.5:1 | Cumple |
| Texto sobre superficie (`#1a160a` / `#ffffff`) | 18.06:1 | 4.5:1 | Cumple |
| Texto sobre superficie elevada (`#1a160a` / `#f3efe3`) | 15.71:1 | 4.5:1 | Cumple |
| Texto secundario sobre fondo (`#6d6656` / `#faf8f2`) | 5.37:1 | 4.5:1 | Cumple |
| Texto secundario sobre superficie (`#6d6656` / `#ffffff`) | 5.70:1 | 4.5:1 | Cumple |
| Texto secundario sobre superficie elevada (`#6d6656` / `#f3efe3`) | 4.96:1 | 4.5:1 | Cumple |
| Acento (texto/enlaces) sobre fondo (`#7a5c00` / `#faf8f2`) | 5.89:1 | 4.5:1 | Cumple |
| Acento sobre superficie (`#7a5c00` / `#ffffff`) | 6.25:1 | 4.5:1 | Cumple |
| Acento sobre superficie elevada (`#7a5c00` / `#f3efe3`) | 5.44:1 | 4.5:1 | Cumple |
| Texto sobre superficie lavanda (`#1a160a` / `#ece6f1`) | 14.75:1 | 4.5:1 | Cumple |
| Texto secundario sobre superficie lavanda (`#6d6656` / `#ece6f1`) | 4.66:1 | 4.5:1 | Cumple |
| Acento sobre superficie lavanda (`#7a5c00` / `#ece6f1`) | 5.11:1 | 4.5:1 | Cumple |
| Acento sobre chip seleccionado (fondo) (`#7a5c00` / `#ebe5d5`) | 4.97:1 | 4.5:1 | Cumple |
| Acento sobre chip seleccionado (superficie) (`#7a5c00` / `#efebe0`) | 5.25:1 | 4.5:1 | Cumple |
| Texto del botón primario (`#ffffff` / `#7a5c00`) | 6.25:1 | 4.5:1 | Cumple |
| Peligro (texto) sobre fondo (`#b32d2d` / `#faf8f2`) | 5.94:1 | 4.5:1 | Cumple |
| Peligro sobre superficie (`#b32d2d` / `#ffffff`) | 6.31:1 | 4.5:1 | Cumple |
| Peligro sobre superficie elevada (`#b32d2d` / `#f3efe3`) | 5.49:1 | 4.5:1 | Cumple |
| Éxito (texto) sobre fondo (`#1b7038` / `#faf8f2`) | 5.78:1 | 4.5:1 | Cumple |
| Éxito sobre superficie elevada (toast) (`#1b7038` / `#f3efe3`) | 5.34:1 | 4.5:1 | Cumple |
| Aviso (texto) sobre fondo (`#805a00` / `#faf8f2`) | 5.85:1 | 4.5:1 | Cumple |
| Aviso sobre superficie elevada (`#805a00` / `#f3efe3`) | 5.40:1 | 4.5:1 | Cumple |
| Borde de control sobre fondo (`#857f6b` / `#faf8f2`) | 3.77:1 | 3:1 | Cumple |
| Borde de control sobre superficie (`#857f6b` / `#ffffff`) | 4.00:1 | 3:1 | Cumple |
| Borde de control sobre superficie elevada (`#857f6b` / `#f3efe3`) | 3.48:1 | 3:1 | Cumple |
| Anillo de foco sobre fondo (`#7a5c00` / `#faf8f2`) | 5.89:1 | 3:1 | Cumple |
| Anillo de foco sobre superficie (`#7a5c00` / `#ffffff`) | 6.25:1 | 3:1 | Cumple |
| Icono/borde de acento sobre fondo (`#7a5c00` / `#faf8f2`) | 5.89:1 | 3:1 | Cumple |
| Botón Google: texto (`#1f1f1f` / `#ffffff`) | 16.48:1 | 4.5:1 | Cumple |
| Botón Google: borde sobre el fondo de página (`#747775` / `#faf8f2`) | 4.26:1 | 3:1 | Cumple |
| Botón Google: borde sobre su propio fondo (`#747775` / `#ffffff`) | 4.53:1 | 3:1 | Cumple |
| Botón Apple: texto (`#ffffff` / `#000000`) | 21.00:1 | 4.5:1 | Cumple |

## Espaciado (múltiplos de 4 px)

| Token | px |
|---|---|
| `space.0` | 0 |
| `space.1` | 4 |
| `space.2` | 8 |
| `space.3` | 12 |
| `space.4` | 16 |
| `space.5` | 20 |
| `space.6` | 24 |
| `space.8` | 32 |
| `space.10` | 40 |
| `space.12` | 48 |
| `space.16` | 64 |

## Radios

| Token | px |
|---|---|
| `radius.sm` | 8 |
| `radius.md` | 12 |
| `radius.lg` | 16 |
| `radius.xl` | 24 |
| `radius.pill` | 999 |

## Tipografía

Familia: `system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`

| Tamaño | px | rem |
|---|---|---|
| `xs` | 12 | 0.75 |
| `sm` | 14 | 0.875 |
| `md` | 16 | 1 |
| `lg` | 18 | 1.125 |
| `xl` | 20 | 1.25 |
| `2xl` | 24 | 1.5 |
| `3xl` | 30 | 1.875 |

## Layout y otros

- Ancho máximo de contenido: 1200px · autenticación: 480px · formularios: 640px
- Sidebar: 264px (colapsada: 72px)
- Puntos de quiebre: tablet ≥ 768px · escritorio ≥ 1024px · monitor ancho ≥ 1440px
- Área clicable mínima: 44×44px
- Anillo de foco: 2px, separación 2px, color `focus`
- Movimiento: 120ms / 200ms (se anula con `prefers-reduced-motion`)
