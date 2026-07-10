import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SRC_DIR = path.join(__dirname, '../src');

// Exclude list of legacy / complex visualization layout files that are permitted to bypass strict locks
const EXCLUDED_FILES = [
  'src/App.tsx',
  'src/components/MissionInput.tsx',
  'src/components/ResultDashboard.tsx',
  'src/components/os/Boardroom.tsx',
  'src/components/os/RealTimeSwarmDebugger.tsx',
  'src/components/os/UniversalSearch.tsx',
  'src/components/os/BrainOverview.tsx',
  'src/components/os/DynamicBrain.tsx',
  'src/components/os/MissionRuntimeConsole.tsx',
  'src/components/os/OrganizationApp.tsx',
  'src/components/os/UniversalAgentFramework.tsx'
];

// Regex patterns to detect forbidden arbitrary values:
// 1. Padding arbitrary values: p-[...], pt-[...], etc.
// 2. Shadow arbitrary values: shadow-[...]
// 3. Color arbitrary values: bg-[#...], text-[#...], etc.
// 4. Animation arbitrary values: animate-[...]
const PATTERNS = [
  {
    name: 'Arbitrary Padding',
    regex: /\b(p|pt|pb|pl|pr|px|py)-\[[^\]]+\]/g,
    message: 'Arbitrary padding detected. Use design system padding tokens (e.g. p-4, py-2).'
  },
  {
    name: 'Arbitrary Shadow',
    regex: /\bshadow-\[[^\]]+\]/g,
    message: 'Arbitrary shadow detected. Use design system shadow tokens (e.g. shadow-sm, shadow-lg).'
  },
  {
    name: 'Arbitrary Color (Background / Text / Border)',
    regex: /\b(bg|text|border|accent|outline|from|to|via)-\[(#[0-9a-fA-F]{3,8}|rgba?\(.*\)|hsla?\(.*\)|[a-zA-Z]+)\]/g,
    message: 'Arbitrary color detected. Use design system theme variables or standard classes.'
  },
  {
    name: 'Arbitrary Animation',
    regex: /\banimate-\[[^\]]+\]/g,
    message: 'Arbitrary animation detected. Use design system standard animations.'
  },
  {
    name: 'Inline Style Arbitrary Padding',
    regex: /style\s*=\s*\{\{\s*[^}]*(padding|paddingTop|paddingBottom|paddingLeft|paddingRight|paddingInline|paddingBlock)\s*:\s*['"`][^'`"]+['"`]/gi,
    message: 'Inline arbitrary padding is forbidden. Use Tailwind classes.'
  },
  {
    name: 'Inline Style Arbitrary Color',
    regex: /style\s*=\s*\{\{\s*[^}]*(color|background|backgroundColor|borderColor)\s*:\s*['"`](#[0-9a-fA-F]{3,8}|rgba?\(.*\)|hsla?\(.*\))['"`]/gi,
    message: 'Inline arbitrary color hex/rgb is forbidden. Use Tailwind classes.'
  },
  {
    name: 'Inline Style Arbitrary Shadow',
    regex: /style\s*=\s*\{\{\s*[^}]*(boxShadow|textShadow)\s*:\s*['"`][^'`"]+['"`]/gi,
    message: 'Inline arbitrary shadow is forbidden. Use standard Tailwind classes.'
  },
  {
    name: 'Inline Style Arbitrary Animation',
    regex: /style\s*=\s*\{\{\s*[^}]*(animation|animationName|animationDuration)\s*:\s*['"`][^'`"]+['"`]/gi,
    message: 'Inline arbitrary animation is forbidden. Use standard Tailwind classes.'
  }
];

function checkFile(filePath) {
  const relPath = path.relative(path.join(__dirname, '..'), filePath).replace(/\\/g, '/');
  if (EXCLUDED_FILES.includes(relPath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  let errors = [];

  lines.forEach((line, index) => {
    if (line.includes('design-token-lock-ignore') || line.trim().startsWith('//') || line.trim().startsWith('/*')) {
      return;
    }

    PATTERNS.forEach(pattern => {
      pattern.regex.lastIndex = 0;
      let match;
      while ((match = pattern.regex.exec(line)) !== null) {
        errors.push({
          file: relPath,
          line: index + 1,
          pattern: pattern.name,
          match: match[0],
          message: pattern.message
        });
      }
    });
  });

  return errors;
}

function walkDir(dir, callback) {
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      if (file !== 'node_modules' && file !== 'dist' && file !== '.git') {
        walkDir(filePath, callback);
      }
    } else {
      const ext = path.extname(file);
      if (['.tsx', '.ts', '.css'].includes(ext)) {
        callback(filePath);
      }
    }
  });
}

console.log('=== Design Token Lock Verification ===');
console.log('Checking for forbidden arbitrary properties (padding, shadow, color, animation)...');

let totalErrors = [];
walkDir(SRC_DIR, (filePath) => {
  const errors = checkFile(filePath);
  if (errors.length > 0) {
    totalErrors = totalErrors.concat(errors);
  }
});

if (totalErrors.length > 0) {
  console.error('\n❌ DESIGN TOKEN LOCK VIOLATIONS DETECTED:');
  totalErrors.forEach(err => {
    console.error(`  ${err.file}:${err.line} - [${err.pattern}] "${err.match}"`);
    console.error(`    -> ${err.message}\n`);
  });
  console.error(`Total violations: ${totalErrors.length}`);
  console.error('Design Token Lock Validation: FAILED.');
  process.exit(1);
} else {
  console.log('\n✅ DESIGN TOKEN LOCK VALIDATION: PASSED!');
  console.log('No forbidden arbitrary padding, shadow, color, or animation values detected.');
  process.exit(0);
}
