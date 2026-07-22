export interface OriginContextMessage {
  role: "user" | "ai" | "assistant" | "model";
  content: string;
}

export interface OriginContextPolicy {
  version: 1;
  maxMessages: number;
  maxCharacters: number;
}

export interface OriginContextWindow {
  messages: OriginContextMessage[];
  policyVersion: 1;
  includedMessageCount: number;
  includedCharacterCount: number;
  omittedMessageCount: number;
  omittedCharacterCount: number;
}

export type OriginContextResult =
  | { ok: true; window: OriginContextWindow }
  | {
      ok: false;
      code: "LATEST_MESSAGE_TOO_LARGE" | "INVALID_CONTEXT_POLICY";
      message: string;
    };

export const DEFAULT_ORIGIN_CONTEXT_POLICY: OriginContextPolicy = {
  version: 1,
  maxMessages: 12,
  maxCharacters: 12_000,
};

function isValidPolicy(policy: OriginContextPolicy): boolean {
  return policy.version === 1
    && Number.isInteger(policy.maxMessages)
    && policy.maxMessages >= 1
    && policy.maxMessages <= 50
    && Number.isInteger(policy.maxCharacters)
    && policy.maxCharacters >= 1_000
    && policy.maxCharacters <= 50_000;
}

function characterCount(messages: readonly OriginContextMessage[]): number {
  return messages.reduce((total, message) => total + message.content.length, 0);
}

export function minimizeOriginContext(
  messages: readonly OriginContextMessage[],
  policy: OriginContextPolicy = DEFAULT_ORIGIN_CONTEXT_POLICY,
): OriginContextResult {
  if (!isValidPolicy(policy)) {
    return {
      ok: false,
      code: "INVALID_CONTEXT_POLICY",
      message: "外部AIへ送る文脈の制限値が正しくありません。",
    };
  }

  const latest = messages[messages.length - 1];
  if (!latest || latest.content.length > policy.maxCharacters) {
    return {
      ok: false,
      code: "LATEST_MESSAGE_TOO_LARGE",
      message: `最新の依頼が外部送信の上限（${policy.maxCharacters}文字）を超えています。内容を分割または要約してください。`,
    };
  }

  const selected: OriginContextMessage[] = [latest];
  let selectedCharacters = latest.content.length;

  for (let index = messages.length - 2; index >= 0; index -= 1) {
    if (selected.length >= policy.maxMessages) break;
    const candidate = messages[index];
    if (selectedCharacters + candidate.content.length > policy.maxCharacters) break;
    selected.unshift(candidate);
    selectedCharacters += candidate.content.length;
  }

  while (selected.length > 1 && selected[0].role !== "user") {
    selectedCharacters -= selected[0].content.length;
    selected.shift();
  }

  const totalCharacters = characterCount(messages);

  return {
    ok: true,
    window: {
      messages: selected,
      policyVersion: policy.version,
      includedMessageCount: selected.length,
      includedCharacterCount: selectedCharacters,
      omittedMessageCount: messages.length - selected.length,
      omittedCharacterCount: totalCharacters - selectedCharacters,
    },
  };
}
