import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('ORIGIN top experience regression boundary', () => {
  const root = resolve(process.cwd(), 'src');
  const app = readFileSync(resolve(root, 'App.tsx'), 'utf8');
  const main = readFileSync(resolve(root, 'main.tsx'), 'utf8');
  const topUi = readFileSync(resolve(root, 'origin-top-ui.css'), 'utf8');

  it('locks out destructive header behavior and uses the direct React settings action', () => {
    expect(app).not.toContain('window.location.href = "/"');
    expect(app).not.toContain('sessionStorage.clear()');
    expect(app).toContain('onClick={onOpenSettings}');
    expect(main).toContain('onOpenSettings={() => setIsSettingsOpen(true)}');
    expect(main).not.toContain("document.addEventListener('click', handleSettingsTrigger, true)");
    expect(main).not.toContain('event.stopPropagation()');
  });

  it('removes the legacy composer border treatment and preserves a borderless input surface', () => {
    expect(topUi).toContain('.origin-composer { border: 0 !important;');
    expect(topUi).toContain('.origin-composer textarea {');
    expect(topUi).toContain('border: 0 !important;');
  });

  it('locks the current input-first visual hierarchy instead of the superseded oversized mark', () => {
    expect(topUi).toContain('ORIGIN coherence pass — 2026-09-29');
    expect(topUi).toContain('min-height: 60px !important;');
    expect(topUi).toContain('width: 76px !important;');
    expect(topUi).toContain('width: 58px !important;');
    expect(topUi).toContain('min-height: 92px !important;');
    expect(topUi).toContain('font-size: 16px !important;');
  });
});
