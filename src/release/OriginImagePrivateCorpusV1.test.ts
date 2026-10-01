// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  IMAGE_CHALLENGE_TAGS_V15,
  IMAGE_FAMILIES_V15,
} from './OriginImageBlindBenchmarkV15.js';
import {
  ORIGIN_IMAGE_PRIVATE_CORPUS_SCHEMA_V1,
  digestImagePrivateTaskV1,
  sha256ImagePrivateTextV1,
  validateImagePrivateCorpusV1,
  type ImagePrivateTaskV1,
  type OriginImagePrivateCorpusV1,
} from './OriginImagePrivateCorpusV1.js';

const SHA='a'.repeat(40);

function task(index:number,family:(typeof IMAGE_FAMILIES_V15)[number]):ImagePrivateTaskV1{
  const prompt=`Synthetic benchmark image ${index+1}; include marker MARK_${index+1} only when requested.`;
  const tagA=IMAGE_CHALLENGE_TAGS_V15[index%IMAGE_CHALLENGE_TAGS_V15.length];
  const tagB=IMAGE_CHALLENGE_TAGS_V15[(index+3)%IMAGE_CHALLENGE_TAGS_V15.length];
  const tags=[tagA,tagB] as ImagePrivateTaskV1['challengeTags'];
  const requiresText=tags.includes('text');
  const base={
    caseId:`image-private-${String(index+1).padStart(2,'0')}`,
    family,
    challengeTags:tags,
    prompt,
    negativePrompt:'watermark, unsafe content',
    promptSha256:sha256ImagePrivateTextV1(prompt),
    width:512,
    height:512,
    requiresText,
  };
  return {...base,taskDigest:digestImagePrivateTaskV1(base)};
}

function corpus():OriginImagePrivateCorpusV1{
  const tasks:ImagePrivateTaskV1[]=[];
  let index=0;
  for(const family of IMAGE_FAMILIES_V15){
    for(let i=0;i<3;i+=1) tasks.push(task(index++,family));
  }
  return {
    schema:ORIGIN_IMAGE_PRIVATE_CORPUS_SCHEMA_V1,
    corpusId:'image-private-2026-10',
    candidateSha:SHA,
    executionBudgetMs:120_000,
    syntheticEvaluationOnly:true,
    tasks,
  };
}

describe('Image private corpus V1',()=>{
  it('accepts exactly 24 synthetic tasks, three per family, with challenge coverage',()=>{
    expect(validateImagePrivateCorpusV1(corpus())).toEqual([]);
  });

  it('rejects non-synthetic external-provider material',()=>{
    const value=corpus() as any;
    value.syntheticEvaluationOnly=false;
    expect(validateImagePrivateCorpusV1(value)).toContain('IMAGE_PRIVATE_CORPUS_SYNTHETIC_ONLY_REQUIRED');
  });

  it('binds prompt and dimensions to immutable task digests',()=>{
    const value=corpus();
    const tasks=[...value.tasks];
    tasks[0]={...tasks[0],width:768};
    const blockers=validateImagePrivateCorpusV1({...value,tasks});
    expect(blockers).toContain('image-private-01:IMAGE_PRIVATE_TASK_DIGEST_MISMATCH');
  });

  it('requires text tasks to carry the text challenge tag',()=>{
    const value=corpus();
    const original=value.tasks.find((item)=>!item.challengeTags.includes('text'))!;
    const changed={...original,requiresText:true};
    const {taskDigest:_old,...without}=changed;
    const tasks=value.tasks.map((item)=>item.caseId===original.caseId?{...changed,taskDigest:digestImagePrivateTaskV1(without)}:item);
    expect(validateImagePrivateCorpusV1({...value,tasks}))
      .toContain(`${original.caseId}:IMAGE_PRIVATE_TASK_TEXT_TAG_REQUIRED`);
  });
});
