import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OriginLanguage } from '../i18n';
import {
  KEN_BURNS_DURATION_MS,
  computeKenBurnsOutputSize,
  detectWebmRecordingSupport,
  drawKenBurnsFrame,
  kenBurnsFrameAt,
  pickKenBurnsVariant,
  webmDownloadName,
  type KenBurnsDrawable,
  type KenBurnsVariant,
} from './kenBurnsMotionV17';

/**
 * On-device "video-lite" viewer for a generated image.
 *
 * Applies a slow Ken Burns pan/zoom to a still image and can record the
 * animation as a WebM file. Everything happens locally in the browser:
 * the image never leaves the device, no API is called, and the existing
 * image generation pipeline is untouched. When WebM recording is not
 * supported, only the animation is offered.
 */

type KenBurnsVideoDialogProps = {
  imageUrl: string;
  downloadName: string;
  language: OriginLanguage;
  onClose: () => void;
};

const LABELS = {
  ja: {
    title: '動画化（簡易）',
    play: '再生',
    pause: '一時停止',
    close: '閉じる',
    save: '動画を保存',
    recording: '録画中…',
    loading: '画像を読み込んでいます…',
    loadError: 'この画像は動画化できませんでした',
    note: '端末内だけで処理します（外部送信なし・約6秒）',
  },
  en: {
    title: 'Animate image',
    play: 'Play',
    pause: 'Pause',
    close: 'Close',
    save: 'Save video',
    recording: 'Recording…',
    loading: 'Loading image…',
    loadError: 'This image could not be animated',
    note: 'Processed on this device only (nothing is uploaded, about 6 seconds)',
  },
} as const;

type LoadStatus = 'loading' | 'ready' | 'error';

export default function KenBurnsVideoDialog({
  imageUrl,
  downloadName,
  language,
  onClose,
}: KenBurnsVideoDialogProps) {
  const t = LABELS[language];
  const support = useMemo(() => detectWebmRecordingSupport(), []);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordUnavailable, setRecordUnavailable] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawableRef = useRef<KenBurnsDrawable | null>(null);
  const variantRef = useRef<KenBurnsVariant>(pickKenBurnsVariant(downloadName || imageUrl));
  const progressRef = useRef(0);
  const playingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const downloadUrlRef = useRef<string | null>(null);
  const disposedRef = useRef(false);

  const drawCurrent = useCallback(() => {
    const canvas = canvasRef.current;
    const drawable = drawableRef.current;
    if (!canvas || !drawable) return;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext('2d');
    } catch {
      ctx = null;
    }
    if (!ctx) return;
    drawKenBurnsFrame(ctx, drawable, canvas.width, canvas.height, kenBurnsFrameAt(variantRef.current, progressRef.current));
  }, []);

  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    lastTickRef.current = null;
  }, []);

  const startLoop = useCallback(() => {
    if (rafRef.current !== null || disposedRef.current) return;
    lastTickRef.current = null;
    const tick = (now: number) => {
      rafRef.current = requestAnimationFrame(tick);
      if (lastTickRef.current === null) {
        lastTickRef.current = now;
        return;
      }
      const elapsed = now - lastTickRef.current;
      lastTickRef.current = now;
      if (playingRef.current) {
        progressRef.current = (progressRef.current + elapsed / KEN_BURNS_DURATION_MS) % 1;
      }
      drawCurrent();
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [drawCurrent]);

  // Keep the loop running only while playing; a paused dialog draws once.
  useEffect(() => {
    playingRef.current = playing;
    if (playing) {
      startLoop();
    } else {
      stopLoop();
      drawCurrent();
    }
  }, [playing, startLoop, stopLoop, drawCurrent]);

  // Load the image and size the canvas from its natural dimensions.
  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      const size = computeKenBurnsOutputSize(image.naturalWidth, image.naturalHeight);
      const canvas = canvasRef.current;
      if (!size || !canvas) {
        setStatus('error');
        return;
      }
      canvas.width = size.width;
      canvas.height = size.height;
      drawableRef.current = { source: image, width: image.naturalWidth, height: image.naturalHeight };
      progressRef.current = 0;
      setStatus('ready');
      const prefersReducedMotion = typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      setPlaying(!prefersReducedMotion);
      drawCurrent();
    };
    image.onerror = () => {
      if (!cancelled) setStatus('error');
    };
    image.src = imageUrl;
    return () => {
      cancelled = true;
      image.src = '';
    };
  }, [imageUrl, drawCurrent]);

  // Pause when the tab/page is hidden so the animation never runs unseen.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) setPlaying(false);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  // Escape closes the dialog.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // Full cleanup on unmount: stop the loop, discard any in-flight recording.
  useEffect(() => () => {
    disposedRef.current = true;
    stopLoop();
    if (recordTimeoutRef.current !== null) {
      clearTimeout(recordTimeoutRef.current);
      recordTimeoutRef.current = null;
    }
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        // Already stopped; nothing to discard.
      }
    }
    if (downloadUrlRef.current) {
      URL.revokeObjectURL(downloadUrlRef.current);
      downloadUrlRef.current = null;
    }
  }, [stopLoop]);

  const downloadRecordedVideo = useCallback((blob: Blob) => {
    try {
      const url = URL.createObjectURL(blob);
      downloadUrlRef.current = url;
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = webmDownloadName(downloadName);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => {
        if (downloadUrlRef.current === url) {
          URL.revokeObjectURL(url);
          downloadUrlRef.current = null;
        }
      }, 5_000);
    } catch {
      // A failed download must never surface as a crash; the animation stays usable.
    }
  }, [downloadName]);

  const startRecording = useCallback(() => {
    if (!support.canRecord || recording || status !== 'ready') return;
    const canvas = canvasRef.current;
    if (!canvas || typeof canvas.captureStream !== 'function') {
      setRecordUnavailable(true);
      return;
    }
    try {
      const stream = canvas.captureStream(30);
      const recorder = new MediaRecorder(stream, {
        ...(support.mimeType ? { mimeType: support.mimeType } : {}),
        videoBitsPerSecond: 5_000_000,
      });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => {
        recorderRef.current = null;
        setRecording(false);
        if (disposedRef.current || chunks.length === 0) return;
        downloadRecordedVideo(new Blob(chunks, { type: support.mimeType ?? 'video/webm' }));
      };
      recorderRef.current = recorder;
      // Restart the motion from the beginning so the clip covers one full cycle.
      progressRef.current = 0;
      setPlaying(true);
      recorder.start(250);
      setRecording(true);
      recordTimeoutRef.current = setTimeout(() => {
        recordTimeoutRef.current = null;
        const active = recorderRef.current;
        if (active && active.state !== 'inactive') {
          try {
            active.stop();
          } catch {
            setRecording(false);
          }
        }
      }, KEN_BURNS_DURATION_MS);
    } catch {
      recorderRef.current = null;
      setRecording(false);
      setRecordUnavailable(true);
    }
  }, [support, recording, status, downloadRecordedVideo]);

  const canSave = support.canRecord && !recordUnavailable;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
      role="presentation"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t.title}
        className="w-full max-w-3xl rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold">▶ {t.title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.close}
            className="origin-secondary-button inline-flex min-h-11 min-w-11 items-center justify-center rounded-[10px] px-3 text-sm font-semibold"
          >
            ✕
          </button>
        </div>

        {status === 'error' ? (
          <div role="alert" className="origin-surface-muted mt-3 flex min-h-52 items-center justify-center rounded-xl px-4 text-center text-sm">
            {t.loadError}
          </div>
        ) : (
          <>
            <div className="mt-3 flex items-center justify-center overflow-hidden rounded-xl bg-black">
              <canvas
                ref={canvasRef}
                data-testid="ken-burns-canvas"
                aria-label={t.title}
                className="mx-auto block h-auto max-h-[70vh] w-auto max-w-full"
              />
            </div>
            {status === 'loading' && (
              <p role="status" className="origin-muted mt-2 text-[12px]">{t.loading}</p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={status !== 'ready' || recording}
                onClick={() => setPlaying((value) => !value)}
                className="origin-secondary-button inline-flex min-h-11 items-center rounded-[10px] px-3 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-50"
              >
                {playing ? `⏸ ${t.pause}` : `▶ ${t.play}`}
              </button>
              {canSave && (
                <button
                  type="button"
                  disabled={status !== 'ready' || recording}
                  onClick={startRecording}
                  className="origin-secondary-button inline-flex min-h-11 items-center rounded-[10px] px-3 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {recording ? t.recording : `⬇ ${t.save}`}
                </button>
              )}
              <span className="origin-muted text-[12px]">{t.note}</span>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
