// 'research' と 'creative' は専用画面としては廃止された。'research' は
// チャット内のモードに、'creative' は会話のそばの成果物パネルになった
// （画面構成の見直し 2026-11-09）。専用画面は agent / coding に加え、
// 2026-11-25 のオーナー指示で 'ai-news'（AIの最新情報）と 'remaining'
// （残っている依頼）がオリンパネルのタブから移設されて増えた。
export type OriginWorkspaceModeV31 = 'chat' | 'agent' | 'coding' | 'ai-news' | 'remaining';
