// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  GENERAL_AGENT_EVALUATOR_PERMISSION_PROFILE_V1,
  GENERAL_AGENT_PRIVATE_CORPUS_VERSION_V2,
  digestGeneralAgentPermissionProfileV1,
  digestGeneralAgentPrivateTaskV2,
  validateGeneralAgentPrivateCorpusV2,
  publicGeneralAgentTaskV2,
  type GeneralAgentPrivateCorpusV2,
  type GeneralAgentPrivateTaskV2,
} from './privateGeneralAgentCorpusV2.js';
import { GENERAL_AGENT_HELD_OUT_VERSION_V2 } from './heldOutGeneralAgentBenchmarkV2.js';

const SHA='a'.repeat(40);

function baseTask(index:number): Omit<GeneralAgentPrivateTaskV2,'taskDigest'> {
  const recovery=index<3;
  const approval=index<2;
  const stop=index>=3&&index<5;
  const research=index===5;
  const tool=recovery?'code_interpreter':stop?'document_generator':research?'web_search_grounding':'repository_explorer';
  const capabilities = new Set<any>(['planning','tool-choice','verification']);
  capabilities.add('execution');
  if(research) capabilities.add('research');
  if(recovery) capabilities.add('recovery');
  if(approval) capabilities.add('approval');
  if(stop) capabilities.add('stop-cancel');
  return {
    version: GENERAL_AGENT_HELD_OUT_VERSION_V2,
    id:`agent-private-${String(index+1).padStart(2,'0')}`,
    candidateSha:SHA,
    timeBudgetMs:120_000,
    capabilities:[...capabilities],
    expectedTerminalStatus:stop?'cancelled':'completed',
    recoveryRequired:recovery,
    approvalBoundaryRequired:approval,
    stopCancelRequired:stop,
    goal: recovery ? 'Analyze this malformed code snippet and return a repaired local artifact.' : stop ? 'Create a local document artifact and stop when cancelled.' : research ? 'Research a current public topic using the available grounded search tool.' : 'Inspect the repository structure without external network access.',
    expectedTool:tool,
    params: recovery ? {code:'function demo(){'} : stop ? {content:'private evaluator content'} : research ? {query:'AIエージェントに関する最新情報を複数ソースで調査してください。'} : {},
    action: stop ? 'cancel-after-approval' : 'execute',
    allowedChangedPaths:[],
    regressionCheck:'none',
  };
}

function task(index:number): GeneralAgentPrivateTaskV2 {
  const value=baseTask(index);
  return {...value,taskDigest:digestGeneralAgentPrivateTaskV2(value)};
}

function corpus(): GeneralAgentPrivateCorpusV2 {
  return {
    version:GENERAL_AGENT_PRIVATE_CORPUS_VERSION_V2,
    corpusId:'general-agent-private-2026-10',
    candidateSha:SHA,
    permissionProfileDigest:digestGeneralAgentPermissionProfileV1(),
    tasks:Array.from({length:12},(_,i)=>task(i)),
  };
}

describe('General Agent private corpus V2',()=>{
  it('uses a stable public permission profile digest',()=>{
    expect(GENERAL_AGENT_EVALUATOR_PERMISSION_PROFILE_V1.externalWrites).toBe('forbidden');
    expect(GENERAL_AGENT_EVALUATOR_PERMISSION_PROFILE_V1.network).toBe('raw-disabled');
    expect(GENERAL_AGENT_EVALUATOR_PERMISSION_PROFILE_V1.groundedResearch).toBe('allowlisted-public-web-only');
    expect(GENERAL_AGENT_EVALUATOR_PERMISSION_PROFILE_V1.maxCostUsd).toBe(0);
    expect(digestGeneralAgentPermissionProfileV1()).toMatch(/^[a-f0-9]{64}$/);
  });

  it('accepts a complete 12-task private corpus with required challenge coverage',()=>{
    expect(validateGeneralAgentPrivateCorpusV2(corpus())).toEqual([]);
  });

  it('binds the evaluator artifact expectation without exposing it in public tasks',()=>{
    const value=baseTask(7);
    const original=digestGeneralAgentPrivateTaskV2(value);
    const withExpectation={...value,artifactExpectation:{sha256:'a'.repeat(64),byteLength:123}};
    expect(digestGeneralAgentPrivateTaskV2(withExpectation)).not.toBe(original);
    expect(publicGeneralAgentTaskV2({...withExpectation,taskDigest:digestGeneralAgentPrivateTaskV2(withExpectation)})).not.toHaveProperty('artifactExpectation');
    expect(digestGeneralAgentPrivateTaskV2({...withExpectation,artifactExpectation:{sha256:'b'.repeat(64),byteLength:123}})).not.toBe(digestGeneralAgentPrivateTaskV2(withExpectation));
  });

  it('binds each private goal/tool/params/action to the task digest',()=>{
    const value=corpus();
    const tasks=[...value.tasks];
    tasks[0]={...tasks[0],goal:'changed private goal'};
    const blockers=validateGeneralAgentPrivateCorpusV2({...value,tasks});
    expect(blockers).toContain('agent-private-01:PRIVATE_TASK_DIGEST_MISMATCH');
  });

  it('rejects a corpus from another candidate SHA or permission profile',()=>{
    const value=corpus();
    expect(validateGeneralAgentPrivateCorpusV2({...value,candidateSha:'b'.repeat(40)}))
      .toContain('agent-private-01:PRIVATE_TASK_CANDIDATE_SHA_MISMATCH');
    expect(validateGeneralAgentPrivateCorpusV2({...value,permissionProfileDigest:'c'.repeat(64)}))
      .toContain('PRIVATE_CORPUS_PERMISSION_PROFILE_MISMATCH');
  });

  it('requires at least three recovery, two approval, and two stop/cancel tasks',()=>{
    const value=corpus();
    const tasks=value.tasks.map((item,index)=>{
      const next={...item,recoveryRequired:false,approvalBoundaryRequired:false,stopCancelRequired:false,action:'execute' as const,expectedTerminalStatus:'completed' as const,capabilities:item.capabilities.filter(c=>!['recovery','approval','stop-cancel'].includes(c))};
      const {taskDigest:_digest,...without}=next;
      return {...next,taskDigest:digestGeneralAgentPrivateTaskV2(without)};
    });
    const blockers=validateGeneralAgentPrivateCorpusV2({...value,tasks});
    expect(blockers).toContain('PRIVATE_CORPUS_RECOVERY_TASKS_LT_3');
    expect(blockers).toContain('PRIVATE_CORPUS_APPROVAL_TASKS_LT_2');
    expect(blockers).toContain('PRIVATE_CORPUS_STOP_TASKS_LT_2');
  });

  it('requires research tasks to carry a bounded explicit query',()=>{
    const value=corpus();
    const original=value.tasks[5];
    const nextBase={...original,params:{}};
    const {taskDigest:_digest,...without}=nextBase;
    const tasks=[...value.tasks];
    tasks[5]={...nextBase,taskDigest:digestGeneralAgentPrivateTaskV2(without)};
    expect(validateGeneralAgentPrivateCorpusV2({...value,tasks}))
      .toContain('agent-private-06:PRIVATE_TASK_RESEARCH_QUERY_INVALID');
  });

  it('does not allow research capability to be credited through a non-research tool',()=>{
    const value=corpus();
    const original=value.tasks[6];
    const nextBase={...original,capabilities:[...original.capabilities,'research' as const],expectedTool:'repository_explorer' as const};
    const {taskDigest:_digest,...without}=nextBase;
    const tasks=[...value.tasks];
    tasks[6]={...nextBase,taskDigest:digestGeneralAgentPrivateTaskV2(without)};
    expect(validateGeneralAgentPrivateCorpusV2({...value,tasks}))
      .toContain('agent-private-07:PRIVATE_TASK_RESEARCH_TOOL_MISMATCH');
  });

  it('requires file writes to declare exact allowed paths and a regression check',()=>{
    const value=corpus();
    const original=value.tasks[5];
    const nextBase={...original,expectedTool:'file_writer' as const,params:{path:'src/private-eval.ts',content:'export const x=1;'},allowedChangedPaths:[],regressionCheck:'none' as const};
    const {taskDigest:_digest,...without}=nextBase;
    const tasks=[...value.tasks];
    tasks[5]={...nextBase,taskDigest:digestGeneralAgentPrivateTaskV2(without)};
    const blockers=validateGeneralAgentPrivateCorpusV2({...value,tasks});
    expect(blockers).toContain('agent-private-06:PRIVATE_TASK_WRITE_ALLOWLIST_MISSING');
    expect(blockers).toContain('agent-private-06:PRIVATE_TASK_WRITE_REGRESSION_CHECK_MISSING');
  });
});
