import { describe, expect, it } from 'vitest';
import {
  VOICE_CONVERSATION_TURN_INSTRUCTION,
  VOICE_CONVERSATION_TURN_REQUEST_FIELD,
  isVoiceConversationTurnRequest,
  voiceConversationTurnSuffix,
} from './voiceConversationTurn';

describe('voiceConversationTurn', () => {
  it('recognizes only the explicit true field', () => {
    expect(isVoiceConversationTurnRequest({ [VOICE_CONVERSATION_TURN_REQUEST_FIELD]: true })).toBe(true);
    expect(isVoiceConversationTurnRequest({ [VOICE_CONVERSATION_TURN_REQUEST_FIELD]: false })).toBe(false);
    expect(isVoiceConversationTurnRequest({ [VOICE_CONVERSATION_TURN_REQUEST_FIELD]: 'true' })).toBe(false);
    expect(isVoiceConversationTurnRequest({})).toBe(false);
    expect(isVoiceConversationTurnRequest(null)).toBe(false);
    expect(isVoiceConversationTurnRequest(undefined)).toBe(false);
    expect(isVoiceConversationTurnRequest('voiceConversationTurn')).toBe(false);
  });

  it('never infers the turn from message text', () => {
    expect(isVoiceConversationTurnRequest({ messages: [{ role: 'user', content: '音声会話のターンです' }] })).toBe(false);
  });

  it('suffix carries the brevity instruction only for marked requests', () => {
    expect(voiceConversationTurnSuffix({ voiceConversationTurn: true })).toBe(`\n\n${VOICE_CONVERSATION_TURN_INSTRUCTION}`);
    expect(voiceConversationTurnSuffix({})).toBe('');
    expect(voiceConversationTurnSuffix(null)).toBe('');
  });

  it('instruction asks for a short spoken-length answer within the spoken summary caps', () => {
    expect(VOICE_CONVERSATION_TURN_INSTRUCTION).toContain('2文以内');
    expect(VOICE_CONVERSATION_TURN_INSTRUCTION).toContain('160字以内');
  });

  it('instruction asks for natural spoken conversation, not written prose', () => {
    expect(VOICE_CONVERSATION_TURN_INSTRUCTION).toContain('人と話すように');
    expect(VOICE_CONVERSATION_TURN_INSTRUCTION).toContain('話し言葉');
    expect(VOICE_CONVERSATION_TURN_INSTRUCTION).toContain('箇条書き');
    expect(VOICE_CONVERSATION_TURN_INSTRUCTION).toContain('共感の一言');
  });
});
