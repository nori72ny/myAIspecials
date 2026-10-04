import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('ORIGIN top experience regression boundary', () => {
  const root = resolve(process.cwd(), 'src');
  const app = readFileSync(resolve(root, 'App.tsx'), 'utf8');
  const main = readFileSync(resolve(root, 'main.tsx'), 'utf8');
  const indexCss = readFileSync(resolve(root, 'index.css'), 'utf8');
  const auditCss = readFileSync(resolve(root, 'audit-2026-priority.css'), 'utf8');
  const functionalUi = readFileSync(resolve(root, 'origin-functional-ui.css'), 'utf8');
  const topUi = readFileSync(resolve(root, 'origin-top-ui.css'), 'utf8');
  const ultraOptics = readFileSync(resolve(root, 'ultra-optics.css'), 'utf8');
  const splashBrand = readFileSync(resolve(root, 'components/splash-brand.css'), 'utf8');

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

  it('keeps mobile add-menu geometry functional and its appearance visual', () => {
    expect(functionalUi).toContain('left: max(16px, calc((100vw - 360px) / 2)) !important;');
    expect(functionalUi).toContain('bottom: calc(env(safe-area-inset-bottom, 0px) + 82px) !important;');
    expect(functionalUi).toContain('max-height: min(46dvh, 320px) !important;');
    expect(functionalUi).toContain('min-height: 44px !important;');
    expect(functionalUi).not.toContain('background: rgba(15, 23, 42, 0.18);');
    expect(functionalUi).not.toContain('box-shadow: 0 24px 70px');
    expect(topUi).toContain('background: rgba(15, 23, 42, 0.08) !important;');
    expect(topUi).toContain('box-shadow: 0 8px 22px rgba(15, 23, 42, 0.11) !important;');
    expect(topUi).not.toContain('left: max(16px, calc((100vw - 360px) / 2)) !important;');
    expect(topUi).not.toContain('max-height: min(46dvh, 320px) !important;');
  });

  it('keeps mobile history containment functional and its appearance visual', () => {
    expect(functionalUi).toContain('[data-testid="history-drawer"]');
    expect(functionalUi).toContain('position: fixed !important;');
    expect(functionalUi).toContain('top: 70px !important;');
    expect(functionalUi).toContain('max-height: calc(100dvh - 92px) !important;');
    expect(functionalUi).toContain('overflow-y: auto !important;');
    expect(functionalUi).not.toContain('border-radius: 16px !important;');
    expect(topUi).toContain('[data-testid="history-drawer"]');
    expect(topUi).toContain('border-radius: 16px !important;');
    expect(topUi).not.toContain('top: 70px !important;');
    expect(topUi).not.toContain('max-height: calc(100dvh - 92px) !important;');
    expect(topUi).not.toContain('overflow-y: auto !important;');
  });

  it('keeps mobile chat containment in functional CSS instead of the visual primitive layer', () => {
    expect(functionalUi).toContain('.origin-chat [role="log"] { padding-inline: 12px; }');
    expect(functionalUi).toContain('width: calc(100% - 16px) !important;');
    expect(functionalUi).toContain('margin-bottom: max(4px, env(safe-area-inset-bottom));');
    expect(ultraOptics).not.toContain('.origin-chat [role="log"] { padding-inline: 12px; }');
    expect(ultraOptics).not.toContain('width: calc(100% - 16px) !important;');
    expect(ultraOptics).not.toContain('margin-bottom: max(4px, env(safe-area-inset-bottom));');
  });

  it('keeps global typography and focus-visible ownership in the canonical base layer', () => {
    expect(indexCss).toContain('font-size: 16px;');
    expect(indexCss).toContain(':focus-visible { outline: 2px solid var(--accent-primary); outline-offset: 2px; }');
    expect(ultraOptics).toContain('Release 2 typography/accessibility ownership');
    expect(ultraOptics).not.toContain('font-size: 14px;');
    expect(ultraOptics).not.toContain(':where(input, textarea, select):focus');
  });

  it('keeps dark theme state colors under the canonical token layer', () => {
    expect(auditCss).toContain('Release 2 compatibility shim');
    expect(auditCss).not.toContain('--accent-hover:');
    expect(auditCss).not.toContain('--accent-soft:');
    expect(auditCss).not.toContain('.origin-primary-button');
    expect(indexCss).toContain('--accent-primary: oklch(0.81 0.10 225);');
    expect(indexCss).toContain('--accent-hover: oklch(0.87 0.09 225);');
    expect(indexCss).toContain('--accent-border: oklch(0.42 0.06 235);');
  });

  it('locks the canonical Release 2 composer instead of the superseded flagship treatment', () => {
    expect(topUi).toContain('ORIGIN canonical shell — Release 2');
    expect(topUi).toContain('.origin-composer {');
    expect(topUi).toContain('min-height: 60px !important;');
    expect(topUi).toContain('min-height: 44px !important;');
    expect(topUi).toContain('background: color-mix(in oklch, var(--bg-surface) 97%, var(--bg-primary)) !important;');
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

  it('keeps the mobile composer compact while preserving a 44px touch target and keyboard-safe font size', () => {
    expect(topUi).toContain('@media (max-width: 639px)');
    expect(topUi).toContain('min-height: 58px !important;');
    expect(topUi).toContain('max-height: 144px !important;');
    expect(topUi).toContain('min-height: 44px !important;');
    expect(topUi).toContain('font-size: 16px !important;');
    expect(topUi).not.toContain('min-height: 92px !important;');
    expect(topUi).not.toContain('min-height: 78px !important;');
  });

  it('keeps Release 2 elevation quiet without weakening hierarchy or focus', () => {
    expect(topUi).toContain('box-shadow: 0 3px 12px color-mix(in oklch, var(--shadow-color) 24%, transparent)');
    expect(topUi).toContain('box-shadow: 0 5px 16px color-mix(in oklch, var(--shadow-color) 30%, transparent), 0 0 0 3px');
    expect(topUi).toContain('filter: blur(10px) !important;');
    expect(topUi).toContain('opacity: .72 !important;');
    expect(topUi).not.toContain('0 6px 18px color-mix(in oklch, var(--shadow-color) 36%, transparent)');
    expect(topUi).not.toContain('0 8px 24px color-mix(in oklch, var(--shadow-color) 42%, transparent)');
    expect(topUi).not.toContain('0 12px 34px color-mix(in oklch, var(--shadow-color) 54%, transparent)');
    expect(ultraOptics).toContain('filter: blur(24px);');
    expect(ultraOptics).not.toContain('0 4px 14px color-mix(in oklch, var(--shadow-color) 24%, transparent)');
    expect(splashBrand).toContain('filter: blur(14px);');
    expect(splashBrand).toContain('filter: drop-shadow(0 12px 24px rgb(218 74 93 / 13%));');
    expect(ultraOptics).not.toContain('backdrop-filter: blur(16px);');
    expect(ultraOptics).not.toContain('filter: blur(34px);');
    expect(ultraOptics).not.toContain('0 10px 28px color-mix(in oklch, var(--shadow-color) 36%, transparent)');
    expect(ultraOptics).not.toContain('backdrop-filter: blur(24px);');
  });

  it('keeps settings and history surfaces calm instead of inheriting oversized elevation', () => {
    expect(topUi).toContain('[data-testid="settings-modal"],');
    expect(topUi).toContain('[data-testid="history-drawer"] {');
    expect(topUi).toContain('background: color-mix(in oklch, var(--bg-surface) 98%, var(--bg-primary)) !important;');
    expect(topUi).toContain('box-shadow: 0 6px 18px color-mix(in oklch, var(--shadow-color) 24%, transparent) !important;');
    expect(topUi).not.toContain('box-shadow: 0 8px 24px color-mix(in oklch, var(--shadow-color) 30%, transparent) !important;');
    expect(topUi).not.toContain('box-shadow: 0 24px 70px');
  });

  it('locks the current input-first visual hierarchy instead of the superseded oversized mark', () => {
    expect(topUi).toContain('ORIGIN canonical shell — Release 2');
    expect(topUi).toContain('min-height: 60px !important;');
    expect(topUi).toContain('width: 76px !important;');
    expect(topUi).toContain('width: 64px !important;');
    expect(topUi).toContain('width: 54px !important;');
    expect(topUi).toContain("background: transparent url('/brand/origin-sunrise-mark.svg') center / contain no-repeat !important;");
    expect(topUi).toContain('min-height: 44px !important;');
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
