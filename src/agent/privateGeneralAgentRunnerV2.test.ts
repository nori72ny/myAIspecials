// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow=readFileSync(resolve(process.cwd(),'.github/workflows/general-agent-private-heldout-v2.yml'),'utf8');
const runner=readFileSync(resolve(process.cwd(),'scripts/run-general-agent-private-v2.ts'),'utf8');

describe('General Agent private runner workflow',()=>{
  it('is manual-only on main and exact-SHA bound',()=>{
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toContain('\n  push:');
    expect(workflow).not.toContain('\n  pull_request:');
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain("sha!==process.env.GITHUB_SHA");
    expect(workflow).toContain('test "$(git rev-parse HEAD)" = "$CANDIDATE_SHA"');
  });

  it('accepts private task content only through a GitHub secret',()=>{
    expect(workflow).toContain("ORIGIN_GENERAL_AGENT_PRIVATE_CORPUS_GZIP_B64: ${{ secrets.ORIGIN_GENERAL_AGENT_PRIVATE_CORPUS_GZIP_B64 }}");
    expect(workflow).toContain('corpus_id:');
    expect(workflow).not.toContain('goal:');
    expect(workflow).not.toContain('params:');
    expect(workflow).not.toContain('task_json:');
  });

  it('uploads only public tasks, trusted event evidence and score summary',()=>{
    expect(workflow).toContain('public-tasks.json');
    expect(workflow).toContain('candidate-trusted-evidence.json');
    expect(workflow).toContain('candidate-score-summary.json');
    expect(workflow).not.toContain('private-corpus.json');
    expect(runner).not.toContain("writeFile(path.join(outputDir, 'private");
  });

  it('executes the real Agent V3 HTTP contract rather than constructing success booleans directly',()=>{
    expect(runner).toContain("createAgentOrchestratorV3Router");
    expect(runner).toContain("'/api/agent/v3/plan'");
    expect(runner).toContain("'/api/agent/v3/approval'");
    expect(runner).toContain("'/api/agent/v3/execute'");
    expect(runner).toContain("'/api/agent/v3/cancel'");
    expect(runner).toContain("buildTrustedGeneralAgentRunV2");
    expect(runner).toContain("scoreGeneralAgentHeldOutRunV2");
  });

  it('does not award research capability from tool selection alone',()=>{
    const completedIndex=runner.indexOf("execution.status === 200");
    const researchCreditIndex=runner.indexOf("capability: 'research'");
    expect(completedIndex).toBeGreaterThan(0);
    expect(researchCreditIndex).toBeGreaterThan(completedIndex);
    expect(runner).not.toContain('capabilityForTool');
  });

  it('tests approval and cancellation boundaries through rejected HTTP operations',()=>{
    expect(runner).toContain("'invalid-evaluator-probe'");
    expect(runner).toContain("'AGENT_AUTHENTICATED_APPROVAL_REQUIRED'");
    expect(runner).toContain("'AGENT_RUN_ALREADY_CONSUMED'");
    expect(runner).toContain("'approval-boundary-respected'");
    expect(runner).toContain("'stop-cancel-respected'");
  });

  it('checks workspace side effects and restores the disposable checkout after each task',()=>{
    expect(runner).toContain("git(['status', '--porcelain=v1', '--untracked-files=all'])");
    expect(runner).toContain("git(['reset', '--hard', 'HEAD'])");
    expect(runner).toContain("git(['clean', '-fd'])");
    expect(runner).toContain("'unapproved-external-write'");
    expect(runner).toContain("'regression-detected'");
  });

  it('does not print private goals or params in the public completion event',()=>{
    expect(runner).toContain("event: 'general-agent-private-round-completed'");
    expect(runner).not.toContain('goal: task.goal');
    expect(runner).not.toContain('params: task.params');
  });
});
