/**
 * Regional-publication recognition for official sources.
 *
 * A regional figure is real data, but it is not the national value
 * a statistics question asks for (round 8, F-05: the adopted pool's
 * only value-bearing source was the Miyagi labour bureau's
 * prefectural PDF). This predicate began as part of the official
 * routing module (originOfficialSourceRouting.ts), where its only
 * consumer was the material-insufficiency retry trigger. The
 * re-measurement diagnosis (ANSWER_STATISTICS_REMEASURE_DIAGNOSIS_
 * 2026-11-26, structure H) found the knowledge wired nowhere else:
 * pool selection, extract targeting, and the evidence packet's
 * official bonus all treated a prefectural bureau's page as the
 * national publication's equal. Wiring it into those stages needs
 * the predicate in a leaf module: the routing module depends on
 * the research layer (answer-type classification), and the
 * research layer depends on the evidence packet, so the packet
 * cannot import the routing module without closing a cycle. This
 * module imports nothing and is imported by all three stages; the
 * routing module re-exports both names so existing imports keep
 * working.
 */

export interface OfficialMaterialSourceShape {
  title: string;
  url: string;
  excerpt: string;
  domain: string;
  authorityTier: string;
}

/**
 * The 47 prefectures, kanji stems and romaji slugs — a fixed
 * geographic vocabulary, used only to recognize REGIONAL content
 * (a prefectural bureau's release of its own local figure) as
 * distinct from the national publication.
 */
const PREFECTURE_KANJI_STEMS: readonly string[] = [
  "北海道", "青森", "岩手", "宮城", "秋田", "山形", "福島", "茨城", "栃木", "群馬",
  "埼玉", "千葉", "東京", "神奈川", "新潟", "富山", "石川", "福井", "山梨", "長野",
  "岐阜", "静岡", "愛知", "三重", "滋賀", "京都", "大阪", "兵庫", "奈良", "和歌山",
  "鳥取", "島根", "岡山", "広島", "山口", "徳島", "香川", "愛媛", "高知", "福岡",
  "佐賀", "長崎", "熊本", "大分", "宮崎", "鹿児島", "沖縄",
];
const PREFECTURE_ROMAJI_SLUGS: readonly string[] = [
  "hokkaido", "aomori", "iwate", "miyagi", "akita", "yamagata", "fukushima",
  "ibaraki", "tochigi", "gunma", "saitama", "chiba", "tokyo", "kanagawa",
  "niigata", "toyama", "ishikawa", "fukui", "yamanashi", "nagano", "gifu",
  "shizuoka", "aichi", "mie", "shiga", "kyoto", "osaka", "hyogo", "nara",
  "wakayama", "tottori", "shimane", "okayama", "hiroshima", "yamaguchi",
  "tokushima", "kagawa", "ehime", "kochi", "fukuoka", "saga", "nagasaki",
  "kumamoto", "oita", "miyazaki", "kagoshima", "okinawa",
];
/**
 * Hosts that serve only regional (prefectural) content: the MHLW
 * local-bureau portal host, under which every prefectural labour
 * bureau publishes (jsite.mhlw.go.jp/miyagi-roudoukyoku/…). The host
 * is official, but nothing on it is the national release.
 */
const REGIONAL_ONLY_HOSTS: ReadonlySet<string> = new Set(["jsite.mhlw.go.jp"]);

/** True when the source is a regional (prefectural) publication. */
export function isRegionalOfficialSource(source: OfficialMaterialSourceShape): boolean {
  if (REGIONAL_ONLY_HOSTS.has(source.domain)) return true;
  const title = (source.title ?? "").normalize("NFKC");
  if (PREFECTURE_KANJI_STEMS.some((name) => title.includes(name))) return true;
  const url = (source.url ?? "").toLowerCase();
  return PREFECTURE_ROMAJI_SLUGS.some((slug) => url.includes(slug));
}
