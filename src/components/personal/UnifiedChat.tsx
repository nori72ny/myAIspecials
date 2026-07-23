import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  RefreshCw,
  Send,
  Settings,
  Sparkles,
  User,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useAppState } from '../../hooks/useAppState';
import {
  createOriginAnswerEnvelope,
  type OriginAnswerEnvelope,
  type OriginAnswerEvidenceItem,
  type OriginAnswerRichOutput,
} from '../../lib/orchestration/OriginAnswerEnvelope';
import { cn } from '../../utils';

type RoutingMetadata = {
  model: string;
  reason: string;
  score?: number | null;
  timeMs: number;
  cost?: number | null;
  providerId?: string;
  modelId?: string;
  taskType?: string;
  actualCostUsd?: number;
  estimatedCostUsd?: number;
  freeOnly?: boolean;
  traceId?: string;
  verificationStatus?: 'not-run' | 'not-required' | 'passed' | 'failed' | 'pending';
  verificationReason?: string;
};

type Message = {
  id: string;
  role: 'user' | 'ai';
  content: string;
  answer?: OriginAnswerEnvelope;
  routing?: RoutingMetadata;
  error?: {
    code: string;
    messageKey: string;
    retryable: boolean;
    requestId: string;
    description: string;
    showSettings: boolean;
  };
};

function parseOriginAnswerEnvelope(value: unknown): OriginAnswerEnvelope | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<OriginAnswerEnvelope>;
  if (
    candidate.schemaVersion !== 'origin.answer.v1'
    || (candidate.language !== 'ja' && candidate.language !== 'en')
    || typeof candidate.conclusion !== 'string'
    || typeof candidate.answer !== 'string'
    || !Array.isArray(candidate.evidence)
    || !Array.isArray(candidate.limitations)
    || !Array.isArray(candidate.nextActions)
    || !Array.isArray(candidate.richOutputs)
    || !candidate.verification
    || typeof candidate.verification !== 'object'
  ) return undefined;

  const evidenceIsValid = candidate.evidence.every((item) => {
    if (!item || typeof item !== 'object') return false;
    const evidence = item as Partial<OriginAnswerEvidenceItem>;
    const checks = evidence.checks;
    const baseIsValid = typeof evidence.label === 'string'
      && (evidence.sourceUrl === undefined || typeof evidence.sourceUrl === 'string')
      && (evidence.claim === undefined || typeof evidence.claim === 'string')
      && (evidence.claimBinding === undefined || evidence.claimBinding === 'explicit-inline-citation')
      && (evidence.evidenceLevel === 'provided' || evidence.evidenceLevel === 'source-checked');
    if (!baseIsValid) return false;

    if (evidence.evidenceLevel === 'provided' && checks === undefined) return true;
    if (
      !checks
      || checks.safeUrl !== 'passed'
      || (checks.freshness !== 'not-run'
        && checks.freshness !== 'passed'
        && checks.freshness !== 'not-applicable')
    ) return false;

    return evidence.evidenceLevel === 'provided'
      ? checks.content === 'not-run'
        && checks.freshness === 'not-run'
        && checks.claimSupport === 'not-run'
      : checks.content === 'passed'
        && checks.freshness !== 'not-run'
        && checks.claimSupport === 'passed';
  });
  const richOutputsAreValid = candidate.richOutputs.every((output): output is OriginAnswerRichOutput =>
    Boolean(output)
    && typeof output === 'object'
    && ['comparison', 'chart', 'illustration', 'document', 'presentation', 'spreadsheet']
      .includes((output as OriginAnswerRichOutput).kind)
    && typeof (output as OriginAnswerRichOutput).label === 'string'
    && typeof (output as OriginAnswerRichOutput).artifactId === 'string');
  const verification = candidate.verification;
  const verificationIsValid = ['not-run', 'not-required', 'passed'].includes(verification.status)
    && typeof verification.independentReviewPerformed === 'boolean'
    && typeof verification.summary === 'string';
  if (
    !evidenceIsValid
    || !richOutputsAreValid
    || !candidate.limitations.every((item) => typeof item === 'string')
    || !candidate.nextActions.every((item) => typeof item === 'string')
    || !verificationIsValid
  ) return undefined;

  const parsed = createOriginAnswerEnvelope({
    language: candidate.language,
    conclusion: candidate.conclusion,
    answer: candidate.answer,
    evidence: candidate.evidence,
    verification,
    limitations: candidate.limitations,
    nextActions: candidate.nextActions,
    richOutputs: candidate.richOutputs,
  });
  return parsed.ok ? parsed.value : undefined;
}

function shouldShowSeparateConclusion(answer: OriginAnswerEnvelope): boolean {
  const conclusion = answer.conclusion.trim();
  const body = answer.answer.trim();
  return conclusion !== body && !body.startsWith(conclusion);
}

type ChatApiError = {
  code?: string;
  messageKey?: string;
  message?: string;
  retryable?: boolean;
  requestId?: string;
};

type AiCoreState =
  | 'UNKNOWN'
  | 'CONNECTING'
  | 'HEALTHY'
  | 'DEGRADED'
  | 'OFFLINE'
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'NOT_CONFIGURED';

type ChatSettings = {
  language: 'ja' | 'en';
  timeoutSeconds?: number;
  location?: string;
};

type UnifiedChatProps = {
  initialPrompt?: string;
  settingsOverride?: ChatSettings;
  onOpenSettings?: () => void;
};

function verificationLabel(status: RoutingMetadata['verificationStatus'], isEn: boolean): string {
  if (status === 'not-required') return isEn ? 'No additional check needed' : '追加確認は不要';
  if (status === 'passed') return isEn ? 'Checked by another AI' : '別のAIで確認済み';
  if (status === 'failed') return isEn ? 'A problem was found during checking' : '確認で問題を検出';
  if (status === 'pending') return isEn ? 'Checking in progress' : '確認中';
  return isEn ? 'Not checked by another AI this time' : '今回は別のAIで確認していません';
}

function executionCostLabel(routing: RoutingMetadata, isEn: boolean): string {
  const actualCost = routing.actualCostUsd ?? routing.cost;
  if (routing.freeOnly && actualCost === 0) return isEn ? 'Free' : '無料';
  if (typeof actualCost === 'number' && Number.isFinite(actualCost)) return `${actualCost.toFixed(4)}`;
  return isEn ? 'Not confirmed' : '未確認';
}

function executionTimeLabel(timeMs: number, isEn: boolean): string {
  if (!Number.isFinite(timeMs) || timeMs < 0) return isEn ? 'Not confirmed' : '未確認';
  if (timeMs < 1_000) return isEn ? 'Less than 1 second' : '1秒未満';

  const seconds = timeMs / 1_000;
  const formatted = Number.isInteger(seconds) ? seconds.toFixed(0) : seconds.toFixed(1);
  return isEn ? `${formatted} seconds` : `${formatted}秒`;
}

function evidenceCheckLabel(item: OriginAnswerEvidenceItem, isEn: boolean): string {
  if (item.evidenceLevel === 'provided') {
    return isEn
      ? 'Checked: basic HTTPS link format only. Destination, content, date, and answer support are not checked.'
      : '確認済み：HTTPSリンクの基本形式のみ。接続先・本文・更新時点・回答との一致は未確認です。';
  }

  if (item.checks.freshness === 'passed') {
    return isEn
      ? 'Checked: content, date, and answer support.'
      : '確認済み：本文・更新時点・回答との一致。';
  }

  return isEn
    ? 'Checked: content and answer support. Date check was not applicable.'
    : '確認済み：本文・回答との一致。更新時点の確認は対象外です。';
}

function sourceCoverageLabel(answer: OriginAnswerEnvelope, isEn: boolean): string {
  if (answer.evidence.length === 0) {
    return isEn ? 'No sources included' : '回答内の出典なし';
  }

  const checkedCount = answer.evidence.filter(
    (item) => item.evidenceLevel === 'source-checked',
  ).length;
  if (checkedCount === answer.evidence.length) {
    return isEn ? 'All source content checked' : 'すべての出典内容を確認済み';
  }
  if (checkedCount > 0) {
    return isEn ? 'Checked and unchecked sources are mixed' : '確認済み・未確認の出典が混在';
  }
  return isEn ? 'Source content not checked' : '出典内容は未確認';
}

function independentReviewCoverageLabel(
  answer: OriginAnswerEnvelope,
  isEn: boolean,
): string {
  if (answer.verification.status === 'passed') {
    return isEn ? 'Completed' : '実施済み';
  }
  if (answer.verification.status === 'not-required') {
    return isEn ? 'Not required for this answer' : 'この回答では不要';
  }
  return isEn ? 'Not completed' : '未実施';
}

function verificationMatchesRouting(
  answer: OriginAnswerEnvelope,
  routing: RoutingMetadata | undefined,
): boolean {
  return routing?.verificationStatus === undefined
    || routing.verificationStatus === answer.verification.status;
}

export default function UnifiedChat({
  initialPrompt,
  settingsOverride,
  onOpenSettings,
}: UnifiedChatProps) {
  const fallbackState = useAppState();
  const settings = settingsOverride ?? (fallbackState.settings as ChatSettings);
  const isEn = settings.language === 'en';

  const defaultGreeting = isEn
    ? 'Hello. Describe what you want to do in your own words.'
    : 'こんにちは。やりたいことを、そのまま入力してください。';

  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'ai',
      content: defaultGreeting,
    },
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inFlightRef = useRef(false);
  const handledInitialPromptRef = useRef<string | null>(null);

  const dispatchAiCoreState = (state: AiCoreState) => {
    window.dispatchEvent(new CustomEvent('aiCoreStateChange', { detail: state }));
  };

  const openSettings = () => {
    if (onOpenSettings) {
      onOpenSettings();
      return;
    }
    window.dispatchEvent(new CustomEvent('openSettings'));
  };

  const processSend = async (messageList: Message[]) => {
    setIsTyping(true);
    dispatchAiCoreState('CONNECTING');

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: messageList.filter((message) => !message.error).map((message) => ({
            role: message.role,
            content: message.content,
          })),
          userLocation: settings.location,
          executionPolicy: {
            maxEstimatedCostUsd: 0,
            timeoutMs: Math.max(10, Math.min(120, settings.timeoutSeconds ?? 30)) * 1000,
          },
        }),
      });

      const data = await response.json();
      if (!response.ok) throw data;

      if (typeof data.content !== 'string' || data.content.trim().length === 0) {
        throw {
          code: 'PROVIDER_INVALID_RESPONSE',
          message: isEn
            ? 'The free AI returned an invalid response.'
            : '無料AIから正しい形式の回答を受け取れませんでした。',
          retryable: false,
          requestId: '',
        };
      }

      const parsedAnswer = parseOriginAnswerEnvelope(data.answer);
      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'ai',
        content: data.content,
        answer: parsedAnswer && verificationMatchesRouting(parsedAnswer, data.routing)
          ? parsedAnswer
          : undefined,
        routing: data.routing,
      };
      setMessages((previous) => [...previous, aiMessage]);
      dispatchAiCoreState('HEALTHY');
    } catch (caughtError: unknown) {
      const error = (caughtError && typeof caughtError === 'object' ? caughtError : {}) as ChatApiError;

      let aiCoreState: AiCoreState = 'OFFLINE';
      let title = isEn ? 'Could not connect to ORIGIN' : 'ORIGINに接続できませんでした';
      let description = error.message || (isEn
        ? 'The request failed. Please try again later.'
        : '処理に失敗しました。しばらくしてから再試行してください。');
      let showSettings = false;

      if (error.code === 'SENSITIVE_INPUT_BLOCKED') {
        aiCoreState = 'DEGRADED';
        title = isEn ? 'Sensitive information was not sent' : '秘密情報の送信を停止しました';
        description = error.message || (isEn
          ? 'Remove credentials or secret values and enter only the minimum necessary summary.'
          : '認証情報や秘密の値を削除し、必要な内容だけを要約して再入力してください。');
      } else if (error.code === 'LATEST_MESSAGE_TOO_LARGE') {
        aiCoreState = 'DEGRADED';
        title = isEn ? 'The request is too long' : '依頼内容が長すぎます';
        description = error.message || (isEn
          ? 'Divide the request into smaller parts or provide a shorter summary.'
          : '依頼を分けるか、必要な内容だけに要約して再入力してください。');
      } else if (error.code === 'PROVIDER_RATE_LIMITED') {
        aiCoreState = 'RATE_LIMITED';
        title = isEn ? 'Free AI usage limit reached' : '無料AIの利用上限に達しました';
      } else if (
        error.code === 'FREE_PROVIDER_NOT_CONFIGURED'
        || error.code === 'PROVIDER_NOT_CONFIGURED'
        || error.code === 'API_KEY_INVALID'
      ) {
        aiCoreState = 'NOT_CONFIGURED';
        title = isEn ? 'Free AI connection is not configured' : '無料AIの接続設定が必要です';
        showSettings = true;
      } else if (
        error.code === 'FREE_MODEL_EVIDENCE_STALE'
        || error.code === 'FREE_MODEL_CATALOG_INVALID'
      ) {
        aiCoreState = 'PROVIDER_UNAVAILABLE';
        title = isEn
          ? 'Free AI availability must be checked again'
          : '無料AIの利用可否を再確認する必要があります';
        description = error.message || (isEn
          ? 'External AI execution remains stopped until the free-model information is reviewed.'
          : '無料モデルの情報を確認して更新するまで、外部AIの実行を停止します。');
      } else if (error.code === 'PROVIDER_COST_UNVERIFIED') {
        aiCoreState = 'DEGRADED';
        title = isEn ? 'Free execution could not be confirmed' : '無料実行を確認できませんでした';
        description = error.message || (isEn
          ? 'The answer is hidden because the usage record did not prove a zero-dollar cost.'
          : '利用明細で0ドルを確認できなかったため、回答を表示しません。');
      } else if (error.code === 'PROVIDER_ROUTING_UNVERIFIED') {
        aiCoreState = 'DEGRADED';
        title = isEn ? 'The actual AI used could not be confirmed' : '実際に使われたAIを確認できませんでした';
        description = error.message || (isEn
          ? 'The answer is hidden because the model, provider, or fallback state could not be confirmed.'
          : '使用されたモデル、提供元、または自動切替の有無を確認できなかったため、回答を表示しません。');
      } else if (
        error.code === 'PROVIDER_UNAVAILABLE'
        || error.code === 'MODEL_NOT_FOUND'
        || error.code === 'PROVIDER_INVALID_RESPONSE'
      ) {
        aiCoreState = 'PROVIDER_UNAVAILABLE';
        title = isEn ? 'Free AI is currently unavailable' : '無料AIを現在利用できません';
      } else if (error.code === 'PROVIDER_TIMEOUT') {
        aiCoreState = 'OFFLINE';
        title = isEn ? 'The response took too long' : '応答に時間がかかりすぎました';
      } else if (
        error.code === 'INVALID_EXECUTION_POLICY'
        || error.code === 'PROVIDER_POLICY_VIOLATION'
        || error.code === 'INVALID_ARGUMENT'
        || error.code === 'INVALID_CHAT_MESSAGES'
      ) {
        aiCoreState = 'DEGRADED';
        title = isEn ? 'The request did not meet the safety conditions' : '安全条件を満たさないため実行しませんでした';
      }

      dispatchAiCoreState(aiCoreState);

      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'ai',
        content: title,
        error: {
          code: error.code || 'ORIGIN_UNREACHABLE',
          messageKey: error.messageKey || 'errors.network',
          retryable: error.retryable !== false,
          requestId: error.requestId || 'UNKNOWN',
          description,
          showSettings,
        },
      };
      setMessages((previous) => [...previous, errorMessage]);
    } finally {
      inFlightRef.current = false;
      setIsTyping(false);
    }
  };

  const handleSend = async (overrideInput?: string) => {
    if (inFlightRef.current) return;
    const textToSend = (overrideInput ?? input).trim();
    if (!textToSend) return;

    inFlightRef.current = true;
    const userMessage: Message = { id: Date.now().toString(), role: 'user', content: textToSend };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput('');
    await processSend(updatedMessages);
  };

  const handleRetry = async () => {
    if (inFlightRef.current) return;

    const validMessages = [...messages];
    while (validMessages.length > 0 && validMessages[validMessages.length - 1].error) {
      validMessages.pop();
    }

    inFlightRef.current = true;
    setMessages(validMessages);
    await processSend(validMessages);
  };

  useEffect(() => {
    const prompt = initialPrompt?.trim();
    if (!prompt || handledInitialPromptRef.current === prompt) return;
    handledInitialPromptRef.current = prompt;
    void handleSend(prompt);
  }, [initialPrompt]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50/50 dark:bg-black">
      <div
        ref={scrollRef}
        className="mx-auto w-full max-w-4xl flex-1 space-y-6 overflow-y-auto p-3 pb-4 sm:p-4 sm:pb-6"
      >
        <AnimatePresence initial={false}>
          {messages.map((message) => (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                'flex w-full gap-3 sm:gap-4',
                message.role === 'user' ? 'flex-row-reverse' : 'flex-row',
              )}
            >
              <div className={cn(
                'mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                message.role === 'user'
                  ? 'bg-slate-200 dark:bg-neutral-800'
                  : message.error ? 'bg-red-100 dark:bg-red-500/20' : 'bg-black dark:bg-white',
              )}>
                {message.role === 'user' ? (
                  <User className="h-4 w-4 text-slate-600 dark:text-neutral-300" aria-hidden="true" />
                ) : message.error ? (
                  <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" aria-hidden="true" />
                ) : (
                  <Sparkles className="h-4 w-4 text-white dark:text-black" aria-hidden="true" />
                )}
              </div>

              <div className="flex max-w-[88%] flex-col gap-2 sm:max-w-[85%] md:max-w-[80%]">
                {message.error ? (
                  <div role="alert" className="flex flex-col gap-3 rounded-2xl rounded-tl-none border border-red-200 bg-red-50 p-4 shadow-sm dark:border-red-500/20 dark:bg-red-500/10">
                    <h4 className="text-sm font-bold text-red-800 dark:text-red-300">{message.content}</h4>
                    <p className="whitespace-pre-wrap text-sm text-red-700 dark:text-red-400">{message.error.description}</p>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {message.error.retryable && (
                        <button
                          type="button"
                          onClick={handleRetry}
                          disabled={isTyping}
                          className="flex min-h-10 items-center gap-1.5 rounded-lg bg-red-100 px-3 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-200 disabled:opacity-50 dark:bg-red-500/20 dark:text-red-300 dark:hover:bg-red-500/30"
                        >
                          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                          {isEn ? 'Retry' : '再試行'}
                        </button>
                      )}
                      {message.error.showSettings && (
                        <button
                          type="button"
                          onClick={openSettings}
                          className="flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
                        >
                          <Settings className="h-3.5 w-3.5" aria-hidden="true" />
                          {isEn ? 'Open settings' : '設定を開く'}
                        </button>
                      )}
                    </div>

                    <details
                      data-testid="error-details"
                      className="group mt-1 border-t border-red-200/50 pt-2 text-xs text-red-700 dark:border-red-500/20 dark:text-red-300"
                    >
                      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md py-1 font-medium outline-none focus-visible:ring-2 focus-visible:ring-red-400">
                        <span>{isEn ? 'Technical information' : '技術情報'}</span>
                        <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
                      </summary>
                      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-white/60 p-2 font-mono text-[10px] dark:bg-black/10">
                        <dt>{isEn ? 'Error code' : 'エラーコード'}</dt>
                        <dd className="break-all">{message.error.code}</dd>
                        <dt>{isEn ? 'Reference ID' : '問い合わせID'}</dt>
                        <dd className="break-all">{message.error.requestId}</dd>
                      </dl>
                    </details>
                  </div>
                ) : (
                  <div className={cn(
                    'rounded-2xl p-4 text-sm leading-relaxed',
                    message.role === 'user'
                      ? 'rounded-tr-none bg-indigo-600 text-white'
                      : 'rounded-tl-none border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-neutral-900',
                  )}>
                    <div className={cn(
                      'markdown-body',
                      message.role === 'user' && 'text-white prose-p:text-white prose-strong:text-white',
                    )}>
                      {message.answer && shouldShowSeparateConclusion(message.answer) && (
                        <section data-testid="answer-conclusion" className="mb-4 border-b border-slate-200 pb-3 dark:border-white/10">
                          <h3 className="mb-1 text-xs font-semibold text-slate-500 dark:text-neutral-400">
                            {isEn ? 'Conclusion' : '結論'}
                          </h3>
                          <ReactMarkdown>{message.answer.conclusion}</ReactMarkdown>
                        </section>
                      )}
                      <ReactMarkdown>{message.answer?.answer ?? message.content}</ReactMarkdown>
                    </div>

                    {message.answer && (
                      <div data-testid="structured-answer" className="mt-4 space-y-4 border-t border-slate-200 pt-4 dark:border-white/10">
                        <section
                          data-testid="answer-trust-overview"
                          aria-labelledby={`answer-trust-overview-${message.id}`}
                          className="rounded-xl bg-slate-50 p-3 dark:bg-white/5"
                        >
                          <h3
                            id={`answer-trust-overview-${message.id}`}
                            className="mb-2 text-xs font-semibold text-slate-600 dark:text-neutral-300"
                          >
                            {isEn ? 'What was checked' : 'この回答の確認範囲'}
                          </h3>
                          <dl className="grid gap-2 text-xs sm:grid-cols-2">
                            <div>
                              <dt className="text-slate-500 dark:text-neutral-500">
                                {isEn ? 'Sources' : '出典内容'}
                              </dt>
                              <dd className="mt-0.5 font-medium text-slate-800 dark:text-neutral-200">
                                {sourceCoverageLabel(message.answer, isEn)}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-slate-500 dark:text-neutral-500">
                                {isEn ? 'Independent AI review' : '別AIによる確認'}
                              </dt>
                              <dd className="mt-0.5 font-medium text-slate-800 dark:text-neutral-200">
                                {independentReviewCoverageLabel(message.answer, isEn)}
                              </dd>
                            </div>
                          </dl>
                        </section>

                        {message.answer.evidence.length > 0 && (
                          <section>
                            <h3 className="mb-2 text-xs font-semibold text-slate-500 dark:text-neutral-400">
                              {isEn ? 'Evidence and sources' : '根拠と出典'}
                            </h3>
                            <ul className="space-y-1 text-sm">
                              {message.answer.evidence.map((item, index) => (
                                <li key={`${item.label}-${index}`}>
                                  <div className="flex flex-wrap items-center gap-2">
                                    {item.sourceUrl ? (
                                      <a className="underline underline-offset-2" href={item.sourceUrl} target="_blank" rel="noreferrer">
                                        {item.label}
                                      </a>
                                    ) : item.label}
                                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600 dark:bg-white/10 dark:text-neutral-300">
                                      {item.evidenceLevel === 'source-checked'
                                        ? (isEn ? 'Source checked' : '出典確認済み')
                                        : (isEn ? 'AI-provided · not checked' : 'AIが提示・未確認')}
                                    </span>
                                  </div>
                                  <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">
                                    {evidenceCheckLabel(item, isEn)}
                                  </p>
                                  {item.claim && (
                                    <p className="mt-1 text-xs text-slate-600 dark:text-neutral-300">
                                      <span className="font-medium">
                                        {item.evidenceLevel === 'source-checked'
                                          ? (isEn ? 'Checked statement: ' : '確認した主張：')
                                          : (isEn ? 'AI-linked statement: ' : 'AIが対応付けた主張：')}
                                      </span>
                                      {item.claim}
                                    </p>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </section>
                        )}

                        <section data-testid="answer-verification">
                          <h3 className="mb-1 text-xs font-semibold text-slate-500 dark:text-neutral-400">
                            {isEn ? 'Verification' : '確認状況'}
                          </h3>
                          <p className="text-sm text-slate-700 dark:text-neutral-300">
                            {message.answer.verification.summary}
                          </p>
                        </section>

                        {message.answer.limitations.length > 0 && (
                          <section>
                            <h3 className="mb-2 text-xs font-semibold text-slate-500 dark:text-neutral-400">
                              {isEn ? 'Limitations' : '制約・未確認事項'}
                            </h3>
                            <ul className="list-disc space-y-1 pl-5 text-sm">
                              {message.answer.limitations.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
                            </ul>
                          </section>
                        )}

                        {message.answer.nextActions.length > 0 && (
                          <section>
                            <h3 className="mb-2 text-xs font-semibold text-slate-500 dark:text-neutral-400">
                              {isEn ? 'Next actions' : '次にできること'}
                            </h3>
                            <ul className="list-disc space-y-1 pl-5 text-sm">
                              {message.answer.nextActions.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
                            </ul>
                          </section>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {message.routing && (
                  <details
                    data-testid="execution-details"
                    className="group rounded-xl border border-slate-200 bg-white/70 text-xs text-slate-600 dark:border-white/10 dark:bg-neutral-900/70 dark:text-neutral-300"
                  >
                    <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-3 py-2.5 font-medium outline-none transition hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-slate-400 dark:hover:bg-white/5">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                      <span className="text-slate-800 dark:text-neutral-200">
                        {message.routing.freeOnly && executionCostLabel(message.routing, isEn) === (isEn ? 'Free' : '無料')
                          ? (isEn ? 'Answered for free' : '無料で回答しました')
                          : (isEn ? 'Answer completed' : '回答しました')}
                      </span>
                      <span className="ml-auto text-slate-500 dark:text-neutral-500">
                        {isEn ? 'Details' : '詳細'}
                      </span>
                      <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
                    </summary>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-t border-slate-200 px-3 py-3 dark:border-white/10">
                      <dt className="text-slate-500 dark:text-neutral-500">{isEn ? 'AI used' : '使用したAI'}</dt>
                      <dd className="min-w-0 break-words text-slate-800 dark:text-neutral-200">{message.routing.model}</dd>

                      <dt className="text-slate-500 dark:text-neutral-500">{isEn ? 'Cost' : '費用'}</dt>
                      <dd className="text-slate-800 dark:text-neutral-200">{executionCostLabel(message.routing, isEn)}</dd>

                      <dt className="text-slate-500 dark:text-neutral-500">
                        {isEn ? 'Check by another AI' : '別のAIによる確認'}
                      </dt>
                      <dd className="text-slate-800 dark:text-neutral-200">
                        {verificationLabel(message.routing.verificationStatus, isEn)}
                      </dd>

                      <dt className="text-slate-500 dark:text-neutral-500">{isEn ? 'Time' : '処理時間'}</dt>
                      <dd className="text-slate-800 dark:text-neutral-200">{executionTimeLabel(message.routing.timeMs, isEn)}</dd>

                      <dt className="text-slate-500 dark:text-neutral-500">
                        {isEn ? 'Why this AI was selected' : 'このAIを選んだ理由'}
                      </dt>
                      <dd className="min-w-0 break-words text-slate-800 dark:text-neutral-200">{message.routing.reason}</dd>

                      {message.routing.verificationReason && (
                        <>
                          <dt className="text-slate-500 dark:text-neutral-500">
                            {isEn ? 'Check status note' : '確認状況の説明'}
                          </dt>
                          <dd className="min-w-0 break-words text-slate-800 dark:text-neutral-200">
                            {message.routing.verificationReason}
                          </dd>
                        </>
                      )}
                    </dl>
                  </details>
                )}
              </div>
            </motion.div>
          ))}

          {isTyping && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3 sm:gap-4">
              <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black dark:bg-white">
                <Activity className="h-4 w-4 animate-pulse text-white dark:text-black" aria-hidden="true" />
              </div>
              <div
                role="status"
                aria-live="polite"
                aria-label={isEn ? 'ORIGIN is working' : 'ORIGINが処理中'}
                className="flex items-center gap-2 rounded-2xl rounded-tl-none border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-white/10 dark:bg-neutral-900"
              >
                <span aria-hidden="true" className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-500" />
                <span aria-hidden="true" className="h-1.5 w-1.5 animate-bounce rounded-full bg-purple-500 delay-75" />
                <span aria-hidden="true" className="h-1.5 w-1.5 animate-bounce rounded-full bg-pink-500 delay-150" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="shrink-0 border-t border-slate-200 bg-white/95 px-3 pb-4 pt-3 backdrop-blur dark:border-white/10 dark:bg-black/95 sm:px-4 sm:pb-5">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-end gap-2 rounded-2xl border border-slate-300 bg-white p-2 shadow-sm transition focus-within:border-slate-500 focus-within:ring-2 focus-within:ring-slate-200 dark:border-white/15 dark:bg-neutral-900 dark:focus-within:border-white/30 dark:focus-within:ring-white/10">
            <textarea
              id="origin-chat-input"
              rows={1}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={isEn ? 'Describe what you want to do' : 'やりたいことを入力'}
              aria-label={isEn ? 'Request to ORIGIN' : 'ORIGINへの依頼'}
              aria-describedby="origin-chat-guidance"
              className="max-h-40 min-h-12 flex-1 resize-none border-none bg-transparent px-3 py-3 text-base leading-relaxed focus:outline-none sm:text-sm"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void handleSend();
                }
              }}
            />
            <button
              type="button"
              aria-label={isEn ? 'Send request' : '依頼を送信'}
              onClick={() => void handleSend()}
              disabled={!input.trim() || isTyping}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-black text-white transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-35 dark:bg-white dark:text-black"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div
            id="origin-chat-guidance"
            className="mt-2 flex flex-col gap-1 px-1 text-[11px] leading-4 text-slate-500 dark:text-neutral-500 sm:flex-row sm:items-center sm:justify-between"
          >
            <span>{isEn ? 'Enter to send / Shift+Enter for a new line' : 'Enterで送信 / Shift+Enterで改行'}</span>
            <span>{isEn ? 'Do not enter passwords or API keys.' : 'パスワードやAPIキーは入力しないでください。'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
