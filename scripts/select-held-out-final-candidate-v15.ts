import {
  parseAndBindHeldOutFinalPrivateCorpusGzipBase64V15,
  publicHeldOutCandidateBindingV15,
} from '../src/release/OriginHeldOutCandidateBindingV15.js';

function main(): void {
  const encoded = process.env.ORIGIN_HELDOUT_FINAL_CORPUS_GZIP_B64 ?? '';
  const candidateSha = process.env.ORIGIN_CANDIDATE_SHA ?? '';
  if (!encoded) throw new Error('HELD_OUT_FINAL_SECRET_REQUIRED');

  const binding = parseAndBindHeldOutFinalPrivateCorpusGzipBase64V15(encoded, candidateSha);
  delete process.env.ORIGIN_HELDOUT_FINAL_CORPUS_GZIP_B64;

  process.stdout.write(JSON.stringify(publicHeldOutCandidateBindingV15(binding)));
}

try {
  main();
} catch (error: unknown) {
  const code = error instanceof Error && /^[A-Z0-9_:-]+$/.test(error.message)
    ? error.message
    : 'HELD_OUT_CANDIDATE_BINDING_FATAL';
  console.error(JSON.stringify({ code }));
  process.exitCode = 1;
}
