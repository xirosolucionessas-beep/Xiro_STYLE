import { contrastChecks } from './contrastPairs';
import { colors, focusRing, font, layout, motion, radius, space, type ThemeName } from './tokens';

/** Genera docs/web-design-tokens.md. Una prueba falla si el archivo no coincide (npm run docs:tokens lo regenera). */
export function buildTokensMarkdown(): string {
  const lines: string[] = [
    '# Tokens de diseño web',
    '',
    '> Generado desde `src/web/tokens.ts` con `npm run docs:tokens -w @xiro/mobile`. No editar a mano.',
    '> Solo aplica a la **web**; Android/iOS siguen usando `src/ui/theme.ts`.',
    '',
    'Objetivo: WCAG 2.2 AA — 4.5:1 texto normal · 3:1 texto grande, iconos y bordes de controles.',
    '',
  ];

  for (const theme of ['dark', 'light'] as ThemeName[]) {
    lines.push(`## Colores — tema ${theme === 'dark' ? 'oscuro' : 'claro'}`, '', '| Token | Valor |', '|---|---|');
    for (const [name, value] of Object.entries(colors[theme])) lines.push(`| \`${name}\` | \`${value}\` |`);
    lines.push('', `### Contraste verificado (${theme})`, '', '| Par | Ratio | Mínimo | Resultado |', '|---|---|---|---|');
    for (const check of contrastChecks(theme)) {
      lines.push(`| ${check.name} (\`${check.fg}\` / \`${check.bg}\`) | ${check.ratio.toFixed(2)}:1 | ${check.min}:1 | ${check.pass ? 'Cumple' : '**NO cumple**'} |`);
    }
    lines.push('');
  }

  lines.push('## Espaciado (múltiplos de 4 px)', '', '| Token | px |', '|---|---|');
  for (const [k, v] of Object.entries(space)) lines.push(`| \`space.${k}\` | ${v} |`);
  lines.push('', '## Radios', '', '| Token | px |', '|---|---|');
  for (const [k, v] of Object.entries(radius)) lines.push(`| \`radius.${k}\` | ${v} |`);
  lines.push('', '## Tipografía', '', `Familia: \`${font.family}\``, '', '| Tamaño | px | rem |', '|---|---|---|');
  for (const [k, v] of Object.entries(font.size)) lines.push(`| \`${k}\` | ${v} | ${v / 16} |`);
  lines.push('', '## Layout y otros', '');
  lines.push(`- Ancho máximo de contenido: ${layout.maxContent}px · autenticación: ${layout.maxForm}px · formularios: ${layout.maxFormPage}px`);
  lines.push(`- Sidebar: ${layout.sidebarWidth}px (colapsada: ${layout.sidebarCollapsedWidth}px)`);
  lines.push(`- Puntos de quiebre: tablet ≥ ${layout.breakpoints.tablet}px · escritorio ≥ ${layout.breakpoints.desktop}px · monitor ancho ≥ ${layout.breakpoints.wide}px`);
  lines.push(`- Área clicable mínima: ${layout.touchTarget}×${layout.touchTarget}px`);
  lines.push(`- Anillo de foco: ${focusRing.width}px, separación ${focusRing.offset}px, color \`focus\``);
  lines.push(`- Movimiento: ${motion.fast}ms / ${motion.base}ms (se anula con \`prefers-reduced-motion\`)`);
  lines.push('');
  return lines.join('\n');
}
