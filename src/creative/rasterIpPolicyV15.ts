/**
 * Copyright policy guard for raster generation requests (owner policy,
 * adopted 2026-11-16): generated illustrations and images must be ORIGIN
 * originals — no copyrighted material, no depiction of existing
 * characters, brands, or logos, and no loss of quality to achieve it.
 *
 * This module is the deterministic, prompt-side enforcement. It runs on
 * the raw user request before planning, with no model call and no
 * network access, so it is immediate and costs nothing:
 *
 * - A protected name used only as a style qualifier ("ジブリ風の田園
 *   風景", "in the style of Studio Ghibli") or as a brand possessive
 *   mention ("スターバックスのカップを持つ女性") is REMOVED and the
 *   request proceeds with the remaining, independently specified
 *   subject (action: 'rewrite'). The subject the user actually asked
 *   for is preserved; only the imitation instruction is stripped.
 * - A protected name that IS the requested subject — a character to
 *   draw, a brand logo to reproduce — is NOT silently substituted
 *   (the design canon forbids changing the subject's identity behind
 *   the user's back), so the request is returned with a plain-language
 *   explanation (action: 'block'), following the router's existing
 *   422 refusal pattern. The same block applies when stripping a
 *   qualifier would leave no subject at all.
 * - Anything else passes through byte-identical (action: 'pass').
 *
 * Detection is dictionary-based: a fixed server-side list of major
 * character / franchise / studio / creator / brand names (Japanese and
 * English). It deliberately stays conservative — ambiguous everyday
 * words (ワンピース the dress, アップルパイ, the fruit "apple") are NOT
 * entries, because a false positive refuses a legitimate request,
 * while a false negative is still covered downstream: the planner's
 * compiledPrompt carries an originality constraint, the enhancement
 * instruction forbids adding brands, and the semantic critic records
 * an ipSimilarity shadow axis (calibration only) for depicted
 * lookalikes the dictionary does not know. The dictionary is a list
 * to grow, not a proof of absence.
 */

export type RasterIpProtectedKindV15 =
  | 'character'
  | 'franchise'
  | 'studio'
  | 'creator'
  | 'brand';

export type RasterIpMatchRoleV15 =
  | 'style-qualifier'
  | 'brand-mention'
  | 'logo'
  | 'subject';

export type RasterIpPolicyMatchV15 = {
  id: string;
  kind: RasterIpProtectedKindV15;
  matched: string;
  role: RasterIpMatchRoleV15;
};

export type RasterIpPolicyResultV15 = {
  action: 'pass' | 'rewrite' | 'block';
  /** The effective prompt: the input for 'pass'/'block', the cleaned
   *  prompt with imitation spans removed for 'rewrite'. */
  prompt: string;
  matches: readonly RasterIpPolicyMatchV15[];
  /** Why the request was blocked, when action is 'block'. */
  blockReason: 'protected-subject' | 'protected-logo' | 'no-subject-after-rewrite' | null;
};

/** Plain-language explanation returned with the 422 refusal, in the
 *  same style as the router's other policy refusals: it says what
 *  cannot be done and how to rephrase, without internal terminology. */
export const RASTER_IP_POLICY_BLOCK_MESSAGE_V15 =
  '既存のキャラクターやブランドそのものを描くことはできません。キャラクターやブランドの名前を使わず、描きたいものの特徴を一般的な言葉で表して、もう一度お試しください。';

type ProtectedEntry = {
  id: string;
  kind: RasterIpProtectedKindV15;
  names: readonly string[];
};

const PROTECTED_ENTRIES: readonly ProtectedEntry[] = [
  { id: 'mickey-mouse', kind: 'character', names: ['ミッキーマウス', 'Mickey Mouse'] },
  { id: 'minnie-mouse', kind: 'character', names: ['ミニーマウス', 'Minnie Mouse'] },
  { id: 'donald-duck', kind: 'character', names: ['ドナルドダック', 'Donald Duck'] },
  { id: 'winnie-the-pooh', kind: 'character', names: ['くまのプーさん', 'Winnie the Pooh'] },
  { id: 'doraemon', kind: 'character', names: ['ドラえもん', 'Doraemon'] },
  { id: 'pikachu', kind: 'character', names: ['ピカチュウ', 'Pikachu'] },
  { id: 'pokemon', kind: 'franchise', names: ['ポケットモンスター', 'ポケモン', 'Pokémon', 'Pokemon'] },
  { id: 'hello-kitty', kind: 'character', names: ['ハローキティ', 'Hello Kitty'] },
  { id: 'my-melody', kind: 'character', names: ['マイメロディ', 'My Melody'] },
  { id: 'cinnamoroll', kind: 'character', names: ['シナモロール', 'Cinnamoroll'] },
  { id: 'anpanman', kind: 'character', names: ['アンパンマン', 'Anpanman'] },
  { id: 'snoopy', kind: 'character', names: ['スヌーピー', 'Snoopy'] },
  { id: 'mario', kind: 'character', names: ['スーパーマリオ', 'Super Mario', 'マリオ', 'Mario'] },
  { id: 'luigi', kind: 'character', names: ['ルイージ', 'Luigi'] },
  { id: 'zelda', kind: 'franchise', names: ['ゼルダの伝説', 'The Legend of Zelda', 'Legend of Zelda'] },
  { id: 'kirby', kind: 'character', names: ['星のカービィ', 'カービィ', 'Kirby'] },
  { id: 'sonic', kind: 'character', names: ['ソニック・ザ・ヘッジホッグ', 'Sonic the Hedgehog', 'ソニック'] },
  { id: 'totoro', kind: 'character', names: ['となりのトトロ', 'トトロ', 'Totoro'] },
  { id: 'ghibli', kind: 'studio', names: ['スタジオジブリ', 'Studio Ghibli', 'ジブリ', 'Ghibli'] },
  { id: 'disney', kind: 'studio', names: ['ディズニー', 'Disney'] },
  { id: 'pixar', kind: 'studio', names: ['ピクサー', 'Pixar'] },
  { id: 'nintendo', kind: 'brand', names: ['任天堂', 'Nintendo'] },
  { id: 'sanrio', kind: 'brand', names: ['サンリオ', 'Sanrio'] },
  { id: 'dragon-ball', kind: 'franchise', names: ['ドラゴンボール', 'Dragon Ball'] },
  { id: 'naruto', kind: 'franchise', names: ['Naruto'] },
  { id: 'demon-slayer', kind: 'franchise', names: ['鬼滅の刃', 'Demon Slayer'] },
  { id: 'jujutsu-kaisen', kind: 'franchise', names: ['呪術廻戦', 'Jujutsu Kaisen'] },
  { id: 'attack-on-titan', kind: 'franchise', names: ['進撃の巨人', 'Attack on Titan'] },
  { id: 'detective-conan', kind: 'franchise', names: ['名探偵コナン', 'Detective Conan'] },
  { id: 'crayon-shinchan', kind: 'franchise', names: ['クレヨンしんちゃん', 'Crayon Shin-chan'] },
  { id: 'chibi-maruko', kind: 'franchise', names: ['ちびまる子ちゃん'] },
  { id: 'sazae-san', kind: 'franchise', names: ['サザエさん'] },
  { id: 'lupin', kind: 'franchise', names: ['ルパン三世', 'Lupin III'] },
  { id: 'gundam', kind: 'franchise', names: ['機動戦士ガンダム', 'ガンダム', 'Gundam'] },
  { id: 'evangelion', kind: 'franchise', names: ['エヴァンゲリオン', 'Evangelion'] },
  { id: 'hatsune-miku', kind: 'character', names: ['初音ミク', 'Hatsune Miku'] },
  { id: 'minecraft', kind: 'franchise', names: ['マインクラフト', 'Minecraft'] },
  { id: 'fortnite', kind: 'franchise', names: ['フォートナイト', 'Fortnite'] },
  { id: 'animal-crossing', kind: 'franchise', names: ['どうぶつの森', 'Animal Crossing'] },
  { id: 'dragon-quest', kind: 'franchise', names: ['ドラゴンクエスト', 'ドラクエ', 'Dragon Quest'] },
  { id: 'final-fantasy', kind: 'franchise', names: ['ファイナルファンタジー', 'Final Fantasy'] },
  { id: 'monster-hunter', kind: 'franchise', names: ['モンスターハンター', 'モンハン', 'Monster Hunter'] },
  { id: 'digimon', kind: 'franchise', names: ['デジモン', 'Digimon'] },
  { id: 'yu-gi-oh', kind: 'franchise', names: ['遊戯王', 'Yu-Gi-Oh'] },
  { id: 'rilakkuma', kind: 'character', names: ['リラックマ', 'Rilakkuma'] },
  { id: 'sumikko-gurashi', kind: 'franchise', names: ['すみっコぐらし', 'Sumikko Gurashi'] },
  { id: 'hayao-miyazaki', kind: 'creator', names: ['宮崎駿', 'Hayao Miyazaki'] },
  { id: 'makoto-shinkai', kind: 'creator', names: ['新海誠', 'Makoto Shinkai'] },
  { id: 'akira-toriyama', kind: 'creator', names: ['鳥山明', 'Akira Toriyama'] },
  { id: 'nike', kind: 'brand', names: ['ナイキ', 'Nike'] },
  { id: 'adidas', kind: 'brand', names: ['アディダス', 'Adidas'] },
  { id: 'starbucks', kind: 'brand', names: ['スターバックス', 'Starbucks'] },
  { id: 'mcdonalds', kind: 'brand', names: ['マクドナルド', "McDonald's", 'McDonalds'] },
  { id: 'coca-cola', kind: 'brand', names: ['コカ・コーラ', 'コカコーラ', 'Coca-Cola'] },
  { id: 'pepsi', kind: 'brand', names: ['ペプシ', 'Pepsi'] },
  { id: 'louis-vuitton', kind: 'brand', names: ['ルイ・ヴィトン', 'ルイヴィトン', 'Louis Vuitton'] },
  { id: 'chanel', kind: 'brand', names: ['シャネル', 'Chanel'] },
  { id: 'gucci', kind: 'brand', names: ['グッチ', 'Gucci'] },
  { id: 'hermes', kind: 'brand', names: ['エルメス', 'Hermès', 'Hermes'] },
  { id: 'prada', kind: 'brand', names: ['プラダ', 'Prada'] },
  { id: 'rolex', kind: 'brand', names: ['ロレックス', 'Rolex'] },
  { id: 'lego', kind: 'brand', names: ['レゴ', 'LEGO', 'Lego'] },
];

type Occurrence = {
  entry: ProtectedEntry;
  matched: string;
  start: number;
  end: number;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find every dictionary occurrence in the normalized text. Latin-script
 * names match case-insensitively on word boundaries; Japanese names
 * match as substrings. Overlaps (a long alias containing a shorter one,
 * e.g. スーパーマリオ vs マリオ) resolve to the longest match so each
 * span is classified once.
 */
function findOccurrences(text: string): Occurrence[] {
  const found: Occurrence[] = [];
  for (const entry of PROTECTED_ENTRIES) {
    for (const name of entry.names) {
      if (/[A-Za-z]/.test(name)) {
        const pattern = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(name)}(?![A-Za-z0-9])`, 'gi');
        for (const match of text.matchAll(pattern)) {
          found.push({ entry, matched: match[0], start: match.index, end: match.index + match[0].length });
        }
      } else {
        let index = text.indexOf(name);
        while (index !== -1) {
          found.push({ entry, matched: name, start: index, end: index + name.length });
          index = text.indexOf(name, index + name.length);
        }
      }
    }
  }
  found.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const resolved: Occurrence[] = [];
  for (const occurrence of found) {
    const last = resolved[resolved.length - 1];
    if (last && occurrence.start < last.end) continue;
    resolved.push(occurrence);
  }
  return resolved;
}

// A protected name is a removable style qualifier when the text right
// after it (or, for English, right before it) is a style connector:
// ジブリ風 / ピクサー・スタイル / 新海誠の画風 / "Ghibli-style" /
// "in the style of Studio Ghibli". The removal span then covers the
// name plus the connector (and a trailing の/な that belonged to it).
const JP_STYLE_SUFFIX = /^(?:風|スタイル|調|っぽい|みたいな|みたいに|タッチ|のタッチ|の作画|の画風|の世界観)(?:の|な|に)?/;
const EN_STYLE_SUFFIX = /^[\s-]*(?:style|styled|inspired)\b/;
const EN_STYLE_PREFIX = /(?:in the style of|style of)\s*$/i;
const JP_LOGO_SUFFIX = /^の(?:ロゴ|マーク|エンブレム)/;
const EN_LOGO_SUFFIX = /^\s+(?:logo|emblem|mascot)\b/i;
const EN_LOGO_PREFIX = /(?:logo|emblem|mascot)\s+of\s*$/i;
const JP_BRAND_POSSESSIVE = /^の/;

type ClassifiedOccurrence = {
  occurrence: Occurrence;
  role: RasterIpMatchRoleV15;
  /** Span to remove for rewrite roles: [start, end) in the text. */
  removal: { start: number; end: number } | null;
};

function classify(text: string, occurrence: Occurrence): ClassifiedOccurrence {
  const before = text.slice(0, occurrence.start);
  const after = text.slice(occurrence.end);

  const jpStyle = JP_STYLE_SUFFIX.exec(after);
  if (jpStyle) {
    return {
      occurrence,
      role: 'style-qualifier',
      removal: { start: occurrence.start, end: occurrence.end + jpStyle[0].length },
    };
  }
  const enStyleSuffix = EN_STYLE_SUFFIX.exec(after);
  if (enStyleSuffix) {
    return {
      occurrence,
      role: 'style-qualifier',
      removal: { start: occurrence.start, end: occurrence.end + enStyleSuffix[0].length },
    };
  }
  const enStylePrefix = EN_STYLE_PREFIX.exec(before);
  if (enStylePrefix) {
    return {
      occurrence,
      role: 'style-qualifier',
      removal: { start: occurrence.start - enStylePrefix[0].length, end: occurrence.end },
    };
  }

  if (JP_LOGO_SUFFIX.test(after) || EN_LOGO_SUFFIX.test(after) || EN_LOGO_PREFIX.test(before)) {
    return { occurrence, role: 'logo', removal: null };
  }

  if (occurrence.entry.kind === 'brand' && JP_BRAND_POSSESSIVE.test(after)) {
    return {
      occurrence,
      role: 'brand-mention',
      removal: { start: occurrence.start, end: occurrence.end + 1 },
    };
  }

  return { occurrence, role: 'subject', removal: null };
}

// Mirrors the visual planner's subject test: after removing image
// words, creation verbs, and filler tokens, is there still a content
// word that can carry the image? Used only to decide whether a rewrite
// leaves a viable request behind; the planner re-runs its own full
// readiness check on the rewritten prompt afterwards.
const RESIDUE_FILLER_TOKEN = /^(?:これ|それ|あれ|この|その|あの|どの|何か|なにか|なんか|えっと|うーん|あのー|something|anything|it|this|that|a|an|the)$/i;
const RESIDUE_TRAILING_PARTICLES = /(?:の|を|に|が|は|へ|と|も|で|だけ|から|まで|より|だ|です)+$/;

function hasMeaningfulResidue(text: string): boolean {
  const residue = text
    .replace(/(?:画像|イラスト|写真|絵|ポスター|バナー|サムネ(?:イル)?|ロゴ|アイコン|壁紙|アート|キービジュアル)/gi, ' ')
    .replace(/(?:作って|作成して|生成して|描いて|お願い(?:します)?|ほしい|欲しい|ください)/g, ' ')
    .replace(/\b(?:generate|create|make|draw|render|design|please|image|picture|illustration|poster|banner|thumbnail|logo|icon|wallpaper|artwork|key visual)\b/gi, ' ');
  return residue
    .split(/[\s。、,.!?！？・:：/]+/)
    .map((token) => token.replace(RESIDUE_TRAILING_PARTICLES, ''))
    .some((token) => token.length > 0 && !RESIDUE_FILLER_TOKEN.test(token));
}

function cleanupRewritten(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/ ([。、,.!?！？])/g, '$1')
    .replace(/([、。])\1+/g, '$1')
    .replace(/^[のなにをで、,\s]+/, '')
    .replace(/\s+$/, '')
    .trim();
}

export function applyRasterIpPolicyV15(input: string): RasterIpPolicyResultV15 {
  const text = input.normalize('NFKC').trim();
  const occurrences = findOccurrences(text);
  if (occurrences.length === 0) {
    return { action: 'pass', prompt: input, matches: [], blockReason: null };
  }

  const classified = occurrences.map((occurrence) => classify(text, occurrence));
  const matches: RasterIpPolicyMatchV15[] = classified.map(({ occurrence, role }) => ({
    id: occurrence.entry.id,
    kind: occurrence.entry.kind,
    matched: occurrence.matched,
    role,
  }));

  const logo = classified.find(({ role }) => role === 'logo');
  if (logo) return { action: 'block', prompt: input, matches, blockReason: 'protected-logo' };
  const subject = classified.find(({ role }) => role === 'subject');
  if (subject) return { action: 'block', prompt: input, matches, blockReason: 'protected-subject' };

  // Every occurrence is removable: strip the spans from the end so the
  // earlier offsets stay valid, then confirm a subject survives.
  let rewritten = text;
  const removals = classified
    .map(({ removal }) => removal)
    .filter((removal): removal is { start: number; end: number } => removal !== null)
    .sort((a, b) => b.start - a.start);
  for (const removal of removals) {
    rewritten = rewritten.slice(0, removal.start) + rewritten.slice(removal.end);
  }
  rewritten = cleanupRewritten(rewritten);
  if (!hasMeaningfulResidue(rewritten)) {
    return { action: 'block', prompt: input, matches, blockReason: 'no-subject-after-rewrite' };
  }
  return { action: 'rewrite', prompt: rewritten, matches, blockReason: null };
}
