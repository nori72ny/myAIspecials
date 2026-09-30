// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  resolve(process.cwd(), '.github/workflows/general-agent-trusted-external-comparison-v2.yml'),
  'utf8',
);
const assembler = readFileSync(
  resolve(process.cwd(), 'scripts/assemble-general-agent-trusted-comparison-v2.ts'),
  'utf8',
);
const comparator = readFileSync(
  resolve(process.cwd(), 'src/agent/trustedGeneralAgentComparisonV2.ts'),
  'utf8',
);

describe('General Agent trusted external comparison workflow', () => {
  it('is manual-only on main and exact current SHA bound', () => {
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toContain('\n  push:');
    expect(workflow).not.toContain('\n  pull_request:');
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain("sha!==process.env.GITHUB_SHA");
    expect(workflow).toContain('test "$(git rev-parse HEAD)" = "$CANDIDATE_SHA"');
  });

  it('requires the candidate artifact to come from the exact successful private-runner workflow', () => {
    expect(workflow).toContain("run?.head_sha!==process.env.CANDIDATE_SHA");
    expect(workflow).toContain("run?.head_branch!=='main'");
    expect(workflow).toContain("run?.event!=='workflow_dispatch'");
    expect(workflow).toContain("run?.conclusion!=='success'");
    expect(workflow).toContain("run?.path!=='.github/workflows/general-agent-private-heldout-v2.yml'");
    expect(workflow).toContain("'GENERAL_AGENT_CANDIDATE_RUN_WORKFLOW_INVALID'");
  });

  it('downloads exactly the sanitized candidate artifact for that run id', () => {
    expect(workflow).toContain("expected='general-agent-private-v2-'+process.env.CANDIDATE_RUN_ID");
    expect(workflow).toContain("row?.expired===false");
    expect(workflow).toContain('public-tasks.json');
    expect(workflow).toContain('candidate-trusted-evidence.json');
    expect(workflow).toContain('candidate-score-summary.json');
  });

  it('accepts reference runs only through the GitHub secret', () => {
    expect(workflow).toContain(
      'ORIGIN_GENERAL_AGENT_REFERENCE_PACK_GZIP_B64: ${{ secrets.ORIGIN_GENERAL_AGENT_REFERENCE_PACK_GZIP_B64 }}',
    );
    expect(workflow).not.toContain('reference_runs:');
    expect(workflow).not.toContain('reference_json:');
    expect(workflow).not.toContain('task_prompt:');
  });

  it('binds reference pack to exact candidate, corpus and permission profile', () => {
    expect(assembler).toContain('GENERAL_AGENT_REFERENCE_PACK_SHA_MISMATCH');
    expect(assembler).toContain('GENERAL_AGENT_REFERENCE_PACK_CORPUS_ID_MISMATCH');
    expect(assembler).toContain('GENERAL_AGENT_REFERENCE_PACK_CORPUS_DIGEST_MISMATCH');
    expect(assembler).toContain('GENERAL_AGENT_REFERENCE_PACK_PERMISSION_DIGEST_MISMATCH');
    expect(assembler).toContain('GENERAL_AGENT_REFERENCE_PACK_REFERENCES_LT_2');
  });

  it('computes artifact digests from exact run contents rather than trusting supplied summaries', () => {
    expect(assembler).toContain('digestGeneralAgentTrustedReferenceArtifactV2');
    expect(assembler).toContain('digestGeneralAgentTrustedRoundArtifactV2');
    expect(comparator).toContain(
      'reference.artifactDigest === digestGeneralAgentTrustedReferenceArtifactV2',
    );
    expect(comparator).toContain(
      'evidence.artifactDigest === digestGeneralAgentTrustedRoundArtifactV2',
    );
  });

  it('uploads the full trusted comparison input and report without private task prompts', () => {
    expect(assembler).toContain("'trusted-comparison-input.json'");
    expect(assembler).toContain("'trusted-comparison-report.json'");
    expect(workflow).toContain('test-results/general-agent-trusted-comparison/');
    expect(assembler).not.toContain('taskPrompt');
    expect(assembler).not.toContain('privateGoal');
  });
});
