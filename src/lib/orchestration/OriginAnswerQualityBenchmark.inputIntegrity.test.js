// @vitest-environment node
import {describe,it} from 'vitest';
import assert from 'node:assert/strict';
import {aggregateOriginAnswerQualityBenchmark as aggregate} from './OriginAnswerQualityBenchmark.js';
const good = {caseId:'one',category:'fail-closed',factualSupportScore:1,citationPrecisionScore:1,taskCompletionScore:1,contradictionDetectionScore:1,verifierRejectedUnsupportedClaim:false,providerRequests:0,latencyMs:0,costUsd:0,unsupportedMaterialClaimCount:0};
describe('AQ aggregate input integrity',()=>{
it('preserves distinct valid evidence',()=>{const r=aggregate([good,{...good,caseId:'two',repairSucceeded:false}]);assert.equal(r.ok,true);assert.equal(r.value.caseCount,2);assert.equal(r.value.repairSuccessRate,0)});
it('rejects duplicate case evidence including whitespace aliases',()=>{for(const id of ['one',' one '])assert.deepEqual(aggregate([good,{...good,caseId:id}]),{ok:false,code:'INVALID_BENCHMARK_OBSERVATION'})});
it('rejects nonboolean verification flags',()=>{for(const v of ['false',0,null])assert.equal(aggregate([{...good,verifierRejectedUnsupportedClaim:v}]).ok,false)});
it('rejects nonboolean repair flags',()=>{for(const v of ['true',1,null])assert.equal(aggregate([{...good,repairSucceeded:v}]).ok,false)});
});