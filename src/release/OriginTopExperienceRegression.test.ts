import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('ORIGIN top experience regression boundary', () => {
  const root = resolve(process.cwd(), 'src');
  const app = readFileSync(resolve(root, 'App.tsx'), 'utf8');
  const main = readFileSync(resolve(root, 'main.tsx'), 'utf8');
  const functionalUi = readFileSync(resolve(root, 'origin-functional-ui.css'), 'utf8');
  const topUi = readFileSync(resolve(root, 'origin-top-ui.css'), 'utf8');
  const ultraOptics = readFileSync(resolve(root, 'ultra-optics.css'), 'utf8');

  it('locks out destructive header behavior and uses the direct React settings action', () => {
    expect(app).not.toContain('window.location.href = "/"');
    expect(app).not.toContain('sessionStorage.clear()');
    expect(app).toContain('onClick={onOpenSettings}');
    expect(main).toContain('onOpenSettings={() => setIsSettingsOpen(true)}');
    expect(main).not.toContain("document.addEventListener('click', handleSettingsTrigger, true)");
    expect(main).not.toContain('event.stopPropagation()');
  });

  it('separates preserved responsive interaction contracts from the canonical visual shell', () => {
    expect(topUi).toMatch(/^@import '\.\/origin-functional-ui\.css';/);
    expect(functionalUi).toContain('Functional responsive rules preserved from the pre-Release-2 shell');
    expect(functionalUi).toContain('.artifact-workspace__header');
    expect(functionalUi).toContain('.artifact-workspace__actions');
    expect(functionalUi).toContain('.origin-composer__action');
    expect(functionalUi).toContain('min-width: 44px;');
    expect(functionalUi).toContain('minmax(44px, 1fr)');
    expect(topUi).not.toContain('.artifact-workspace__header');
    expect(topUi).not.toContain('.artifact-workspace__actions > [role="group"]');
  });

  it('locks the canonical Release 2 composer instead of the superseded flagship treatment', () => {
    expect(topUi).toContain('ORIGIN canonical shell — Release 2');
    expect(topUi).toContain('.origin-composer {');
    expect(topUi).toContain('min-height: 92px !important;');
    expect(topUi).toContain('background: color-mix(in oklch, var(--bg-surface) 96%, var(--bg-primary)) !important;');
    expect(topUi).toContain('color: var(--text-primary) !important;');
    expect(topUi).toContain('.origin-composer__action.is-ready');
    expect(topUi).toContain('background: var(--accent-primary);');
    expect(topUi).toContain('color: var(--text-on-accent);');
    expect(topUi).toContain('font-size: 16px !important;');
    expect(topUi).not.toContain('background: rgba(24, 24, 27, 0.85)');
    expect(topUi).not.toContain('color: #f4f4f5');
    expect(topUi).not.toContain('border-radius: 28px !important;');
    expect(topUi).not.toContain('box-shadow: 0 18px 50px color-mix');
  });

  it('locks the current input-first visual hierarchy instead of the superseded oversized mark', () => {
    expect(topUi).toContain('ORIGIN canonical shell — Release 2');
    expect(topUi).toContain('min-height: 60px !important;');
    expect(topUi).toContain('width: 76px !important;');
    expect(topUi).toContain('width: 58px !important;');
    expect(topUi).toContain('min-height: 92px !important;');
    expect(topUi).toContain('font-size: 16px !important;');
    expect(topUi).not.toContain('ORIGIN Top Experience — 2026 flagship surface');
    expect(topUi).not.toContain('width: 104px !important;');
  });

  it('keeps retired glass shell tokens out of standalone Release 2 primitives', () => {
    expect(ultraOptics).not.toContain('.origin-ultra-panel,');
    expect(ultraOptics).not.toContain('.origin-glass-control {');
    expect(ultraOptics).not.toContain('.origin-chat > div:last-child > div > div {');
    expect(ultraOptics).not.toContain('var(--glass-border)');
    expect(ultraOptics).not.toContain('var(--accent-primary-v2)');
    expect(ultraOptics).toContain('border: 1px dashed var(--border-default);');
    expect(ultraOptics).toContain('background: linear-gradient(var(--accent-primary), transparent);');
    expect(ultraOptics).toContain('color: var(--accent-primary);');
  });
});
