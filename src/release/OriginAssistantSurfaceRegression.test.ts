import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('ORIGIN assistant reading surface regression boundary', () => {
  const root = resolve(process.cwd(), 'src');
  const app = readFileSync(resolve(root, 'App.tsx'), 'utf8');
  const topUi = readFileSync(resolve(root, 'origin-top-ui.css'), 'utf8');

  it('keeps normal assistant answers as a continuous reading surface', () => {
    expect(app).toContain("'origin-chat-assistant w-full px-1 py-2 sm:px-2'");
    expect(app).toContain("'origin-chat-user max-w-[88%] rounded-2xl px-4 py-3 sm:max-w-[76%]'");
    expect(topUi).toContain('.origin-chat-assistant {');
    expect(topUi).toContain('background: transparent !important;');
    expect(topUi).toContain('border-color: transparent !important;');
    expect(topUi).toContain('box-shadow: none !important;');
  });
});
