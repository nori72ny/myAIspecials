import fs from 'fs';
import path from 'path';

function removeUnusedImports() {
  const tscOutput = fs.readFileSync('tsc_output.txt', 'utf-8');
  const lines = tscOutput.split('\n');

  const fileEdits = {};

  lines.forEach(line => {
    const match = line.match(/^(.+)\((\d+),\d+\): error TS6133: '([^']+)' is declared but its value is never read./);
    if (match) {
      const file = match[1];
      const lineNum = parseInt(match[2], 10);
      const name = match[3];

      if (!fileEdits[file]) fileEdits[file] = [];
      fileEdits[file].push({ lineNum, name });
    }
  });

  for (const [file, edits] of Object.entries(fileEdits)) {
    if (!fs.existsSync(file)) continue;
    let content = fs.readFileSync(file, 'utf-8');
    
    edits.forEach(({ name }) => {
      // Very naive removal of unused identifiers
      // 1. Unused Lucide icons:
      const lucideRegex = new RegExp(`\\b${name}\\b,?`, 'g');
      // If it's a lucide-react import
      if (content.includes('lucide-react')) {
         content = content.replace(lucideRegex, (match, offset, string) => {
             // Only replace if it's within an import block
             const before = string.substring(0, offset);
             if (before.includes('import ') && before.lastIndexOf('import ') > before.lastIndexOf('}')) {
                 return '';
             }
             return match;
         });
      }
      // 2. React unused import `import React, { ... }`
      if (name === 'React') {
         content = content.replace(/import\s+React\s*,\s*\{/, 'import {');
         content = content.replace(/import\s+React\s+from\s+['"]react['"];?\n?/, '');
      }
      
      // 3. Unused destructures (e.g. `const { cn } = ...`)
      if (name === 'cn') {
          content = content.replace(/import\s+\{\s*cn\s*\}\s+from\s+[^;]+;?\n?/, '');
      }
    });

    // Cleanup empty imports
    content = content.replace(/import\s+\{\s*\}\s+from\s+['"][^'"]+['"];?\n?/g, '');
    content = content.replace(/,\s*,/g, ',');
    content = content.replace(/\{\s*,/g, '{ ');
    content = content.replace(/,\s*\}/g, ' }');

    fs.writeFileSync(file, content);
  }
}

removeUnusedImports();
