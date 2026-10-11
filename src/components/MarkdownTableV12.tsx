import type { ReactNode } from "react";
export default function MarkdownTableV12({children,language}:{children:ReactNode;language:"ja"|"en"}) {
  return <div className="origin-answer-table-scroll" role="region" aria-label={language==="en"?"Scrollable answer table":"横にスクロールできる回答表"} tabIndex={0}><table>{children}</table></div>;
}
