import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Cada variante `.web.tsx` sustituye a su archivo nativo solo en web. Si una deja de exportar lo mismo que el original,
 * las pantallas compartidas fallarían únicamente en web: aquí se detecta antes de compilar.
 */
const PAIRS: Array<[native: string, web: string]> = [
  ['src/ui/Kit.tsx', 'src/ui/Kit.web.tsx'],
  ['src/ui/Field.tsx', 'src/ui/Field.web.tsx'],
  ['src/ui/Button.tsx', 'src/ui/Button.web.tsx'],
  ['src/ui/AuthShell.tsx', 'src/ui/AuthShell.web.tsx'],
  ['src/ui/Dialogs.tsx', 'src/ui/Dialogs.web.tsx'],
  ['src/ui/Screen.tsx', 'src/ui/Screen.web.tsx'],
  ['src/ui/theme.ts', 'src/ui/theme.web.ts'],
  ['src/lib/push.ts', 'src/lib/push.web.ts'],
  ['src/lib/storage.ts', 'src/lib/storage.web.ts'],
  ['src/shell/WebShell.tsx', 'src/shell/WebShell.web.tsx'],
];

const root = path.resolve(__dirname, '..');
const valueExports = (file: string) =>
  [...readFileSync(path.join(root, file), 'utf8').matchAll(/^export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z0-9_]+)/gm)].map((m) => m[1]!).sort();

describe('web variants keep the API of their native original', () => {
  it.each(PAIRS)('%s ↔ %s', (native, web) => {
    expect(existsSync(path.join(root, web)), `${web} no existe`).toBe(true);
    expect(valueExports(web)).toEqual(valueExports(native));
  });
});
