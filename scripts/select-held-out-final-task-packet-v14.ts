import { finalPrivateTaskByIdV14, parseHeldOutFinalPrivateCorpusGzipBase64V14 } from '../src/agent/heldOutCodingFinalPrivateCorpusV14.js';

function main(): void {
  const encoded = process.env.ORIGIN_HELDOUT_FINAL_CORPUS_GZIP_B64 ?? '';
  const taskId = process.env.ORIGIN_HELDOUT_TASK_ID ?? '';
  if (!encoded || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(taskId)) throw new Error('HELD_OUT_FINAL_TASK_INPUT_INVALID');

  const prepared = parseHeldOutFinalPrivateCorpusGzipBase64V14(encoded);
  const packet = finalPrivateTaskByIdV14(prepared, taskId);
  delete process.env.ORIGIN_HELDOUT_FINAL_CORPUS_GZIP_B64;
  process.stdout.write(Buffer.from(JSON.stringify(packet), 'utf8').toString('base64'));
}

try {
  main();
} catch (error: unknown) {
  const code = error instanceof Error && /^[A-Z0-9_:-]+$/.test(error.message)
    ? error.message
    : 'HELD_OUT_FINAL_TASK_PREP_FATAL';
  console.error(JSON.stringify({ code }));
  process.exitCode = 1;
}
