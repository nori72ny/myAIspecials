import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('ORIGIN top experience regression boundary', () => {
  const root = resolve(process.cwd(), 'src');
  const app = readFileSync(resolve(root, 'App.tsx'), 'utf8');
  const main = readFileSync(resolve(root, 'main.tsx'), 'utf8');
  const topUi = readFileSync(resolve(root, 'origin-top-ui.css'), 'utf8');

  it('locks out the legacy destructive ancestor handler and keeps the settings trigger guarded', () => {
    expect(app).not.toContain('window.location.href = "/"');
    expect(app).not.toContain('sessionStorage.clear()');
    expect(main).toContain("document.addEventListener('click', handleSettingsTrigger, true)");
    expect(main).toContain('event.stopPropagation()');
    expect(main).toContain('setIsSettingsOpen(true)');
  });

  it('removes the legacy composer border treatment and preserves a borderless input surface', () => {
    expect(topUi).toContain('.origin-composer { border: 0 !important;');
    expect(topUi).toContain('.origin-composer textarea {');
    expect(topUi).toContain('border: 0 !important;');
  });

  it('defines a larger flagship ORIGIN mark and responsive typography', () => {
    expect(topUi).toContain('[data-testid="origin-core-logo"]');
    expect(topUi).toContain('width: 104px !important;');
    expect(topUi).toContain('font-size: clamp(2rem, 4.2vw, 3.15rem) !important;');
  });
});
