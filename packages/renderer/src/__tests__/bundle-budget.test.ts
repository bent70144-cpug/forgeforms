// T28 (issue #28) — renderer bundle budget gate (spec §15 M3 acceptance:
// "Renderer bundle ≤ 120 KB gzipped (CI check)").
//
// What is measured: the conversational renderer's browser payload —
// packages/renderer sources PLUS the workspace packages it inlines
// (@formforge/blocks, @formforge/core), minified and gzipped. react/react-dom
// stay external: the host application (Next app / embed host) provides them,
// the same way Node built-ins are external for server bundles.
//
// The gate runs as a unit test so `pnpm test` fails locally and in CI on
// regression (spec §16 CI rule: no bundle-size regression).
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const BUDGET_BYTES = 120 * 1024; // spec §15 M3: ≤120 KB gzipped

describe('renderer bundle budget (≤120 KB gzipped, spec §15 M3)', () => {
  it('minified+gzipped conversational payload stays under budget', async () => {
    const { build } = await import('esbuild');
    const entry = fileURLToPath(new URL('../conversational/index.ts', import.meta.url));

    const result = await build({
      entryPoints: [entry],
      bundle: true,
      minify: true,
      format: 'esm',
      target: 'es2020',
      jsx: 'automatic',
      platform: 'browser',
      external: ['react', 'react-dom'],
      write: false,
      legalComments: 'none',
      logLevel: 'silent',
    });

    const js = result.outputFiles[0];
    expect(js, 'esbuild produced a JS output').toBeDefined();
    const raw = Buffer.from(js!.contents);
    const gzipped = gzipSync(raw, { level: 9 });
    const kb = gzipped.byteLength / 1024;
    // eslint-disable-next-line no-console
    console.log(
      `[bundle-budget] renderer conversational payload: ${raw.byteLength} bytes raw, ${gzipped.byteLength} bytes gzipped (${kb.toFixed(1)} KB) — budget ${BUDGET_BYTES / 1024} KB`,
    );
    expect(gzipped.byteLength).toBeLessThanOrEqual(BUDGET_BYTES);
  });
});
