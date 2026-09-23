// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('trusted exact-candidate evaluator contract', () => {
  it('keeps the candidate networkless, hides real secrets and seals git metadata', () => {
    const controller = read('scripts/run-trusted-candidate-heldout-v15.ts');
    expect(controller).toContain("'--network', 'none'");
    expect(controller).toContain("dst=/work/.git,readonly");
    expect(controller).toContain('assertGitFileUnchanged(workspace, gitFileSnapshot)');
    const envStart = controller.indexOf("await fs.writeFile(envFile");
    const envEnd = controller.indexOf("const uid =", envStart);
    const envBlock = controller.slice(envStart, envEnd);
    expect(envBlock).toContain('ORIGIN_PROVIDER_PROXY_TOKEN');
    expect(envBlock).toContain('ORIGIN_VERIFIER_PROXY_TOKEN');
    expect(envBlock).not.toContain('OPENROUTER_API_KEY');
    expect(envBlock).not.toContain('ORIGIN_HELDOUT_FINAL_CORPUS_GZIP_B64');
  });

  it('uses a captured monotonic native clock instead of mutable Date.now for task budget evidence', () => {
    const runner = read('scripts/trusted-heldout-candidate-runner-v15.ts');
    expect(runner).toContain('const monotonicNow = process.hrtime.bigint');
    expect(runner).toContain('const startedAt = monotonicNow()');
    expect(runner).toContain('Number(monotonicNow() - startedAt) / 1_000_000');
    expect(runner).not.toContain('Date.now() - startedAt');
  });

  it('waits for both trusted proxies to exit before diff and hidden-test materialization', () => {
    const controller = read('scripts/run-trusted-candidate-heldout-v15.ts');
    const providerStop = controller.indexOf("await stopChild(proxy, 'TRUSTED_PROVIDER_PROXY')");
    const verifierStop = controller.indexOf("await stopChild(verifierProxy, 'TRUSTED_VERIFIER_PROXY')");
    const diff = controller.indexOf('const actualPaths = await actualChangedPaths(workspace)');
    const hiddenWrite = controller.indexOf('writeTrustedCandidateHiddenTestV15(workspace');
    expect(providerStop).toBeGreaterThan(0);
    expect(verifierStop).toBeGreaterThan(providerStop);
    expect(diff).toBeGreaterThan(verifierStop);
    expect(hiddenWrite).toBeGreaterThan(diff);
  });

  it('does not let gitignore or whitespace normalization hide candidate filesystem changes', () => {
    const controller = read('scripts/run-trusted-candidate-heldout-v15.ts');
    const changedPathsStart = controller.indexOf('async function actualChangedPaths');
    const changedPathsEnd = controller.indexOf('function visiblePacket', changedPathsStart);
    const changedPaths = controller.slice(changedPathsStart, changedPathsEnd);
    expect(changedPaths).toContain("['ls-files', '--others', '-z']");
    expect(changedPaths).not.toContain('--exclude-standard');
    expect(changedPaths).not.toContain('.trim()');
  });

  it('makes intermediate and final verification mounts read-only', () => {
    const controller = read('scripts/run-trusted-candidate-heldout-v15.ts');
    const verifier = read('scripts/trusted-heldout-verifier-proxy-v15.ts');
    expect(controller).toContain('dst=/work,readonly`');
    expect(verifier).toContain('dst=/work,readonly`');
    expect(controller).toContain('--outfile=/tmp/origin-dist/server.cjs');
    expect(verifier).toContain('--outfile=/tmp/origin-dist/server.cjs');
  });

  it('seals verification configuration before every intermediate verifier attempt', () => {
    const verifier = read('scripts/trusted-heldout-verifier-proxy-v15.ts');
    const guard = read('src/release/OriginTrustedCandidateWorkspaceGuardV15.ts');
    expect(verifier).toContain('assertTrustedCandidateVerificationBaselineV15(workspace)');
    expect(guard).toContain("['package-lock.json', '6ffbdaf5d08d45f3632432fec27324d840c6dce5']");
    expect(guard).toContain("['vite.config.ts', 'fa396109dd321106533a27070567fb77f30b6e90']");
    expect(guard).toContain("['tsconfig.json', '166577ad1b6c79a81519689f71b0769e7f465ff3']");
    expect(guard).toContain('assertTrustedCandidateVerificationBaselineV15(root)');
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

  it('never installs dependencies from candidate-controlled manifests on the trusted host', () => {
    const controller = read('scripts/run-trusted-candidate-heldout-v15.ts');
    expect(controller).not.toContain("execFixed('npm', ['ci'");
    expect(controller).toContain('const dependencyRoot = controllerRoot;');
    expect(controller).toContain('await assertTrustedCandidateVerificationBaselineV15(workspace);');
    const baseline = controller.indexOf('await assertTrustedCandidateVerificationBaselineV15(workspace);');
    const providerStart = controller.indexOf("proxy = spawn(process.execPath");
    expect(baseline).toBeGreaterThan(0);
    expect(providerStart).toBeGreaterThan(baseline);
  });

  it('uses owner-only Unix sockets and noexec tmpfs for candidate and verifier isolation', () => {
    const controller = read('scripts/run-trusted-candidate-heldout-v15.ts');
    const provider = read('scripts/trusted-heldout-provider-proxy-v15.ts');
    const verifier = read('scripts/trusted-heldout-verifier-proxy-v15.ts');
    const integration = read('scripts/trusted-provider-socket-isolation.integration.ts');
    expect(controller).toContain('/tmp:rw,nosuid,nodev,noexec,size=512m,mode=1777');
    expect(verifier).toContain('/tmp:rw,nosuid,nodev,noexec,size=512m,mode=1777');
    expect(integration).toContain('/tmp:rw,nosuid,nodev,noexec,size=32m,mode=1777');
    expect(provider).toContain('chmod(socketPath, 0o600)');
    expect(verifier).toContain('chmod(socketPath, 0o600)');
    expect(integration).toContain('chmod(socketPath, 0o600)');
  });

  it('keeps verifier commands fixed, serializes verification and bounds socket timing', () => {
    const verifier = read('scripts/trusted-heldout-verifier-proxy-v15.ts');
    expect(verifier).toContain("const commands: Record<CheckKind, string>");
    expect(verifier).toContain('if (active)');
    expect(verifier).toContain("code: 'TRUSTED_VERIFIER_BUSY'");
    expect(verifier).toContain("spawn('docker', ['rm', '-f', activeDockerName]");
    expect(verifier).toContain('server.maxConnections = 4');
    expect(verifier).toContain('server.headersTimeout = 5_000');
    expect(verifier).toContain('server.requestTimeout = 10_000');
    expect(verifier).not.toMatch(/req\.(?:body|query)|URLSearchParams/);
  });

  it('bounds provider Unix-socket connections and request timing', () => {
    const provider = read('scripts/trusted-heldout-provider-proxy-v15.ts');
    expect(provider).toContain('server.maxConnections = 8');
    expect(provider).toContain('server.headersTimeout = 5_000');
    expect(provider).toContain('server.requestTimeout = 10_000');
  });
});
