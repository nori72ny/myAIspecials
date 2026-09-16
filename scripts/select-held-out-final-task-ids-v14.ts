import { parseHeldOutFinalPrivateCorpusGzipBase64V14 } from '../src/agent/heldOutCodingFinalPrivateCorpusV14.js';

function main(): void {
  const encoded = process.env.ORIGIN_HELDOUT_FINAL_CORPUS_GZIP_B64 ?? '';
  if (!encoded) throw new Error('HELD_OUT_FINAL_SECRET_REQUIRED');
  const prepared = parseHeldOutFinalPrivateCorpusGzipBase64V14(encoded);
  delete process.env.ORIGIN_HELDOUT_FINAL_CORPUS_GZIP_B64;

  const taskIds = prepared.publicCorpus.tasks.map(task => task.id);
  process.stdout.write(JSON.stringify({
    taskIds,
    corpusId: prepared.publicCorpus.corpusId,
    corpusDigest: prepared.publicCorpus.corpusDigest,
    frozenBaseSha: prepared.publicCorpus.frozenBaseSha,
    taskCount: taskIds.length,
  }));
}

try {
  main();
} catch (error: unknown) {
  const code = error instanceof Error && /^[A-Z0-9_:-]+$/.test(error.message)
    ? error.message
    : 'HELD_OUT_FINAL_SELECTION_FATAL';
  console.error(JSON.stringify({ code }));
  process.exitCode = 1;
}
