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
    // redefined it as a white surface with danger text and a danger
    // border (spec §4.5: state colors are never a filled surface), for
    // genuinely destructive actions such as clearing history in the
    // legacy settings UI. The frame's mix changed on 2026-11-25
    // (external evaluation fix): mixing toward --border-default
    // rotated the hue to ~309 (a brand-foreign mauve, measured);
    // mixing toward transparent keeps the red hue at 55%.
    expect(indexCss).toContain('.origin-danger-button { background: var(--bg-surface); border-color: color-mix(in oklch, var(--danger) 55%, transparent); color: var(--danger); }');
    expect(indexCss).not.toContain('color-mix(in oklch, var(--danger) 40%, var(--border-default))');
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

  it('keeps the mic button hover on the surface token instead of raw black/white (K-28)', () => {
    // D-15：マイクボタンの hover が black/5・white/10 の直書きで、
    // テーマ展開時に取り残される。面トークンへ寄せる。
    expect(app).toContain('hover:bg-[var(--bg-surface-muted)]');
    const micStart = app.indexOf('data-testid="voice-input-button"');
    const micButton = app.slice(micStart, micStart + 1200);
    expect(micButton).not.toContain('hover:bg-black/5');
    expect(micButton).not.toContain('dark:hover:bg-white/10');
  });

  it('uses Lucide icons in the send-queue chips instead of an emoji and a glyph (K-29)', () => {
    // D-16：キューチップの 📎（絵文字）と ▶（文字グリフ）は
    // アイコン体系（Lucide）の外。Paperclip／Play へ置き換える。
    expect(app).not.toContain('📎');
    expect(app).not.toContain('>▶</button>');
    const chip = app.slice(app.indexOf('data-testid="origin-send-queue-chip"'), app.indexOf('data-testid="origin-send-queue-chip"') + 1800);
    expect(chip).toContain('<Paperclip');
    expect(chip).toContain('<Play');
  });

  it('aligns the attachment chip height with its 44px remove button (K-30)', () => {
    // D-17：削除ボタン（44px）がチップの自然高より大きく、チップが
    // 膨らんで見えた。チップ自体の高さを 44px に揃える。
    expect(app).toContain('origin-surface-muted flex h-11 items-center gap-2 rounded-[var(--radius-control)] pl-2.5 pr-1');
  });

  it('unifies the sidebar toggle icon stroke with the sidebar close icon (K-31)', () => {
    // D-18：兄弟コントロールで線の太さが 2.1 と 1.9 に分かれていた。
    expect(app).toContain('<PanelLeft aria-hidden="true" size={18} strokeWidth={1.9} />');
    const sidebar = readFileSync(resolve(root, 'components/personal/OriginSidebar.tsx'), 'utf8');
    expect(sidebar).toContain('<PanelLeftClose aria-hidden="true" size={18} strokeWidth={1.9} />');
  });

  it('balances the home description folds so a line does not end right after a proper noun (K-32)', () => {
    // D-23：モバイルで説明文が「ORIGIN」の直後で折り返し3行に
    // なった。keep-all に加えて行バランスを指定する。
    const rule = indexCss.match(/\.origin-home-description \{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('word-break: keep-all;');
    expect(rule).toContain('text-wrap: balance;');
  });

  it('defines the answer table right-edge scroll cue (K-26)', () => {
    expect(indexCss).toContain('.origin-answer-table-frame { position: relative; margin: 1rem 0; }');
    expect(indexCss).toContain('.origin-answer-table-fade');
  });

  it('applies the 2026-11-25 external-evaluation display fixes', () => {
    // Home group: the intro no longer flexes the group apart, the
    // chips attach to the group at a fixed 24px, the composer keeps
    // the bottom pin through an auto top margin, and the mobile
    // heading-to-description span returns to a fixed 16px / 1.75.
    const groupBlock = topUi.slice(topUi.indexOf('Home group spacing (external evaluation fix, 2026-11-25)'));
    expect(groupBlock).toContain('.origin-app main .origin-home-intro');
    expect(groupBlock).toContain('flex: 0 1 auto !important;');
    expect(groupBlock).toContain('[data-testid="origin-starter-chips"]');
    expect(groupBlock).toContain('margin-top: 24px !important;');
    expect(groupBlock).toContain('.origin-app main .origin-home-composer');
    expect(groupBlock).toContain('margin-top: auto !important;');
    expect(groupBlock).toContain('margin-top: 16px !important;');
    expect(groupBlock).toContain('line-height: 1.75 !important;');
    expect(groupBlock).toContain('padding-top: 40px !important;');
    // One Orin at a time + the history drawer never covers the name
    // tag: both are visibility rules, so geometry contracts hold.
    expect(topUi).toContain('.origin-main--orin-panel-open .origin-orin-presence');
    expect(topUi).toContain('.origin-app main:has([data-testid="history-drawer"]) .origin-orin-presence__name');
    // Panel tabs meet the 44px floor. Panel expansion
    // (2026-11-25, ORIN_PANEL_EXPANSION_DESIGN §3/§6) supersedes
    // the pill segmented control and the per-row availability
    // chips: the tab bar is a full-width hairline with a sliding
    // accent underline (240ms on the designated curve), and the
    // chip styles are gone entirely.
    const tabRule = topUi.match(/\.origin-orin-panel__tab \{[^}]*\}/)?.[0] ?? '';
    expect(tabRule).toContain('min-height: 44px;');
    const tabsRule = topUi.match(/\.origin-orin-panel__tabs \{[^}]*\}/)?.[0] ?? '';
    expect(tabsRule).toContain('border-bottom: 1px solid var(--border-subtle);');
    expect(tabsRule).not.toContain('border-radius: 999px;');
    const indicatorRule = topUi.match(/\.origin-orin-panel__tab-indicator \{[^}]*\}/)?.[0] ?? '';
    expect(indicatorRule).toContain('background: var(--accent-primary);');
    expect(indicatorRule).toContain('240ms cubic-bezier(0.32, 0.72, 0, 1)');
    expect(topUi).not.toContain('.origin-orin-panel__chip');
    // The add-menu scrim covers the sidebar too (geometry in the
    // functional layer, background in the visual layer, as with the
    // app-root scrim).
    expect(functionalUi).toContain('.origin-sidebar[data-open="true"]::after');
    expect(topUi).toContain('.origin-sidebar[data-open="true"]::after');
    // The workspace tool header shares the chat header's 60px.
    const toolHeaderRule = topUi.match(/section\[aria-label="Workspace tool header"\] \{[^}]*\}/)?.[0] ?? '';
    expect(toolHeaderRule).toContain('min-height: 60px;');
    // The focused skip link reveals as a full-width bar at the top
    // and the shell yields the bar's height, so it covers neither
    // the header nor the Orin presence and its name tag (batch 2,
    // 2026-11-25 — supersedes the batch-1 below-the-header landing,
    // which still covered the presence and most of the tag).
    expect(indexCss).toContain('.origin-personal-shell:has(.origin-skip-link:focus-visible)');
    expect(indexCss).not.toContain('top: calc(max(1rem, env(safe-area-inset-top)) + 3.75rem);');
    // Settings rows revealed by focus or scrollIntoView stop below
    // the sticky header bar that now lives inside the scroll
    // region; the scroll padding is the bar's measured height
    // (batch 2 — supersedes the batch-1 24px, which could not
    // affect where a free scroll position lands), and the
    // release-identity disclosure carries a chevron.
    expect(indexCss).toContain('[data-testid="settings-scroll-region"]');
    expect(indexCss).toContain('scroll-padding-top: 83px;');
    expect(indexCss).not.toContain('scroll-padding-top: 24px;');
    expect(indexCss).toContain('.release-identity__chevron');
    // Batch 2 (blind re-evaluation of the batch-1 production): the
    // home hero group centres between the presence row and the
    // composer at >=640px, the add-menu scrim also dims the header
    // band, the empty Orin panel rail hugs its content, and the
    // image advanced-settings disclosure carries the same chevron.
    const balanceBlock = topUi.slice(topUi.indexOf('Home hero balance (external evaluation fix batch 2'));
    expect(balanceBlock).toContain('.origin-app main .origin-home-intro');
    expect(balanceBlock).toContain('margin-top: auto !important;');
    expect(functionalUi).toContain('.origin-personal-shell:has(.origin-add-menu[open]) .origin-header');
    expect(topUi).toContain('.origin-orin-panel--work-empty');
    expect(indexCss).toContain('.origin-image-advanced-settings__chevron');
    const settingsLegacy = readFileSync(resolve(root, 'components/SettingsModalLegacy.tsx'), 'utf8');
    expect(settingsLegacy).toContain('release-identity__chevron');
    // The Orin tap target's accessible name contains the visible
    // "Orin" label (WCAG 2.5.3).
    const presence = readFileSync(resolve(root, 'components/OrinFloatingPresence.tsx'), 'utf8');
    expect(presence).toContain("aria-label={ja ? 'Orin（いまの作業を表示）' : 'Orin (Show current work)'}");
    // The sidebar close button serves only the drawer forms; at lg
    // the header toggle is the single sidebar control.
    const sidebar = readFileSync(resolve(root, 'components/personal/OriginSidebar.tsx'), 'utf8');
    expect(sidebar).toContain('items-center justify-center lg:hidden');
    // Both loading splashes carry a spinner and the words
    // 読み込んでいます (boot splash in index.html, React splash in
    // SplashScreen + splash-brand.css).
    const indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    expect(indexHtml).toContain('origin-boot-splash__spinner');
    expect(indexHtml).toContain('読み込んでいます');
    expect(indexHtml).not.toContain('origin-boot-splash__loading');
    const splash = readFileSync(resolve(root, 'components/SplashScreen.tsx'), 'utf8');
    expect(splash).toContain('origin-ultra-splash__spinner');
    expect(splash).toContain('読み込んでいます');
    expect(splashBrand).toContain('.origin-ultra-splash__spinner');
    // The coding start button keeps the readable class-level
    // disabled recipe (no opacity wash) and the agent plan button
    // gains its missing-step hint; both workspace goal textareas
    // drop the resize handle.
    const coding = readFileSync(resolve(root, 'components/CodingJobWorkspaceV14.tsx'), 'utf8');
    expect(coding).toContain('className="origin-primary-button mt-3 min-h-11 w-full rounded-xl px-4 font-bold text-white disabled:cursor-not-allowed"');
    expect(coding).toContain('作りたいもの・直したいことを書くと始められます。');
    expect(coding).toContain('resize-none');
    const agent = readFileSync(resolve(root, 'components/AgentWorkspaceView.tsx'), 'utf8');
    expect(agent).toContain('agent-plan-button-hint');
    expect(agent).toContain('「任せたいこと」を書くと、このボタンを押せます。');
    expect(agent).toContain('resize-none');
  });
});
