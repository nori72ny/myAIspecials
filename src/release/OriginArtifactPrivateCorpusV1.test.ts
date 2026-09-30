// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  ARTIFACT_CHALLENGE_TAGS_V1,
  ARTIFACT_FAMILIES_V1,
  type ArtifactBenchmarkCaseV1,
} from './OriginArtifactBlindBenchmarkV1.js';
import {
  ORIGIN_ARTIFACT_PRIVATE_CORPUS_SCHEMA_V1,
  digestArtifactPrivateTaskV1,
  sha256ArtifactPrivateTextV1,
  validateArtifactPrivateCorpusV1,
  type ArtifactPrivateTaskV1,
  type OriginArtifactPrivateCorpusV1,
} from './OriginArtifactPrivateCorpusV1.js';

const SHA='a'.repeat(40);
const formats: Record<(typeof ARTIFACT_FAMILIES_V1)[number], ArtifactBenchmarkCaseV1['expectedFormat']> = {
  'docx-business-document':'docx',
  'xlsx-analysis':'xlsx',
  'pptx-presentation':'pptx',
  'pdf-report':'pdf',
  'web-landing-page':'html-zip',
  'web-interactive-app':'html-zip',
  'data-report':'csv',
  'revision-editability':'docx',
};

function requirements(family:(typeof ARTIFACT_FAMILIES_V1)[number]) {
  if(family==='docx-business-document') return ['required-content','structured-headings','editable-source'] as const;
  if(family==='xlsx-analysis') return ['required-content','table-structure','editable-source'] as const;
  if(family==='pptx-presentation') return ['required-content','multi-slide','editable-source'] as const;
  if(family==='pdf-report') return ['required-content','multi-section'] as const;
  if(family==='web-landing-page'||family==='web-interactive-app') return ['required-content','responsive-layout','offline-runtime','editable-source'] as const;
  if(family==='data-report') return ['required-content'] as const;
  return ['required-content','editable-source'] as const;
}

function task(index:number,family:(typeof ARTIFACT_FAMILIES_V1)[number]):ArtifactPrivateTaskV1 {
  const prompt=`Create synthetic benchmark work product ${index+1} with anchor ANCHOR_${index+1}.`;
  const tagA=ARTIFACT_CHALLENGE_TAGS_V1[index%ARTIFACT_CHALLENGE_TAGS_V1.length];
  const tagB=ARTIFACT_CHALLENGE_TAGS_V1[(index+4)%ARTIFACT_CHALLENGE_TAGS_V1.length];
  const base={
    caseId:`artifact-private-${String(index+1).padStart(2,'0')}`,
    family,
    challengeTags:[tagA,tagB],
    expectedFormat:formats[family],
    prompt,
    promptSha256:sha256ArtifactPrivateTextV1(prompt),
    requiredContent:[`ANCHOR_${index+1}`],
    technicalRequirements:[...requirements(family)],
  };
  return {...base,taskDigest:digestArtifactPrivateTaskV1(base)};
}

function corpus():OriginArtifactPrivateCorpusV1 {
  const tasks:ArtifactPrivateTaskV1[]=[];
  let index=0;
  for(const family of ARTIFACT_FAMILIES_V1){
    tasks.push(task(index++,family));
    tasks.push(task(index++,family));
  }
  return {
    schema:ORIGIN_ARTIFACT_PRIVATE_CORPUS_SCHEMA_V1,
    corpusId:'artifact-private-2026-10',
    candidateSha:SHA,
    executionBudgetMs:120_000,
    syntheticEvaluationOnly:true,
    tasks,
  };
}

describe('Artifact private corpus V1',()=>{
  it('accepts exactly 16 synthetic tasks with two cases per family and broad challenge coverage',()=>{
    expect(validateArtifactPrivateCorpusV1(corpus())).toEqual([]);
  });

  it('rejects non-synthetic corpus material at the external-provider boundary',()=>{
    const value=corpus() as any;
    value.syntheticEvaluationOnly=false;
    expect(validateArtifactPrivateCorpusV1(value)).toContain('ARTIFACT_PRIVATE_CORPUS_SYNTHETIC_ONLY_REQUIRED');
  });

  it('binds private prompt and technical expectations to immutable digests',()=>{
    const value=corpus();
    const tasks=[...value.tasks];
    tasks[0]={...tasks[0],prompt:'changed after sealing'};
    const blockers=validateArtifactPrivateCorpusV1({...value,tasks});
    expect(blockers).toContain('artifact-private-01:ARTIFACT_PRIVATE_TASK_PROMPT_DIGEST_MISMATCH');
    expect(blockers).toContain('artifact-private-01:ARTIFACT_PRIVATE_TASK_DIGEST_MISMATCH');
  });

  it('enforces family-format compatibility',()=>{
    const value=corpus();
    const original=value.tasks[0];
    const changed={...original,expectedFormat:'xlsx' as const};
    const {taskDigest:_old,...without}=changed;
    const tasks=[...value.tasks];
    tasks[0]={...changed,taskDigest:digestArtifactPrivateTaskV1(without)};
    expect(validateArtifactPrivateCorpusV1({...value,tasks}))
      .toContain('artifact-private-01:ARTIFACT_PRIVATE_TASK_FORMAT_INVALID');
  });

  it('requires task-specific deterministic checks rather than format validity alone',()=>{
    const value=corpus();
    const original=value.tasks[2];
    const changed={...original,technicalRequirements:['required-content'] as any};
    const {taskDigest:_old,...without}=changed;
    const tasks=[...value.tasks];
    tasks[2]={...changed,taskDigest:digestArtifactPrivateTaskV1(without)};
    expect(validateArtifactPrivateCorpusV1({...value,tasks}))
      .toContain('artifact-private-03:ARTIFACT_PRIVATE_TASK_REQUIRED_TECHNICAL_MISSING:table-structure');
  });
});
