import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { composite, contrastRatio } from '../src/web/contrast';
import { contrastChecks } from '../src/web/contrastPairs';
import { colors, font, layout, space } from '../src/web/tokens';
import { buildTokensMarkdown } from '../src/web/tokensDoc';

describe('contrast math', () => {
  it('matches known WCAG reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
    expect(composite('rgba(255, 0, 0, 0.5)', '#000000')).toBe('#800000');
  });
});

describe.each(['dark', 'light'] as const)('WCAG 2.2 AA tokens (%s)', (theme) => {
  it.each(contrastChecks(theme).map((check) => [check.name, check] as const))('%s', (_name, check) => {
    expect(check.ratio, `${check.fg} sobre ${check.bg} = ${check.ratio.toFixed(2)}:1, mínimo ${check.min}:1`).toBeGreaterThanOrEqual(check.min);
  });
});

describe('design scale', () => {
  it('spacing is a multiple-of-4 scale', () => {
    for (const value of Object.values(space)) expect(value % 4).toBe(0);
  });
  it('touch target is at least 44px and content max width is ~1200px', () => {
    expect(layout.touchTarget).toBeGreaterThanOrEqual(44);
    expect(layout.maxContent).toBe(1200);
  });
  it('body text is at least 16px', () => {
    expect(font.size.md).toBeGreaterThanOrEqual(16);
  });
  it('both themes define the same tokens', () => {
    expect(Object.keys(colors.light).sort()).toEqual(Object.keys(colors.dark).sort());
  });
});

describe('documentation', () => {
  it('docs/web-design-tokens.md is up to date (run: npm run docs:tokens -w @xiro/mobile)', () => {
    const file = readFileSync(path.resolve(__dirname, '../docs/web-design-tokens.md'), 'utf8');
    expect(file).toBe(buildTokensMarkdown());
  });
});
