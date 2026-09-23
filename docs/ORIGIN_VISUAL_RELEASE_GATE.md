# ORIGIN UI/UX Visual Release Gate

## 最優先追加指示：PR #608以降のVisual Release Gate（2026-09-22）

本節はOwnerからの最新指示。後続本文・付録・旧監査資料と矛盾する場合、本節を優先する。旧監査の上部Mode常設案、Project上部UIの折りたたみだけで完了とする案は最終仕様にしない。

**Owner visual approval＋exact-head CI全GREENまでProduction公開禁止。実Android keyboard検証も必須。** 過去の包括的公開指示や旧headのCI成功を、このゲートの代替にしない。自動本番配備を伴うmainへのマージもゲート通過前に行わない。

### 監査順と合格基準

| 順序 | 項目 | 基準 |
|---|---|---|
| 1 | 二重Header | Headerは1段のみ。高さはPC 48〜56px／Mobile 44〜48px目安。空画面primary controlsは約5〜6個以内 |
| 2 | Composer内Mode切替 | Modeは最終的にComposer付近に配置。操作・メニューの見切れなし |
| 3 | Project上部UI撤去 | Projectの水平上部タブを撤去。折りたたみだけで完了としない |
| 4 | Artifact表示 | PCはChat＋Artifact split。MobileはArtifact存在時のみ会話／成果物切替を表示 |
| 5 | Agent/Research/Tool/Approval状態表示 | 状態を実画面で確認。Agent/Tool状態はChat timeline内に表示 |
| 6 | Typography | AI本文15〜16px、line-height 1.6〜1.7目安 |
| 7 | 390px Responsive | 390pxで横スクロール0、Composer clipping 0。実Android keyboard検証必須 |

### 証拠・判定の記録

- 各項目に対象PR、完全なhead SHA、preview URL、確認日時、画面サイズ、状態、スクリーンショット／動画、実測値、PASS／FAIL／未検証を記録する。
- 空画面、会話中、Artifact有無、Agent／Research／Tool実行中、Approval待ちを確認する。未取得の状態を推測でPASSにしない。
- Android実機は機種、OS、ブラウザー、キーボード、対象SHAを記録し、キーボード開閉・日本語入力・複数行入力・送信操作時のComposerと会話の見切れを確認する。エミュレーションやviewport高さ変更は実機検証の代替にしない。
- Ownerへ提示した実画面と承認対象SHAを記録する。head更新後は新headのCIと画面証拠を確認し、旧headの承認を自動転用しない。
- 数値の「目安」は設計目標として記録し、差異は実測値と理由をOwnerへ提示する。必須条件の未検証・不合格を目安扱いで通過させない。
- この文書更新はゲートの採用・引き継ぎであり、GitHub branch protectionやCIによる自動強制の実装完了を意味しない。

### 今回の状態

ゲートを登録。今回、PR #608以降のライブhead・CI・実画面・実Android keyboard・Owner visual approvalは確認していない。したがって公開可とは判定しない。次の担当は最新headを取得し、上記1〜7の順で監査・修正・証拠収集を進める。


## Implementation checkpoint

Base: PR #608 `1204e14ffeec780fe4ffc9e555b3feaddcbaf3da`.

- Fixed duplicate navigation close controls; drawer now uses a portal, background inertness, focus containment, Escape and focus restoration.
- Embedded App omits its own header structurally; standalone App keeps its header.
- Composer mode is a React slot, without a document-wide MutationObserver. Research/Code/Create also receive the mode control next to their input.
- Existing drawer-only Project navigation is retained.
- One App-owned ArtifactWorkspace handles generated, restored and selected artifacts. Streaming steering and revision editing remain in App; Personal owns the selected view.
- Mobile tabs remain above the artifact pane; desktop reserves the pane width beside Chat.
- Composer uses a full-width input row and a separate controls row. AI markdown uses 16px / 1.65.
- Browser journeys now use the actual navigation drawer and composer; assertions cover absent Project chrome, header height, primary-control count, bounds, typography, artifact selection and screenshots.

Local: 269 unit test files / 2,303 tests passed; typecheck, design-token lock and build passed. Additional drawer check passed after settings focus-handoff refinement. These are not exact-head CI results.

Local browser verification blocked: Chrome launch fails with socket Operation not permitted in this execution environment. No permission bypass was attempted. CI must produce browser evidence for the pushed head.

## Outstanding release conditions

- Exact-head CI: pending after push.
- Exact-head screenshot review: pending.
- Agent/Research/Tool/Approval states within Chat timeline: NOT completed by this change; retain as gate item 5.
- Real Android keyboard: NOT verified; viewport emulation is not a substitute.
- Owner visual approval: NOT obtained for this candidate.
- Production: prohibited; no merge or deployment.
