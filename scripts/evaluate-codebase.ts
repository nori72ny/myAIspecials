import * as fs from 'fs';
import * as path from 'path';

// This script extracts all critical TypeScript and TSX files into a single artifact
// so it can be passed to third-party AI models (ChatGPT, Claude, Gemini, Manus)
// for strict, quantitative enterprise-level code reviews.

const directoriesToScan = ['src', 'services'];
const extensionsToInclude = ['.ts', '.tsx'];
const outputFile = 'THIRD_PARTY_EVALUATION_BUNDLE.md';

function scanDirectory(dir: string, fileList: string[] = []): string[] {
  if (!fs.existsSync(dir)) return fileList;
  
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      scanDirectory(fullPath, fileList);
    } else {
      if (extensionsToInclude.includes(path.extname(fullPath))) {
        fileList.push(fullPath);
      }
    }
  }
  return fileList;
}

function generateEvaluationBundle() {
  console.log(`[ACOS 2.0 Evaluation] Scanning for source files in ${directoriesToScan.join(', ')}...`);
  let allFiles: string[] = [];
  directoriesToScan.forEach(dir => {
    allFiles = scanDirectory(dir, allFiles);
  });

  console.log(`[ACOS 2.0 Evaluation] Found ${allFiles.length} files. Generating bundle...`);

  let bundleContent = `# ACOS 2.0 Third-Party Evaluation Bundle\n\n`;
  bundleContent += `Please review the following codebase against world-class enterprise standards.\n`;
  bundleContent += `Evaluate the following axes quantitatively (0-100):\n`;
  bundleContent += `- Code Architecture (SOLID principles)\n`;
  bundleContent += `- Performance & Scalability\n`;
  bundleContent += `- Security & Validation\n`;
  bundleContent += `- UX/UI (Design Tokens consistency)\n\n`;

  allFiles.forEach(file => {
    const content = fs.readFileSync(file, 'utf-8');
    bundleContent += `\n\n## File: ${file}\n\`\`\`typescript\n${content}\n\`\`\`\n`;
  });

  fs.writeFileSync(outputFile, bundleContent);
  console.log(`[ACOS 2.0 Evaluation] Bundle generated at ${outputFile}`);
  console.log(`[ACOS 2.0 Evaluation] You can now copy the contents of ${outputFile} to ChatGPT, Claude, Gemini, or Manus for review.`);
}

generateEvaluationBundle();
