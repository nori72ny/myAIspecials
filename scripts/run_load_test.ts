import { organizationExecutorInstance } from "../services/mission-engine/src/application/organization/OrganizationExecutor";
import { MetricsCollector } from "../services/mission-engine/src/infrastructure/observability/MetricsCollector";
import * as fs from "fs";

// Helper for timing
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Simple statistics calculation
function calculateStats(latencies: number[]) {
  if (latencies.length === 0) return { mean: 0, max: 0, p95: 0, p99: 0 };
  const sorted = [...latencies].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const mean = sum / sorted.length;
  const max = sorted[sorted.length - 1];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  return { mean, max, p95, p99 };
}

async function runBatch(count: number, concurrency: number) {
  const latencies: number[] = [];
  let successes = 0;
  let failures = 0;

  const startCPU = process.cpuUsage();
  const startTime = Date.now();
  const startMemory = process.memoryUsage().heapUsed;

  const queue = Array.from({ length: count }, (_, i) => `mission-load-${Date.now()}-${i}`);
  let activeCount = 0;
  let index = 0;

  const promises: Promise<void>[] = [];

  const executeNext = async (): Promise<void> => {
    if (index >= queue.length) return;
    const missionId = queue[index++];
    activeCount++;

    const mStart = Date.now();
    try {
      // Execute mission via OrganizationExecutor
      const objective = `Plan an optimized micro-route for agent delegation matching ID: ${missionId}`;
      const state = await organizationExecutorInstance.executeMission(missionId, objective);
      
      if (state && state.currentState === "COMPLETED") {
        successes++;
      } else {
        failures++;
      }
    } catch (err) {
      failures++;
    } finally {
      latencies.push(Date.now() - mStart);
      activeCount--;
      if (index < queue.length) {
        await executeNext();
      }
    }
  };

  // Launch initial concurrency workers
  const workers: Promise<void>[] = [];
  const limit = Math.min(concurrency, count);
  for (let i = 0; i < limit; i++) {
    workers.push(executeNext());
  }
  await Promise.all(workers);

  const durationMs = Date.now() - startTime;
  const endCPU = process.cpuUsage(startCPU);
  const endMemory = process.memoryUsage().heapUsed;

  const cpuTimeUs = endCPU.user + endCPU.system;
  const cpuPercent = (cpuTimeUs / (durationMs * 1000)) * 100; // Normalized for active execution time on this thread

  const throughput = (successes + failures) / (durationMs / 1000);

  return {
    successes,
    failures,
    latencies,
    durationMs,
    throughput,
    cpuPercent,
    memoryDeltaBytes: endMemory - startMemory,
    peakMemoryBytes: process.memoryUsage().heapUsed,
  };
}

async function main() {
  console.log("==================================================");
  console.log("   ACOS 2.0 Live Production Hardening Benchmark   ");
  console.log("==================================================");
  console.log(`Current Time: ${new Date().toISOString()}`);
  console.log("Starting executions in fallback/mock mode (resilient engine verification)...\n");

  const mc = MetricsCollector.getInstance();
  mc.clear();

  // 1. Core Concurrency / Load Scaling Test (To find Bottleneck & Max Sustained Concurrency)
  console.log("--- 1. Concurrency Scaling Test (Sustained Load Capacity) ---");
  const scalingScenarios = [
    { name: "Low Concurrency", count: 10, concurrency: 1 },
    { name: "Medium Concurrency", count: 50, concurrency: 10 },
    { name: "High Concurrency", count: 100, concurrency: 50 },
    { name: "Extreme Stress Concurrency", count: 200, concurrency: 100 }
  ];

  const scalingResults = [];
  let maxSustainedConcurrency = 0;

  for (const s of scalingScenarios) {
    console.log(`Running ${s.name}: ${s.count} missions with max concurrency of ${s.concurrency}...`);
    const res = await runBatch(s.count, s.concurrency);
    const stats = calculateStats(res.latencies);
    console.log(`  -> Duration: ${(res.durationMs / 1000).toFixed(2)}s | Successes: ${res.successes}/${s.count}`);
    console.log(`  -> Throughput: ${res.throughput.toFixed(2)} missions/sec`);
    console.log(`  -> Latency: Avg ${stats.mean.toFixed(1)}ms | P95 ${stats.p95.toFixed(1)}ms | P99 ${stats.p99.toFixed(1)}ms | Max ${stats.max.toFixed(1)}ms`);
    console.log(`  -> CPU Utilization: ${res.cpuPercent.toFixed(1)}% | Peak Heap: ${(res.peakMemoryBytes / 1024 / 1024).toFixed(2)} MB\n`);
    
    scalingResults.push({ scenario: s.name, count: s.count, concurrency: s.concurrency, ...res, stats });

    if (res.failures === 0) {
      maxSustainedConcurrency = Math.max(maxSustainedConcurrency, s.concurrency);
    }
  }

  // 2. 100-Mission Core Load Validation
  console.log("--- 2. 100-Mission Validation Run ---");
  const res100 = await runBatch(100, 20);
  const stats100 = calculateStats(res100.latencies);
  console.log(`Completed 100 missions in ${(res100.durationMs / 1000).toFixed(2)}s`);
  console.log(`Throughput: ${res100.throughput.toFixed(2)} missions/sec`);
  console.log(`Latency: Avg ${stats100.mean.toFixed(1)}ms | P95 ${stats100.p95.toFixed(1)}ms | P99 ${stats100.p99.toFixed(1)}ms\n`);

  // 3. 1000-Mission Scale/Load Verification & Memory Leak Test
  console.log("--- 3. 1000-Mission Scale Run & Memory Leak Verification ---");
  const memBefore1000 = process.memoryUsage().heapUsed;
  
  // Clean up GC if exposed (it's not by default, but we'll monitor anyway)
  if (global.gc) global.gc();

  const start1000 = Date.now();
  console.log("Running 1000 missions in batches of 50 concurrency to verify long-term stability...");
  const res1000 = await runBatch(1000, 50);
  const stats1000 = calculateStats(res1000.latencies);
  
  const memAfter1000 = process.memoryUsage().heapUsed;
  const leakDiff = memAfter1000 - memBefore1000;
  
  console.log(`Completed 1000 missions in ${(res1000.durationMs / 1000).toFixed(2)}s`);
  console.log(`Throughput: ${res1000.throughput.toFixed(2)} missions/sec`);
  console.log(`Memory before: ${(memBefore1000 / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Memory after: ${(memAfter1000 / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Memory growth: ${(leakDiff / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Latency: Avg ${stats1000.mean.toFixed(1)}ms | P95 ${stats1000.p95.toFixed(1)}ms | P99 ${stats1000.p99.toFixed(1)}ms\n`);

  // 4. Token Usage Metric
  const summary = mc.getMetricsSummary();
  const totalTokens = summary.llm.totalTokens;
  console.log(`--- Observability and Token Metrics ---`);
  console.log(`Total Mock LLM Calls: ${summary.llm.totalCalls}`);
  console.log(`Total Simulated Tokens Processed: ${totalTokens}`);
  console.log(`Average Token Consumption per Mission: ${(totalTokens / (summary.missions.total || 1)).toFixed(1)} tokens\n`);

  // Compile final report data
  const finalReport = {
    testTime: new Date().toISOString(),
    concurrencyScaling: scalingResults,
    validation100: {
      successRate: (res100.successes / 100) * 100,
      errorRate: (res100.failures / 100) * 100,
      throughput: res100.throughput,
      stats: stats100,
      cpuPercent: res100.cpuPercent,
      memoryDeltaMB: res100.memoryDeltaBytes / 1024 / 1024
    },
    scale1000: {
      successRate: (res1000.successes / 1000) * 100,
      errorRate: (res1000.failures / 1000) * 100,
      throughput: res1000.throughput,
      stats: stats1000,
      cpuPercent: res1000.cpuPercent,
      memoryBeforeMB: memBefore1000 / 1024 / 1024,
      memoryAfterMB: memAfter1000 / 1024 / 1024,
      memoryDeltaMB: leakDiff / 1024 / 1024
    },
    maxSustainedConcurrency,
    totalTokensProcessed: totalTokens,
    metricsSummary: summary
  };

  fs.writeFileSync("results/production_hardening_report.json", JSON.stringify(finalReport, null, 2));
  console.log("Hardening benchmark completed successfully! Report generated in 'results/production_hardening_report.json'.");
}

main().catch(err => {
  console.error("Benchmark failed with error:", err);
  process.exit(1);
});
