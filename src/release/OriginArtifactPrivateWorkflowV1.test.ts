// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow=readFileSync(resolve(process.cwd(),'.github/workflows/artifact-private-heldout-v1.yml'),'utf8');

describe('Artifact private held-out workflow V1',()=>{
  it('is manual-only and main-only with exact SHA binding',()=>{
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toContain('\n  push:');
    expect(workflow).not.toContain('\n  pull_request:');
    expect(workflow).not.toContain('\n  schedule:');
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain('test "$CANDIDATE_SHA" = "$GITHUB_SHA"');
    expect(workflow).toContain('test "$(git rev-parse HEAD)" = "$CANDIDATE_SHA"');
  });

  it('takes sealed content and provider key only from GitHub secrets',()=>{
    expect(workflow).toContain('secrets.ORIGIN_ARTIFACT_PRIVATE_CORPUS_GZIP_B64');
    expect(workflow).toContain('secrets.OPENROUTER_API_KEY');
    expect(workflow).toContain('candidate_sha:');
    expect(workflow).toContain('corpus_id:');
    expect(workflow).not.toContain('prompt:');
    expect(workflow).not.toContain('required_content:');
    expect(workflow).not.toContain('corpus_base64:');
  });

  it('creates the one-shot marker before candidate provider execution',()=>{
    const marker=workflow.indexOf('Preserve one-shot marker before provider execution');
    const run=workflow.indexOf('Run sealed 16-case candidate artifact round');
    expect(marker).toBeGreaterThan(0);
    expect(run).toBeGreaterThan(marker);
    expect(workflow).toContain('origin-artifact-private-started-${{ steps.metadata.outputs.corpus_digest }}');
  });

  it('uploads generated work products and sanitized evidence, never the corpus secret',()=>{
    expect(workflow).toContain('public-tasks.json');
    expect(workflow).toContain('candidate-evidence.json');
    expect(workflow).toContain('candidate-summary.json');
    expect(workflow).toContain('candidate-artifacts');
    expect(workflow).not.toContain('private-corpus.json');
    expect(workflow).not.toContain('sealed-corpus.json');
  });

  it('does not structurally retry provider output or fan out samples',()=>{
    expect(workflow).not.toContain('for attempt in');
    expect(workflow).not.toContain('strategy:');
    expect(workflow).not.toContain('matrix:');
    expect(workflow).not.toContain('continue-on-error: true');
    expect(workflow.match(/npm run eval:artifact-private/g)).toHaveLength(1);
  });
});
