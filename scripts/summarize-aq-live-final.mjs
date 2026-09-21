import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const FAMILIES=["current-factual","multi-source-comparison","contradiction-detection","user-document-reasoning","professional-advice","coding-generation","coding-repair","artifact-generation","ambiguity-handling","fail-closed"];
function req(n){const v=process.env[n]?.trim();if(!v)throw new Error(`AQ_FINAL_SUMMARY_ENV_MISSING:${n}`);return v;}
function mean(v){return v.length?v.reduce((a,b)=>a+b,0)/v.length:0;}
function delta(b,c){const br=b.filter(x=>x.repairSucceeded!==undefined),cr=c.filter(x=>x.repairSucceeded!==undefined);return{
 factualSupportDelta:mean(c.map(x=>x.factualSupportScore))-mean(b.map(x=>x.factualSupportScore)),
 citationPrecisionDelta:mean(c.map(x=>x.citationPrecisionScore))-mean(b.map(x=>x.citationPrecisionScore)),
 taskCompletionDelta:mean(c.map(x=>x.taskCompletionScore))-mean(b.map(x=>x.taskCompletionScore)),
 contradictionDetectionDelta:mean(c.map(x=>x.contradictionDetectionScore))-mean(b.map(x=>x.contradictionDetectionScore)),
 unsupportedMaterialClaimDelta:c.reduce((s,x)=>s+x.unsupportedMaterialClaimCount,0)-b.reduce((s,x)=>s+x.unsupportedMaterialClaimCount,0),
 verifierRejectionRateDelta:mean(c.map(x=>x.verifierRejectedUnsupportedClaim?1:0))-mean(b.map(x=>x.verifierRejectedUnsupportedClaim?1:0)),
 repairSuccessRateDelta:br.length&&cr.length?mean(cr.map(x=>x.repairSucceeded?1:0))-mean(br.map(x=>x.repairSucceeded?1:0)):null};}
function critical(d){return d.unsupportedMaterialClaimDelta>0||d.verifierRejectionRateDelta<0||d.factualSupportDelta<0||d.taskCompletionDelta<0||d.citationPrecisionDelta<0||d.contradictionDetectionDelta<0||(d.repairSuccessRateDelta!==null&&d.repairSuccessRateDelta<0);}
function improved(d){return d.factualSupportDelta>0||d.citationPrecisionDelta>0||d.taskCompletionDelta>0||d.contradictionDetectionDelta>0||d.unsupportedMaterialClaimDelta<0||d.verifierRejectionRateDelta>0||(d.repairSuccessRateDelta!==null&&d.repairSuccessRateDelta>0);}
async function main(){
 const dir=path.resolve(req("AQ_STATE_DIR")),aggregatePath=path.resolve(req("AQ_AGGREGATE_PATH")),outputPath=path.resolve(req("AQ_PROMOTION_OUTPUT_PATH")),count=Number(req("EXPECTED_SHARD_COUNT")),candidateSha=req("CANDIDATE_SHA"),baselineSha=req("BASELINE_SHA");
 const wrapper=JSON.parse(await readFile(aggregatePath,"utf8"));if(wrapper?.schemaVersion!=="origin.aq-local-sharded-comparison-result.v1"||wrapper?.ok!==true)throw new Error("AQ_FINAL_SUMMARY_AGGREGATE_INVALID");
 const comp=wrapper.comparison;if(comp?.candidateGitSha!==candidateSha||comp?.baselineGitSha!==baselineSha||comp?.shardCount!==count)throw new Error("AQ_FINAL_SUMMARY_IDENTITY_MISMATCH");
 const b=[],c=[];for(let i=0;i<count;i++){const w=JSON.parse(await readFile(path.join(dir,`aq-official-shard-${i}.json`),"utf8"));if(w?.ok!==true||w?.shard?.shardIndex!==i)throw new Error(`AQ_FINAL_SUMMARY_SHARD_INVALID:${i}`);b.push(...w.shard.baselineObservations);c.push(...w.shard.candidateObservations);}
 if(b.length!==40||c.length!==40)throw new Error("AQ_FINAL_SUMMARY_CASECOUNT_INVALID");
 const regress=[];let targeted=false;for(const f of FAMILIES){const d=delta(b.filter(x=>x.category===f),c.filter(x=>x.category===f));if(critical(d))regress.push(f);if(improved(d))targeted=true;}
 const hard=comp.hardGates||{},blockers=[];for(const [k,v] of Object.entries(hard))if(v!==true)blockers.push(`HARD_GATE:${k}`);if(regress.length)blockers.push("CRITICAL_FAMILY_REGRESSION");if(!targeted)blockers.push("NO_TARGETED_IMPROVEMENT");
 const result={schemaVersion:"origin.aq-live-final-promotion.v1",candidateSha,baselineSha,caseCount:40,familyCount:10,zeroCost:comp.baseline?.totalCostUsd===0&&comp.candidate?.totalCostUsd===0,shardCount:count,aggregateDigest:comp.aggregateDigest,promotionEligible:blockers.length===0,blockers,regressionFamilies:regress,targetedImprovementObserved:targeted,hardGates:hard};
 await writeFile(outputPath,JSON.stringify(result,null,2)+"\n",{mode:0o600});process.stdout.write(`AQ final promotionEligible=${result.promotionEligible}; blockers=${blockers.join(",")||"none"}\n`);
}
main().catch(e=>{process.stderr.write(`${e instanceof Error?e.message:"AQ_FINAL_SUMMARY_FAILED"}\n`);process.exitCode=1;});