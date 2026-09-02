import fs from 'fs';
import path from 'path';

const content = fs.readFileSync('server.ts', 'utf8');
const lines = content.split('\n');

// Extract parts
const schemaLines = lines.slice(28, 923);
const fetchOpenAILines = lines.slice(926, 976);
const legacyRoutesLines = lines.slice(977, 1549); // Contains /api/generate-image and /api/analyze

fs.mkdirSync('src/legacy', { recursive: true });

fs.writeFileSync('src/legacy/schema.ts', 
  'import { Type, Schema } from "@google/genai";\n\n' +
  'export const responseSchema: Schema = ' + schemaLines.join('\n') + '\n'
);

fs.writeFileSync('src/legacy/fetchOpenAI.ts', 
  fetchOpenAILines.join('\n') + '\n'
);

fs.writeFileSync('src/legacy/legacyRoutes.ts', 
  'import { Router } from "express";\n' +
  'import { GoogleGenAI } from "@google/genai";\n' +
  'import { responseSchema } from "./schema";\n' +
  'import { fetchOpenAI } from "./fetchOpenAI";\n\n' +
  'export const createLegacyRouter = () => {\n' +
  '  const router = Router();\n' +
  '  const ai = new GoogleGenAI({\n' +
  '    apiKey: process.env.GEMINI_API_KEY,\n' +
  '    httpOptions: { headers: { "User-Agent": "aistudio-build" } }\n' +
  '  });\n\n' +
  '  interface CacheEntry { timestamp: number; data: any; }\n' +
  '  const apiCache = new Map<string, CacheEntry>();\n' +
  '  const CACHE_TTL_MS = 10 * 60 * 1000;\n\n' +
  legacyRoutesLines.join('\n').replace(/app\.post/g, 'router.post') + '\n\n' +
  '  return router;\n' +
  '};\n'
);
