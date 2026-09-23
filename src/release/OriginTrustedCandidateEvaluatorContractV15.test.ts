// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('trusted exact-candidate evaluator contract', () => {
  it('keeps the candidate networkless and provider credentials out of its env-file', () => {
    const controller = read('scripts/run-trusted-candidate-heldout-v15.ts');
    expect(controller).toContain("'--network', 'none'");
    const envStart = controller.indexOf("await fs.writeFile(envFile");
    const envEnd = controller.indexOf("const uid =", envStart);
    const envBlock = controller.slice(envStart, envEnd);
    expect(envBlock).toContain('ORIGIN_PROVIDER_PROXY_TOKEN');
    expect(envBlock).toContain('ORIGIN_VERIFIER_PROXY_TOKEN');
    expect(envBlock).not.toContain('OPENROUTER_API_KEY');
    expect(envBlock).not.toContain('ORIGIN_HELDOUT_FINAL_CORPUS_GZIP_B64');
  });

  it('stops both trusted proxies before hidden tests are materialized', () => {
    const controller = read('scripts/run-trusted-candidate-heldout-v15.ts');
    const providerStop = controller.indexOf("proxy.kill('SIGTERM')");
    const verifierStop = controller.indexOf("verifierProxy.kill('SIGTERM')");
    const hiddenWrite = controller.indexOf('writeTrustedCandidateHiddenTestV15(workspace');
    expect(providerStop).toBeGreaterThan(0);
    expect(verifierStop).toBeGreaterThan(providerStop);
    expect(hiddenWrite).toBeGreaterThan(verifierStop);
  });

  it('requires an append-only commit-status reservation before benchmark execution', () => {
    const workflow = read('.github/workflows/trusted-candidate-heldout-v15.yml');
    expect(workflow).toContain('statuses: write');
    expect(workflow).toContain('group: origin-held-out-final-one-shot');
    expect(workflow).toContain('Reserve append-only one-shot status ledger before provider execution');
    expect(workflow).toContain('/statuses/${ANCHOR_SHA}');
    expect(workflow).toContain('benchmark:\n    needs: preflight');
    expect(workflow.indexOf('Reserve append-only one-shot status ledger before provider execution'))
      .toBeLessThan(workflow.indexOf('Reserve the sealed source corpus before provider execution'));
  });

  it('keeps V14 and V15 on the same append-only one-shot ledger', () => {
    const v14 = read('.github/workflows/held-out-coding-final-v14.yml');
    const v15 = read('.github/workflows/trusted-candidate-heldout-v15.yml');
    expect(v14).toContain('group: origin-held-out-final-one-shot');
    expect(v15).toContain('group: origin-held-out-final-one-shot');
    expect(v14).toContain('origin/heldout-source/');
    expect(v15).toContain('origin/heldout-source/');
    expect(v14).toContain('/statuses/01f7db0c0d48ab3ba533148e99e1847203e13f4c');
    expect(v15).toContain('/statuses/${ANCHOR_SHA}');
  });

  it('keeps verifier commands fixed and bounds socket concurrency', () => {
    const verifier = read('scripts/trusted-heldout-verifier-proxy-v15.ts');
    expect(verifier).toContain("const commands: Record<CheckKind, string>");
    expect(verifier).toContain('server.maxConnections = 8');
    expect(verifier).not.toMatch(/req\.(?:body|query)|URLSearchParams/);
  });
});
