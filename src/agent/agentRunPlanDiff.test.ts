// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { agentRunPlanParamsEqual, diffAgentRunPlans } from './agentRunPlanDiff.js';
import type { AgentRunPlanStep } from './agentRunRecord.js';

const step = (toolName: AgentRunPlanStep['toolName'], params: AgentRunPlanStep['params'] = {}): AgentRunPlanStep => ({
  toolName,
  params,
  dependsOn: [],
});

describe('diffAgentRunPlans', () => {
  it('reports an identical re-plan as unchanged', () => {
    const diff = diffAgentRunPlans(
      [step('document_generator', { title: 'Report' }), step('file_writer', { path: 'a.md' })],
      [
        { toolName: 'document_generator', params: { title: 'Report' } },
        { toolName: 'file_writer', params: { path: 'a.md' } },
      ],
    );
    expect(diff.changed).toBe(false);
    expect(diff.previousStepCount).toBe(2);
    expect(diff.nextStepCount).toBe(2);
    expect(diff.steps.map((entry) => entry.change)).toEqual(['unchanged', 'unchanged']);
  });

  it('ignores object key order in params (store round trips stay unchanged)', () => {
    expect(agentRunPlanParamsEqual({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 })).toBe(true);
    const diff = diffAgentRunPlans(
      [step('document_generator', { title: 'Report', format: 'pdf' })],
      [{ toolName: 'document_generator', params: { format: 'pdf', title: 'Report' } }],
    );
    expect(diff.changed).toBe(false);
  });

  it('marks a params-only change as modified with paramsChanged', () => {
    const diff = diffAgentRunPlans(
      [step('document_generator', { title: 'Old' })],
      [{ toolName: 'document_generator', params: { title: 'New' } }],
    );
    expect(diff.changed).toBe(true);
    expect(diff.steps[0]).toEqual({
      index: 0,
      change: 'modified',
      toolName: 'document_generator',
      previousToolName: 'document_generator',
      paramsChanged: true,
    });
  });

  it('marks a tool change as modified and names both tools', () => {
    const diff = diffAgentRunPlans(
      [step('file_reader', { path: 'x.ts' })],
      [{ toolName: 'document_generator', params: { title: 'Doc' } }],
    );
    expect(diff.steps[0].change).toBe('modified');
    expect(diff.steps[0].previousToolName).toBe('file_reader');
    expect(diff.steps[0].toolName).toBe('document_generator');
    expect(diff.steps[0].paramsChanged).toBe(true);
  });

  it('reports added and removed tail steps', () => {
    const grown = diffAgentRunPlans(
      [step('repository_explorer')],
      [
        { toolName: 'repository_explorer', params: {} },
        { toolName: 'verification_runner', params: {} },
      ],
    );
    expect(grown.steps.map((entry) => entry.change)).toEqual(['unchanged', 'added']);
    expect(grown.steps[1].previousToolName).toBeNull();

    const shrunk = diffAgentRunPlans(
      [step('repository_explorer'), step('verification_runner')],
      [{ toolName: 'repository_explorer', params: {} }],
    );
    expect(shrunk.steps.map((entry) => entry.change)).toEqual(['unchanged', 'removed']);
    expect(shrunk.steps[1].toolName).toBeNull();
    expect(shrunk.changed).toBe(true);
  });

  it('diffs a goal-only held run (no stored plan) as all steps added', () => {
    const diff = diffAgentRunPlans(null, [{ toolName: 'document_generator', params: {} }]);
    expect(diff.previousStepCount).toBe(0);
    expect(diff.changed).toBe(true);
    expect(diff.steps[0].change).toBe('added');
  });
});
