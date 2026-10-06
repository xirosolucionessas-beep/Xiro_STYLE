# Tokens de diseño web

> Generado desde `src/web/tokens.ts` con `npm run docs:tokens -w @xiro/mobile`. No editar a mano.
> Solo aplica a la **web**; Android/iOS siguen usando `src/ui/theme.ts`.

Objetivo: WCAG 2.2 AA — 4.5:1 texto normal · 3:1 texto grande, iconos y bordes de controles.

## Colores — tema oscuro

| Token | Valor |
|---|---|
| `background` | `#15130f` |
| `surface` | `#1c1914` |
| `surfaceAlt` | `#272019` |
| `surfaceTint` | `#211d28` |
| `border` | `#746d5c` |
| `borderSubtle` | `#39332b` |
| `text` | `#f3eee3` |
| `textMuted` | `#b7ad9b` |
| `accent` | `#cda668` |
| `accentTint` | `rgba(205, 166, 104, 0.14)` |
| `onAccent` | `#1a1510` |
| `danger` | `#e2766a` |
| `success` | `#5fb37e` |
| `warning` | `#e08a4e` |
| `overlay` | `rgba(0, 0, 0, 0.7)` |
| `focus` | `#cda668` |

### Contraste verificado (dark)

| Par | Ratio | Mínimo | Resultado |
|---|---|---|---|
| Texto sobre fondo (`#f3eee3` / `#15130f`) | 16.03:1 | 4.5:1 | Cumple |
| Texto sobre superficie (`#f3eee3` / `#1c1914`) | 15.14:1 | 4.5:1 | Cumple |
| Texto sobre superficie elevada (`#f3eee3` / `#272019`) | 13.89:1 | 4.5:1 | Cumple |
| Texto secundario sobre fondo (`#b7ad9b` / `#15130f`) | 8.36:1 | 4.5:1 | Cumple |
| Texto secundario sobre superficie (`#b7ad9b` / `#1c1914`) | 7.90:1 | 4.5:1 | Cumple |
| Texto secundario sobre superficie elevada (`#b7ad9b` / `#272019`) | 7.24:1 | 4.5:1 | Cumple |
| Acento (texto/enlaces) sobre fondo (`#cda668` / `#15130f`) | 8.17:1 | 4.5:1 | Cumple |
| Acento sobre superficie (`#cda668` / `#1c1914`) | 7.72:1 | 4.5:1 | Cumple |
| Acento sobre superficie elevada (`#cda668` / `#272019`) | 7.08:1 | 4.5:1 | Cumple |
| Texto sobre superficie lavanda (`#f3eee3` / `#211d28`) | 14.28:1 | 4.5:1 | Cumple |
| Texto secundario sobre superficie lavanda (`#b7ad9b` / `#211d28`) | 7.45:1 | 4.5:1 | Cumple |
| Acento sobre superficie lavanda (`#cda668` / `#211d28`) | 7.28:1 | 4.5:1 | Cumple |
| Acento sobre chip seleccionado (fondo) (`#cda668` / `#2f281b`) | 6.42:1 | 4.5:1 | Cumple |
| Acento sobre chip seleccionado (superficie) (`#cda668` / `#352d20`) | 5.98:1 | 4.5:1 | Cumple |
| Texto del botón primario (`#1a1510` / `#cda668`) | 7.98:1 | 4.5:1 | Cumple |
| Peligro (texto) sobre fondo (`#e2766a` / `#15130f`) | 6.21:1 | 4.5:1 | Cumple |
| Peligro sobre superficie (`#e2766a` / `#1c1914`) | 5.87:1 | 4.5:1 | Cumple |
| Peligro sobre superficie elevada (`#e2766a` / `#272019`) | 5.38:1 | 4.5:1 | Cumple |
| Éxito (texto) sobre fondo (`#5fb37e` / `#15130f`) | 7.28:1 | 4.5:1 | Cumple |
| Éxito sobre superficie elevada (toast) (`#5fb37e` / `#272019`) | 6.30:1 | 4.5:1 | Cumple |
| Aviso (texto) sobre fondo (`#e08a4e` / `#15130f`) | 6.99:1 | 4.5:1 | Cumple |
| Aviso sobre superficie elevada (`#e08a4e` / `#272019`) | 6.06:1 | 4.5:1 | Cumple |
| Borde de control sobre fondo (`#746d5c` / `#15130f`) | 3.61:1 | 3:1 | Cumple |
| Borde de control sobre superficie (`#746d5c` / `#1c1914`) | 3.41:1 | 3:1 | Cumple |
| Borde de control sobre superficie elevada (`#746d5c` / `#272019`) | 3.13:1 | 3:1 | Cumple |
| Anillo de foco sobre fondo (`#cda668` / `#15130f`) | 8.17:1 | 3:1 | Cumple |
| Anillo de foco sobre superficie (`#cda668` / `#1c1914`) | 7.72:1 | 3:1 | Cumple |
| Icono/borde de acento sobre fondo (`#cda668` / `#15130f`) | 8.17:1 | 3:1 | Cumple |
| Botón Google: texto (`#e3e3e3` / `#131314`) | 14.47:1 | 4.5:1 | Cumple |
| Botón Google: borde sobre el fondo de página (`#8e918f` / `#15130f`) | 5.83:1 | 3:1 | Cumple |
| Botón Google: borde sobre su propio fondo (`#8e918f` / `#131314`) | 5.83:1 | 3:1 | Cumple |
| Botón Apple: texto (`#000000` / `#ffffff`) | 21.00:1 | 4.5:1 | Cumple |

## Colores — tema claro

| Token | Valor |
|---|---|
| `background` | `#f6f2e9` |
| `surface` | `#ffffff` |
| `surfaceAlt` | `#f0e9db` |
| `surfaceTint` | `#eee7f2` |
| `border` | `#8a8370` |
| `borderSubtle` | `#e3dbc8` |
| `text` | `#201b14` |
| `textMuted` | `#685f4f` |
| `accent` | `#7a5c12` |
| `accentTint` | `rgba(122, 92, 18, 0.12)` |
| `onAccent` | `#ffffff` |
| `danger` | `#ad3527` |
| `success` | `#176b3a` |
| `warning` | `#954b10` |
| `overlay` | `rgba(0, 0, 0, 0.5)` |
| `focus` | `#7a5c12` |

### Contraste verificado (light)

| Par | Ratio | Mínimo | Resultado |
|---|---|---|---|
| Texto sobre fondo (`#201b14` / `#f6f2e9`) | 15.30:1 | 4.5:1 | Cumple |
| Texto sobre superficie (`#201b14` / `#ffffff`) | 17.10:1 | 4.5:1 | Cumple |
| Texto sobre superficie elevada (`#201b14` / `#f0e9db`) | 14.15:1 | 4.5:1 | Cumple |
| Texto secundario sobre fondo (`#685f4f` / `#f6f2e9`) | 5.63:1 | 4.5:1 | Cumple |
| Texto secundario sobre superficie (`#685f4f` / `#ffffff`) | 6.29:1 | 4.5:1 | Cumple |
| Texto secundario sobre superficie elevada (`#685f4f` / `#f0e9db`) | 5.21:1 | 4.5:1 | Cumple |
| Acento (texto/enlaces) sobre fondo (`#7a5c12` / `#f6f2e9`) | 5.58:1 | 4.5:1 | Cumple |
| Acento sobre superficie (`#7a5c12` / `#ffffff`) | 6.24:1 | 4.5:1 | Cumple |
| Acento sobre superficie elevada (`#7a5c12` / `#f0e9db`) | 5.16:1 | 4.5:1 | Cumple |
| Texto sobre superficie lavanda (`#201b14` / `#eee7f2`) | 14.12:1 | 4.5:1 | Cumple |
| Texto secundario sobre superficie lavanda (`#685f4f` / `#eee7f2`) | 5.20:1 | 4.5:1 | Cumple |
| Acento sobre superficie lavanda (`#7a5c12` / `#eee7f2`) | 5.15:1 | 4.5:1 | Cumple |
| Acento sobre chip seleccionado (fondo) (`#7a5c12` / `#e7e0cf`) | 4.74:1 | 4.5:1 | Cumple |
| Acento sobre chip seleccionado (superficie) (`#7a5c12` / `#efebe3`) | 5.25:1 | 4.5:1 | Cumple |
| Texto del botón primario (`#ffffff` / `#7a5c12`) | 6.24:1 | 4.5:1 | Cumple |
| Peligro (texto) sobre fondo (`#ad3527` / `#f6f2e9`) | 5.67:1 | 4.5:1 | Cumple |
| Peligro sobre superficie (`#ad3527` / `#ffffff`) | 6.33:1 | 4.5:1 | Cumple |
| Peligro sobre superficie elevada (`#ad3527` / `#f0e9db`) | 5.24:1 | 4.5:1 | Cumple |
| Éxito (texto) sobre fondo (`#176b3a` / `#f6f2e9`) | 5.87:1 | 4.5:1 | Cumple |
| Éxito sobre superficie elevada (toast) (`#176b3a` / `#f0e9db`) | 5.43:1 | 4.5:1 | Cumple |
| Aviso (texto) sobre fondo (`#954b10` / `#f6f2e9`) | 5.71:1 | 4.5:1 | Cumple |
| Aviso sobre superficie elevada (`#954b10` / `#f0e9db`) | 5.28:1 | 4.5:1 | Cumple |
| Borde de control sobre fondo (`#8a8370` / `#f6f2e9`) | 3.38:1 | 3:1 | Cumple |
| Borde de control sobre superficie (`#8a8370` / `#ffffff`) | 3.78:1 | 3:1 | Cumple |
| Borde de control sobre superficie elevada (`#8a8370` / `#f0e9db`) | 3.13:1 | 3:1 | Cumple |
| Anillo de foco sobre fondo (`#7a5c12` / `#f6f2e9`) | 5.58:1 | 3:1 | Cumple |
| Anillo de foco sobre superficie (`#7a5c12` / `#ffffff`) | 6.24:1 | 3:1 | Cumple |
| Icono/borde de acento sobre fondo (`#7a5c12` / `#f6f2e9`) | 5.58:1 | 3:1 | Cumple |
| Botón Google: texto (`#1f1f1f` / `#ffffff`) | 16.48:1 | 4.5:1 | Cumple |
| Botón Google: borde sobre el fondo de página (`#747775` / `#f6f2e9`) | 4.05:1 | 3:1 | Cumple |
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
