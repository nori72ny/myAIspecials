import { parseHeldOutPrivateCorpusGzipB64V14 } from '../src/agent/heldOutCodingPrivateCorpusV14.js';
import type { HeldOutPrivateTaskPacketV14 } from '../src/agent/heldOutCodingTrustedRunnerV14.js';

function validId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(value);
}

function selectIds(): string[] {
  const filter = (process.env.ORIGIN_HELDOUT_TASK_FILTER ?? '').trim();
  if (filter && !validId(filter)) throw new Error('HELD_OUT_PRIVATE_TASK_ID_INVALID');
  const corpusEncoded = process.env.ORIGIN_HELDOUT_CORPUS_GZIP_B64 ?? '';
  const packetEncoded = process.env.ORIGIN_HELDOUT_TASK_PACKET_B64 ?? '';
  let ids: string[];
  if (corpusEncoded) {
    ids = parseHeldOutPrivateCorpusGzipB64V14(corpusEncoded).tasks.map(task => task.id);
  } else if (packetEncoded) {
    let packet: HeldOutPrivateTaskPacketV14;
    try { packet = JSON.parse(Buffer.from(packetEncoded, 'base64').toString('utf8')) as HeldOutPrivateTaskPacketV14; }
    catch { throw new Error('HELD_OUT_HOSTED_PACKET_INVALID'); }
    if (!validId(packet.id)) throw new Error('HELD_OUT_PRIVATE_TASK_ID_INVALID');
    ids = [packet.id];
  } else {
    throw new Error('HELD_OUT_HOSTED_INPUT_INVALID');
  }
  delete process.env.ORIGIN_HELDOUT_CORPUS_GZIP_B64;
  delete process.env.ORIGIN_HELDOUT_TASK_PACKET_B64;
  if (filter) {
    if (!ids.includes(filter)) throw new Error('HELD_OUT_PRIVATE_TASK_NOT_FOUND');
    return [filter];
  }
  return ids;
}

try {
  process.stdout.write(JSON.stringify(selectIds()));
} catch (error: unknown) {
  const code = error instanceof Error && /^[A-Z0-9_:-]+$/.test(error.message) ? error.message : 'HELD_OUT_BATCH_SELECTION_FATAL';
  console.error(JSON.stringify({ code }));
  process.exitCode = 1;
}
