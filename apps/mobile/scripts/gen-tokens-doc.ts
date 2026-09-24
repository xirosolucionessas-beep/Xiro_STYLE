import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildTokensMarkdown } from '../src/web/tokensDoc';

const target = path.resolve(__dirname, '../docs/web-design-tokens.md');
mkdirSync(path.dirname(target), { recursive: true });
writeFileSync(target, buildTokensMarkdown());
console.log(`Escrito ${target}`);
