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
  const personalEditionApp = readFileSync(resolve(root, 'components/personal/PersonalEditionApp.tsx'), 'utf8');

  it('locks out destructive header behavior and uses the direct React settings action', () => {
    expect(app).not.toContain('window.location.href = "/"');
    expect(app).not.toContain('sessionStorage.clear()');
    // PR-D: the header settings button was consolidated into the sidebar.
    // The settings action still reaches the shell as a direct React prop
    // (OriginSidebar onOpenSettings), never a DOM click listener.
    expect(app).not.toContain('onClick={onOpenSettings}');
    expect(personalEditionApp).toContain('onOpenSettings={onOpenSettings ? handleSidebarOpenSettings : undefined}');
    expect(main).toContain('onOpenSettings={(section) => { setSettingsFocusSection(section ?? null); setIsSettingsOpen(true); }}');
    expect(main).not.toContain("document.addEventListener('click', handleSettingsTrigger, true)");
    expect(main).not.toContain('event.stopPropagation()');
  });

  it('separates preserved responsive interaction contracts from the canonical visual shell', () => {
    expect(topUi).toMatch(/^@import '\.\/origin-functional-ui\.css';/);
    expect(functionalUi).toContain('Functional responsive rules preserved from the pre-Release-2 shell');
    expect(functionalUi).toContain('.artifact-workspace__header');
    expect(functionalUi).toContain('.artifact-workspace__actions');
    // K-19 (2026-11-24): the composer action-class geometry contract had
    // no rendered element and was removed as dead CSS.
    expect(functionalUi).not.toContain('.origin-composer__action');
    expect(functionalUi).toContain('min-height: 44px !important;');
    expect(functionalUi).toContain('minmax(44px, 1fr)');
    expect(topUi).not.toContain('.artifact-workspace__header');
    expect(topUi).not.toContain('.artifact-workspace__actions > [role="group"]');
  });

  it('keeps mobile add-menu geometry functional and its appearance visual', () => {
    expect(functionalUi).toContain('left: 0 !important;');
    expect(functionalUi).toContain('bottom: calc(100% + 8px) !important;');
    expect(functionalUi).toContain('max-height: min(46dvh, 400px) !important;');
    expect(functionalUi).toContain('min-height: 44px !important;');
    expect(functionalUi).not.toContain('bottom: calc(env(safe-area-inset-bottom, 0px) + 82px) !important;');
    expect(functionalUi).not.toContain('background: rgba(15, 23, 42, 0.18);');
    expect(functionalUi).not.toContain('box-shadow: 0 24px 70px');
    expect(topUi).toContain('background: var(--scrim);');
    // K-20 (2026-11-24): the add-menu panel takes the panel radius (16px)
    // and the popover shadow token at every width.
    const addMenuPanelRule = topUi.match(/\.origin-add-menu__panel \{[^}]*\}/)?.[0] ?? '';
    expect(addMenuPanelRule).toContain('border-radius: 16px;');
    expect(addMenuPanelRule).toContain('box-shadow: var(--shadow-2);');
    expect(topUi).toContain('box-shadow: var(--shadow-2) !important;');
    expect(topUi).not.toContain('left: 0 !important;');
    expect(topUi).not.toContain('max-height: min(46dvh, 400px) !important;');
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
    expect(indexCss).toContain('--accent-primary: oklch(0.375 0.075 260);');
    expect(indexCss).toContain('--accent-hover: oklch(0.325 0.075 260);');
    expect(indexCss).toContain('--accent-border: oklch(0.85 0.02 260);');
  });

  it('locks the canonical Release 2 composer instead of the superseded flagship treatment', () => {
    expect(topUi).toContain('ORIGIN canonical shell — Release 2');
    expect(topUi).toContain('.origin-composer {');
    expect(topUi).toContain('min-height: 64px !important;');
    expect(topUi).toContain('min-height: 44px !important;');
    expect(topUi).toContain('max-height: 176px !important;');
    expect(topUi).not.toContain('min-height: 96px !important;');
    expect(topUi).toContain('background: var(--bg-surface) !important;');
    expect(topUi).toContain('color: var(--text-primary) !important;');
    // K-19 (2026-11-24): the composer action-class color rules had no
    // rendered element and were removed as dead CSS.
    expect(topUi).not.toContain('.origin-composer__action');
    expect(topUi).toContain('font-size: 16px !important;');
    expect(functionalUi).toContain('order: -1;');
    expect(functionalUi).not.toContain('grid-template-rows: auto 44px;');
    expect(functionalUi).not.toContain('grid-column: 1 / -1;');
    expect(functionalUi).not.toContain('grid-column: 2;');
    expect(topUi).not.toContain('background: rgba(24, 24, 27, 0.85)');
    expect(topUi).not.toContain('color: #f4f4f5');
    expect(topUi).not.toContain('border-radius: 28px !important;');
    expect(topUi).not.toContain('box-shadow: 0 18px 50px color-mix');
  });

  it('keeps the mobile composer compact and single-row while preserving 44px touch targets and keyboard-safe type', () => {
    expect(topUi).toContain('@media (max-width: 639px)');
    expect(topUi).toContain('min-height: 60px !important;');
    expect(topUi).toContain('min-height: 44px !important;');
    expect(topUi).toContain('max-height: min(158px, 30dvh) !important;');
    expect(topUi).toContain('font-size: 16px !important;');
    expect(topUi).not.toContain('min-height: 116px !important;');
    expect(topUi).not.toContain('max-height: min(176px, 28dvh) !important;');
    expect(functionalUi).toContain('display: flex !important;');
    expect(functionalUi).toContain('flex-direction: row !important;');
    expect(functionalUi).toContain('align-items: flex-end !important;');
    expect(functionalUi).not.toContain('grid-template-columns: minmax(0, 1fr) 44px;');
    expect(functionalUi).not.toContain('grid-template-rows: auto 44px;');
    // K-19 (2026-11-24): the 44px width/height pair belonged to the
    // removed dead action-class rule; live touch targets stay pinned by
    // the min-height rules here and in the canonical shell above.
    expect(functionalUi).toContain('min-height: 44px !important;');
    expect(topUi).not.toContain('max-height: 144px !important;');
    expect(functionalUi).not.toContain('bottom: max(10px, env(safe-area-inset-bottom));');
  });

  it('keeps Release 2 elevation quiet without weakening hierarchy or focus', () => {
    // D-PR-3: the composer elevation moved to the --shadow-1 token and
    // its focus ring is a faint 2px accent ring (no inset highlight, no
    // backdrop blur, no heavier mobile overrides).
    expect(topUi).toContain('box-shadow: var(--shadow-1) !important;');
    expect(topUi).toContain('box-shadow: var(--shadow-1), 0 0 0 2px color-mix(in oklch, var(--accent-primary) 14%, transparent) !important;');
    expect(topUi).not.toContain('0 0 0 1px color-mix(in oklch, var(--accent-primary)');
    expect(topUi).not.toContain('0 0 0 3px color-mix(in oklch, var(--accent-primary)');
    expect(topUi).not.toContain('0 3px 12px color-mix(in oklch, var(--shadow-color) 24%, transparent)');
    expect(topUi).not.toContain('inset 0 1px 0 color-mix(in oklch, white 46%, transparent)');
    expect(topUi).toContain('filter: blur(10px) !important;');
    expect(topUi).toContain('opacity: .72 !important;');
    expect(topUi).not.toContain('0 6px 18px color-mix(in oklch, var(--shadow-color) 36%, transparent)');
    expect(topUi).not.toContain('0 8px 24px color-mix(in oklch, var(--shadow-color) 42%, transparent)');
    expect(topUi).not.toContain('0 12px 34px color-mix(in oklch, var(--shadow-color) 54%, transparent)');
    expect(ultraOptics).toContain('filter: blur(24px);');
    expect(ultraOptics).not.toContain('0 4px 14px color-mix(in oklch, var(--shadow-color) 24%, transparent)');
    expect(splashBrand).toContain('filter: blur(14px);');
    expect(splashBrand).toContain('filter: drop-shadow(0 12px 24px rgb(9 34 76 / 22%));');
    expect(ultraOptics).not.toContain('backdrop-filter: blur(16px);');
    expect(ultraOptics).not.toContain('filter: blur(34px);');
    expect(ultraOptics).not.toContain('0 10px 28px color-mix(in oklch, var(--shadow-color) 36%, transparent)');
    expect(ultraOptics).not.toContain('backdrop-filter: blur(24px);');
  });

  it('keeps settings and history surfaces calm instead of inheriting oversized elevation', () => {
    expect(topUi).toContain('[data-testid="settings-modal"],');
    expect(topUi).toContain('[data-testid="history-drawer"] {');
    expect(topUi).toContain('background: color-mix(in oklch, var(--bg-surface) 98%, var(--bg-primary)) !important;');
    // K-11 (2026-11-24): the modal / drawer elevation is the --shadow-3
    // token (the token canon reserves it for modals and drawers), not a
    // per-surface custom mix.
    expect(topUi).toContain('box-shadow: var(--shadow-3) !important;');
    expect(topUi).not.toContain('0 6px 18px color-mix(in oklch, var(--shadow-color) 24%, transparent)');
    expect(topUi).not.toContain('box-shadow: 0 8px 24px color-mix(in oklch, var(--shadow-color) 30%, transparent) !important;');
    expect(topUi).not.toContain('box-shadow: 0 24px 70px');
  });

  it('locks the current input-first visual hierarchy instead of the superseded oversized mark', () => {
    expect(topUi).toContain('ORIGIN canonical shell — Release 2');
    // コンポーザー新契約（自動伸縮）：入力欄のフロア44pxとモバイル上限。
    expect(topUi).toContain('min-height: 44px !important;');
    expect(topUi).toContain('max-height: min(158px, 30dvh) !important;');
    // ヒーローの明るい台座（#1170）は現行の表示経路では描画されず
    // （プレゼンス行が正本）、台座の CSS は K-19（2026-11-24）で死に
    // CSS として削除した（旧リボンOマークの固定サイズも廃止済み）。
    expect(topUi).not.toContain('.origin-cat-pedestal');
    expect(topUi).not.toContain('origin-ribbon-o-light.webp');
    expect(topUi).not.toContain('origin-ribbon-o-small.webp');
    expect(topUi).toContain('min-height: 60px !important;');
    expect(topUi).toContain('min-height: 56px !important;');
    // 単一行フレックス化で旧2段グリッドの全幅スパン（grid-column: 1 / -1）は廃止。
    expect(functionalUi).not.toContain('grid-column: 1 / -1;');
    expect(functionalUi).toContain('margin-top: 12px !important;');
    expect(topUi).toContain('font-size: 16px !important;');
    expect(topUi).not.toContain('ORIGIN Top Experience — 2026 flagship surface');
    expect(topUi).not.toContain('width: 104px !important;');
  });

  it('gives the composer stop-generation button the primary slot while generating (PR-B)', () => {
    // While a response is generating, the composer's primary (filled)
    // button at the right end is the stop button: a Lucide Square
    // glyph under testid stop-generation-button, still wired to the
    // same abort handler. The queue-send button keeps its testid,
    // label and handler but is demoted to the secondary treatment on
    // the stop button's left. Before PR-B the hierarchy was inverted:
    // queue-send was primary and stop was a subdued origin-stop-button
    // carrying a text glyph, restyled neutral by PR-α2 so it never
    // reads as a destructive action.
    expect(app).toContain('data-testid="stop-generation-button" aria-label={t.stopGeneration} title={t.stopGeneration} onClick={() => abortRef.current?.abort()} className="origin-primary-button inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full p-0"');
    expect(app).toContain('<Square aria-hidden="true" fill="currentColor" size={18} />');
    expect(app).toContain('data-testid="queue-send-button" aria-label={t.queueSend} title={t.queueSend} onClick={() => void handleSend()}');
    expect(app).toContain('className="origin-secondary-button inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full p-0 disabled:cursor-not-allowed"');
    expect(app).not.toContain('origin-stop-button');
    expect(app).not.toContain('origin-danger-button');
    expect(indexCss).not.toContain('.origin-stop-button');
    // The danger class stays separate from the stop button. D-PR-3
    // redefined it as a white surface with danger text and a 40% danger
    // border (spec §4.5: state colors are never a filled surface), for
    // genuinely destructive actions such as clearing history in the
    // legacy settings UI.
    expect(indexCss).toContain('.origin-danger-button { background: var(--bg-surface); border-color: color-mix(in oklch, var(--danger) 40%, var(--border-default)); color: var(--danger); }');
  });

  it('canonises the secondary-button frame in the class itself (K-02, 2026-11-24)', () => {
    // K-02 (correction list; design fine audit D-01/D-10/D-11): the
    // frame belongs to the canon class, never to a per-site `border`
    // utility. Before this the class named only a border colour, so
    // the frame showed at barely half the call sites and the same
    // button changed its look by screen and by theme (the home
    // starter chips rendered as bare bold text on the light theme).
    expect(indexCss).toContain('.origin-secondary-button { background: var(--bg-surface); border: 1px solid var(--border-strong); color: var(--text-primary); }');
    expect(indexCss).not.toContain('.origin-secondary-button { background: var(--bg-surface); border-color: var(--border-strong); color: var(--text-primary); }');
    // The badge takes the same canonisation (frame in the class).
    expect(indexCss).toContain('.origin-badge { background: var(--accent-soft); border: 1px solid var(--accent-border); border-radius: var(--radius-control); color: var(--accent-strong); }');
    // Call-site inventory: pure secondary buttons no longer carry the
    // compensating `border` utility, and outside the documented
    // settings-row exception they no longer carry rounded-xl either
    // (radius canon: control 8px by default, or the pill). The
    // settings selection-row bases are shared with the primary state
    // and stay with the settings surface (correction list K-11).
    const personalization = readFileSync(resolve(root, 'components/PersonalizationSettings.tsx'), 'utf8');
    expect(personalization).not.toContain('origin-secondary-button min-h-11 rounded-xl border');
    expect(personalization).toContain('origin-secondary-button min-h-11 px-3 text-sm font-semibold');
    const taskBoard = readFileSync(resolve(root, 'components/AgentTaskBoard.tsx'), 'utf8');
    expect(taskBoard).not.toContain('origin-secondary-button min-h-11 rounded-xl');
    // The queue-send button (D-11) keeps its pill shape and takes the
    // frame from the canon class like every other call site.
    expect(app).toContain('data-testid="queue-send-button"');
  });

  it('guarantees the conversation log end clearance so answer pills stay visible (K-16)', () => {
    // K-16（2026-11-24）：完了後に操作行（コピー＋調整ピル）が
    // 出現して本文が伸び、最終スクロール位置が古い高さに止まる
    // とピルが入力欄の裏に半分隠れた（欠陥#5 の残件）。会話ログ
    // の末尾余白を、入力欄の高さ＋操作行分として決定的に確保
    // する。骨格ルールの padding-block（最大24px）では吸収
    // できないため、末尾だけを同詳細度・後段で上書きする。
    expect(topUi).toContain('padding-bottom: 168px !important;');
    expect(topUi).toContain('padding-bottom: 224px !important;');
    expect(topUi).toContain('scroll-padding-bottom: 168px;');
    expect(topUi).toContain('scroll-padding-bottom: 224px;');
    // 上書きの対象は会話ログだけで、ホームの末尾固定には触らない。
    const k16Block = topUi.slice(topUi.indexOf('K-16 (2026-11-24): deterministic end clearance'));
    expect(k16Block).toContain('.origin-conversation-log');
    expect(k16Block.slice(0, k16Block.indexOf('}\n'))).not.toContain('.origin-home-layout');
  });

  it('keeps retired glass shell tokens out of standalone Release 2 primitives', () => {
    expect(ultraOptics).not.toContain('.origin-ultra-panel,');
    expect(ultraOptics).not.toContain('.origin-glass-control {');
    expect(ultraOptics).not.toContain('.origin-chat > div:last-child > div > div {');
    expect(ultraOptics).not.toContain('var(--glass-border)');
    expect(ultraOptics).not.toContain('var(--accent-primary-v2)');
    // K-19 (2026-11-24): the standalone primitives (skeleton, zero-state,
    // dag) had no rendered element and were removed as dead CSS.
    expect(ultraOptics).not.toContain('.origin-skeleton');
    expect(ultraOptics).not.toContain('.origin-zero-state');
    expect(ultraOptics).not.toContain('.origin-dag');
  });

  it('keeps secondary text at the 13px floor in the add menu and the Orin name tag (K-18)', () => {
    const descriptionRule = topUi.match(/\.origin-add-menu__description \{[^}]*\}/)?.[0] ?? '';
    expect(descriptionRule).toContain('font-size: 13px;');
    const nameRule = topUi.match(/\.origin-orin-presence__name \{[^}]*\}/)?.[0] ?? '';
    expect(nameRule).toContain('font-size: 13px;');
    expect(nameRule).toContain('padding: 3px 10px;');
  });

  it('caps the desktop home intro placement so the heading band does not stretch (K-22)', () => {
    // K-22（2026-11-24）：デスクトップでは intro が flex ゾーンの
    // 中央寄せだったため、プレゼンスと見出しの間の空白帯が画面の
    // 高さに比例して伸びた（実測 1080px 高で約333px）。デスクトップ
    // だけ上寄せ＋上限付き上余白に変え、空白帯を固定範囲に収める。
    // モバイルの中央寄せ契約（max-width: 639px 群）には触らない。
    const k22Block = topUi.slice(topUi.indexOf('Desktop home intro placement (K-22'));
    expect(k22Block).toContain('@media (min-width: 640px)');
    expect(k22Block).toContain('.origin-app main .origin-home-intro');
    expect(k22Block).toContain('justify-content: flex-start !important;');
    expect(k22Block).toContain('padding-top: clamp(32px, 7vh, 96px) !important;');
  });

  it('keeps the assistant reading surface under a single transparent canon (K-19)', () => {
    const indexCss = readFileSync(resolve(root, 'index.css'), 'utf8');
    expect(indexCss).not.toContain('.origin-chat-assistant {');
    const assistantRule = topUi.match(/\.origin-chat-assistant \{[^}]*\}/)?.[0] ?? '';
    expect(assistantRule).toContain('max-width: 45rem;');
    expect(assistantRule).toContain('margin-inline: auto;');
    expect(assistantRule).toContain('background: transparent !important;');
    expect(assistantRule).toContain('box-shadow: none !important;');
  });
});
