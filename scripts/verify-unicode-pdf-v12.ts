import { mkdir, writeFile } from 'node:fs/promises';
import { generateArtifactV12Async } from '../src/artifacts/artifactGeneratorV12.js';

const outputDir = 'test-results/unicode-pdf';
await mkdir(outputDir, { recursive: true });

const title = '日本語PDF検証';
const content = [
  '営業資料：前年比を確認します。',
  '商品Aの売上は123万円です。',
  'Mixed Latin / 日本語 / 12345 / punctuation: () [] %.',
  '長文確認：' + '高品質な日本語PDFを正しく折り返して表示します。'.repeat(18),
  ...Array.from({ length: 72 }, (_, index) => `明細 ${String(index + 1).padStart(2, '0')}：表示欠損と改ページを確認`),
  '最終行：ここまで欠損なく表示されること。',
].join('\n');

const artifact = await generateArtifactV12Async({ type: 'pdf', title, content });
if (!artifact.verified) throw new Error('UNICODE_PDF_NOT_VERIFIED');
if (!artifact.verification.includes('embedded-unicode-font')) throw new Error('UNICODE_PDF_FONT_NOT_VERIFIED');
if (!artifact.verification.includes('unicode-width-aware-layout')) throw new Error('UNICODE_PDF_LAYOUT_NOT_VERIFIED');
if (artifact.bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('UNICODE_PDF_SIGNATURE_INVALID');

await writeFile(`${outputDir}/unicode-japanese-v12.pdf`, artifact.bytes);
await writeFile(`${outputDir}/expected.txt`, [title, '営業資料：前年比を確認します。', '最終行：ここまで欠損なく表示されること。'].join('\n'), 'utf8');
console.log(JSON.stringify({
  ok: true,
  sha256: artifact.sha256,
  byteLength: artifact.bytes.length,
  verification: artifact.verification,
}));
