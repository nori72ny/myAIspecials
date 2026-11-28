/**
* Voice conversation turn marker (speed program, 2026-11-28).
*
* A chat request that began as a spoken conversation turn carries the
* explicit `voiceConversationTurn` field, so the server can tell it
* apart from a typed request by the field — never by scanning its
* text (the same discipline as `refinementOfPreviousAnswer`). For
* such requests the routers append the brevity instruction below to
* every route's system instruction: a conversation answer is heard,
* not read, and the conversation controller speaks at most
* 2 sentences / 160 characters of it (VOICE_CONVERSATION_SUMMARY_MAX_*),
* so generating a long essay first and summarizing it afterwards
* wastes the one resource the owner feels directly — time.
*
* The instruction asks for the short answer up front; it does not
* relax any quality gate. The spoken text still comes only from the
* verified final answer, exactly as before.
*/

export const VOICE_CONVERSATION_TURN_REQUEST_FIELD = 'voiceConversationTurn' as const;

export const VOICE_CONVERSATION_TURN_INSTRUCTION =
'これは音声会話のターンです。人と話すように、自然な話し言葉で答えてください。'
+ '目安は2文以内・160字以内で、結論から短く。硬い書き言葉・箇条書き・見出しは使わず、「〜です。しかし」のような文章のつなぎは「〜です。でも」のような話し言葉にしてください。'
+ '相手の気持ちや状況に触れる内容なら、まず共感の一言（「お疲れさまです」「それは大変でしたね」など、その場に合う一言）を添えてから答えてください。'
+ '毎回質問で締める必要はありません。詳しい説明が要る場合も、まず短い答えを返してください。';

export function isVoiceConversationTurnRequest(body: unknown): boolean {
if (typeof body!== 'object' || body === null) return false;
return (body as Record<string, unknown>)[VOICE_CONVERSATION_TURN_REQUEST_FIELD] === true;
}

/** The suffix to append to a route system instruction, or '' when
* the request is not a voice conversation turn. */
export function voiceConversationTurnSuffix(body: unknown): string {
return isVoiceConversationTurnRequest(body)? `\n\n${VOICE_CONVERSATION_TURN_INSTRUCTION}`: '';
}
