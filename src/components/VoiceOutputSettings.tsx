import { useEffect, useState, useSyncExternalStore } from 'react';
import { Check, Play, Square, Volume2 } from 'lucide-react';
import type { OriginLanguage } from '../i18n';
import { cn } from '../utils';
import {
  getVoiceOutputAvailability,
  subscribeVoiceOutputAvailability,
} from '../voice/voiceOutputAvailability';
import {
  voiceSpeech,
  VOICE_PREVIEW_PLAYBACK_ID,
  type OrinVoiceOption,
} from '../voice/voiceSpeech';

interface Props {
  language: OriginLanguage;
}

/**
 * "Orin's voice" settings section (VC-1, VOICE_CONVERSATION_DESIGN
 * 2026-11-18 — persona addition 2026-11-18 night).
 *
 * The conversation partner is Orin, so the voice choice is presented
 * as Orin's voice, picked from the Japanese voices installed on this
 * device (on-device voices first; a gender label is attached only
 * when the voice's well-known name carries one). The choice is stored
 * on the device only. The whole section renders nothing while the
 * server switch is off or unproven — same fail-closed shape as the
 * rest of the read-aloud surface.
 */
export default function VoiceOutputSettings({ language }: Props) {
  const ja = language === 'ja';
  const availability = useSyncExternalStore(
    subscribeVoiceOutputAvailability,
    getVoiceOutputAvailability,
    getVoiceOutputAvailability,
  );
  const activeId = useSyncExternalStore(
    (listener) => voiceSpeech.subscribe(listener),
    () => voiceSpeech.getActiveId(),
    () => voiceSpeech.getActiveId(),
  );
  const [voices, setVoices] = useState<OrinVoiceOption[]>(() => voiceSpeech.listJapaneseVoices());
  const [selectedURI, setSelectedURI] = useState<string | null>(() => voiceSpeech.getSelectedVoiceURI());

  // Device voice catalogues often arrive after first paint
  // (voiceschanged); keep the list current while the section is open.
  useEffect(() => {
    setVoices(voiceSpeech.listJapaneseVoices());
    return voiceSpeech.subscribeVoices(() => setVoices(voiceSpeech.listJapaneseVoices()));
  }, []);

  if (availability !== 'available' || !voiceSpeech.supported()) return null;

  const effectiveURI = selectedURI && voices.some((voice) => voice.voiceURI === selectedURI)
    ? selectedURI
    : (voices[0]?.voiceURI ?? null);
  const previewing = activeId === VOICE_PREVIEW_PLAYBACK_ID;

  const selectVoice = (voiceURI: string) => {
    voiceSpeech.selectVoice(voiceURI);
    setSelectedURI(voiceURI);
  };

  const togglePreview = () => {
    if (previewing) {
      voiceSpeech.stop();
      return;
    }
    if (effectiveURI) voiceSpeech.preview(effectiveURI);
  };

  return (
    <section
      aria-labelledby="orin-voice-heading"
      data-testid="orin-voice-section"
      className="space-y-3 border-t border-[var(--border-default)] pt-5"
    >
      <h3 id="orin-voice-heading" className="flex items-center gap-2 text-sm font-bold">
        <Volume2 className="h-4 w-4 text-[var(--accent-primary)]" aria-hidden="true" />
        {ja ? 'オリンの声' : "Orin's voice"}
      </h3>
      <p className="origin-muted text-[12.5px] leading-5">
        {ja
          ? '回答を読み上げるときの、オリンの声を選べます。声はこの端末に用意されているものを使います。'
          : "Choose Orin's voice for reading answers aloud. The voices come from this device."}
      </p>
      {voices.length === 0 ? (
        <p className="origin-muted text-[12.5px] leading-5" role="status">
          {ja
            ? 'この端末では、日本語の声がまだ見つかりませんでした。'
            : 'No Japanese voice was found on this device yet.'}
        </p>
      ) : (
        <>
          <div role="radiogroup" aria-labelledby="orin-voice-heading" className="grid gap-2">
            {voices.map((voice) => {
              const selected = voice.voiceURI === effectiveURI;
              return (
                <button
                  type="button"
                  key={voice.voiceURI}
                  role="radio"
                  aria-checked={selected}
                  data-testid={`orin-voice-option-${voice.voiceURI}`}
                  onClick={() => selectVoice(voice.voiceURI)}
                  style={{ minHeight: 48 }}
                  className={cn(
                    'flex min-h-12 items-center gap-2 rounded-xl border px-3 text-left text-sm font-semibold transition',
                    selected ? 'origin-primary-button border-transparent' : 'origin-secondary-button',
                  )}
                >
                  {selected && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
                  <span className="min-w-0">
                    <span className="block truncate">{voice.name}</span>
                    <span className={cn('block text-[12.5px] font-medium', selected ? '' : 'origin-muted')}>
                      {[
                        voice.gender === 'female' ? (ja ? '女性の声' : 'Female voice') : voice.gender === 'male' ? (ja ? '男性の声' : 'Male voice') : '',
                        voice.localService ? (ja ? 'この端末の声' : 'On-device voice') : '',
                      ].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            data-testid="orin-voice-preview-button"
            onClick={togglePreview}
            className="origin-secondary-button inline-flex min-h-12 items-center gap-1.5 rounded-xl border px-3 text-sm font-semibold"
          >
            {previewing
              ? <Square className="h-4 w-4" aria-hidden="true" />
              : <Play className="h-4 w-4" aria-hidden="true" />}
            {previewing ? (ja ? '停止' : 'Stop') : (ja ? '試しに聞く' : 'Preview')}
          </button>
        </>
      )}
    </section>
  );
}
