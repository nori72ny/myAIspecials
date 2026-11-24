import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * 回答表の枠内横スクロール（現行仕様 C-10）と、右端の手がかり
 * （K-26、2026-11-24）：表が枠より広く、まだ右へスクロールできる
 * ときだけ、右端にフェードを重ねて「横に続きがある」ことを示す。
 * スクロールし切ったらフェードは消える。判定は実測
 * （scrollWidth／clientWidth／scrollLeft）で行い、表が枠に
 * 収まるときはフェードを出さない。
 */
export default function MarkdownTableV12({ children, language }: { children: ReactNode; language: "ja" | "en" }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hasMoreRight, setHasMoreRight] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      setHasMoreRight(el.scrollWidth - el.clientWidth - el.scrollLeft > 1);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    observer?.observe(el);
    if (el.firstElementChild) observer?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, []);

  return (
    <div className="origin-answer-table-frame">
      <div ref={scrollRef} className="origin-answer-table-scroll" role="region" aria-label={language === "en" ? "Scrollable answer table" : "横にスクロールできる回答表"} tabIndex={0}><table>{children}</table></div>
      {hasMoreRight && <div className="origin-answer-table-fade" aria-hidden="true" />}
    </div>
  );
}
