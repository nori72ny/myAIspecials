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

function verificationLabel(status: RoutingMetadata['verificationStatus'], isEn: boolean): string {
  if (status === 'not-required') return isEn ? 'Verification not required' : '検証不要';
  if (status === 'passed') return isEn ? 'Verified' : '検証済み';
  if (status === 'failed') return isEn ? 'Verification failed' : '検証失敗';
  if (status === 'pending') return isEn ? 'Verification pending' : '検証待ち';
  return isEn ? 'Not independently verified' : '独立検証なし';
}

function executionCostLabel(routing: RoutingMetadata, isEn: boolean): string {
  const actualCost = routing.actualCostUsd ?? routing.cost;
  if (routing.freeOnly && actualCost === 0) return isEn ? 'Free' : '無料';
  if (typeof actualCost === 'number') return `$${actualCost.toFixed(4)}`;
  return isEn ? 'Not confirmed' : '未確認';
}

export default function UnifiedChat({ initialPrompt }: { initialPrompt?: string }) {
  const { settings } = useAppState();
  const isEn = settings.language === 'en';

  const defaultGreeting = isEn
    ? 'Hello! I am ORIGIN Personal. What outcome would you like to achieve?'
    : 'こんにちは。ORIGIN Personalです。達成したいことを教えてください。';

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

  useEffect(() => {
    if (initialPrompt) {
      handleSend(initialPrompt);
    }
  }, [initialPrompt]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const dispatchAiCoreState = (state: AiCoreState) => {
    window.dispatchEvent(new CustomEvent('aiCoreStateChange', { detail: state }));
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
          userLocation: (settings as { location?: string }).location,
          executionPolicy: {
            maxEstimatedCostUsd: 0,
            timeoutMs: Math.max(10, Math.min(120, settings.timeoutSeconds ?? 30)) * 1000,
          },
        }),
      });

      const data = await response.json();
      if (!response.ok) throw data;

      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'ai',
        content: data.content,
        routing: data.routing,
      };
      setMessages((previous) => [...previous, aiMessage]);
      dispatchAiCoreState('HEALTHY');
    } catch (caughtError: unknown) {
      const error = (caughtError && typeof caughtError === 'object' ? caughtError : {}) as ChatApiError;

      let aiCoreState: AiCoreState = 'OFFLINE';
      let title = isEn ? 'Could not connect to ORIGIN' : 'ORIGINに接続できませんでした';
      let description = error.message || (isEn
        ? 'The AI processing request failed. Please try again later.'
        : 'AI処理に失敗しました。しばらくしてから再試行してください。');
      let showSettings = false;

      if (error.code === 'SENSITIVE_INPUT_BLOCKED') {
        aiCoreState = 'DEGRADED';
        title = isEn ? 'Sensitive information was not sent' : '秘密情報の送信を停止しました';
        description = error.message || (isEn
          ? 'Remove credentials or secret values and enter only the minimum necessary summary.'
          : '認証情報や秘密の値を削除し、必要な内容だけを要約して再入力してください。');
      } else if (error.code === 'LATEST_MESSAGE_TOO_LARGE') {
        aiCoreState = 'DEGRADED';
        title = isEn ? 'The latest request is too long' : '依頼内容が長すぎます';
        description = error.message || (isEn
          ? 'Divide the request into smaller parts or provide a shorter summary.'
          : '依頼を分割するか、必要な内容だけに要約して再入力してください。');
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
          ? 'Free-model availability must be re-verified'
          : '無料モデルの利用可能性を再確認する必要があります';
        description = error.message || (isEn
          ? 'Execution remains stopped until the evidence catalog is reviewed and updated.'
          : '証拠カタログを確認して更新するまで、外部AIの実行を停止します。');
      } else if (error.code === 'PROVIDER_COST_UNVERIFIED') {
        aiCoreState = 'DEGRADED';
        title = isEn ? 'Zero-cost execution could not be verified' : '無料実行を確認できませんでした';
        description = error.message || (isEn
          ? 'The answer was withheld because the usage record did not prove a zero-dollar cost.'
          : '利用明細で0ドルを確認できなかったため、回答を表示しません。');
      } else if (error.code === 'PROVIDER_ROUTING_UNVERIFIED') {
        aiCoreState = 'DEGRADED';
        title = isEn ? 'The actual execution route could not be verified' : '実際の実行先を確認できませんでした';
        description = error.message || (isEn
          ? 'The answer was withheld because the served model, provider, or fallback state could not be verified.'
          : '使用されたモデル、プロバイダー、またはフォールバック状態を確認できなかったため、回答を表示しません。');
      } else if (
        error.code === 'PROVIDER_UNAVAILABLE'
        || error.code === 'MODEL_NOT_FOUND'
        || error.code === 'PROVIDER_INVALID_RESPONSE'
      ) {
        aiCoreState = 'PROVIDER_UNAVAILABLE';
        title = isEn ? 'Free AI is currently unavailable' : '無料AIを現在利用できません';
      } else if (error.code === 'PROVIDER_TIMEOUT') {
        aiCoreState = 'OFFLINE';
        title = isEn ? 'Request timed out' : '応答がタイムアウトしました';
      } else if (
        error.code === 'INVALID_EXECUTION_POLICY'
        || error.code === 'PROVIDER_POLICY_VIOLATION'
        || error.code === 'INVALID_ARGUMENT'
        || error.code === 'INVALID_CHAT_MESSAGES'
      ) {
        aiCoreState = 'DEGRADED';
        title = isEn ? 'The request could not be executed safely' : '安全な条件で実行できませんでした';
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
      setIsTyping(false);
    }
  };

  const handleSend = async (overrideInput?: string) => {
    if (isTyping) return;
    const textToSend = overrideInput || input;
    if (!textToSend.trim()) return;

    const userMessage: Message = { id: Date.now().toString(), role: 'user', content: textToSend };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput('');
    await processSend(updatedMessages);
  };

  const handleRetry = async () => {
    if (isTyping) return;
    const validMessages = [...messages];
    while (validMessages.length > 0 && validMessages[validMessages.length - 1].error) {
      validMessages.pop();
    }
    setMessages(validMessages);
    await processSend(validMessages);
  };

  return (
    <div className="flex h-full flex-col bg-slate-50/50 dark:bg-black">
      <div
        ref={scrollRef}
        className="mx-auto w-full max-w-4xl flex-1 space-y-6 overflow-y-auto p-4 pb-32"
      >
        <AnimatePresence initial={false}>
          {messages.map((message) => (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                'flex w-full gap-4',
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

              <div className="flex max-w-[85%] flex-col gap-2 md:max-w-[80%]">
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
                          className="flex items-center gap-1.5 rounded-lg bg-red-100 px-3 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-200 disabled:opacity-50 dark:bg-red-500/20 dark:text-red-300 dark:hover:bg-red-500/30"
                        >
                          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                          {isEn ? 'Retry' : '再試行'}
                        </button>
                      )}
                      {message.error.showSettings && (
                        <button
                          type="button"
                          onClick={() => window.dispatchEvent(new CustomEvent('openSettings'))}
                          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
                        >
                          <Settings className="h-3.5 w-3.5" aria-hidden="true" />
                          {isEn ? 'Check connection settings' : '接続設定を確認'}
                        </button>
                      )}
                    </div>

                    <details
                      data-testid="error-details"
                      className="group mt-1 border-t border-red-200/50 pt-2 text-xs text-red-700 dark:border-red-500/20 dark:text-red-300"
                    >
                      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md py-1 font-medium outline-none focus-visible:ring-2 focus-visible:ring-red-400">
                        <span>{isEn ? 'View technical details' : '問題の詳細を見る'}</span>
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
                      <ReactMarkdown>{message.content}</ReactMarkdown>
                    </div>
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
                          ? (isEn ? 'Executed for free' : '無料で実行')
                          : (isEn ? 'Execution completed' : '実行完了')}
                      </span>
                      <span className="ml-auto text-slate-500 dark:text-neutral-500">
                        {isEn ? 'View execution details' : '実行情報を見る'}
                      </span>
                      <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
                    </summary>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-t border-slate-200 px-3 py-3 dark:border-white/10">
                      <dt className="text-slate-500 dark:text-neutral-500">{isEn ? 'AI used' : '使用したAI'}</dt>
                      <dd className="min-w-0 break-words text-slate-800 dark:text-neutral-200">{message.routing.model}</dd>

                      <dt className="text-slate-500 dark:text-neutral-500">{isEn ? 'Cost' : '費用'}</dt>
                      <dd className="text-slate-800 dark:text-neutral-200">{executionCostLabel(message.routing, isEn)}</dd>

                      <dt className="text-slate-500 dark:text-neutral-500">{isEn ? 'Independent verification' : '独立検証'}</dt>
                      <dd className="text-slate-800 dark:text-neutral-200">
                        {verificationLabel(message.routing.verificationStatus, isEn)}
                      </dd>

                      <dt className="text-slate-500 dark:text-neutral-500">{isEn ? 'Processing time' : '処理時間'}</dt>
                      <dd className="text-slate-800 dark:text-neutral-200">{message.routing.timeMs}ms</dd>

                      <dt className="text-slate-500 dark:text-neutral-500">{isEn ? 'Selection reason' : '選択理由'}</dt>
                      <dd className="min-w-0 break-words text-slate-800 dark:text-neutral-200">{message.routing.reason}</dd>

                      {message.routing.verificationReason && (
                        <>
                          <dt className="text-slate-500 dark:text-neutral-500">{isEn ? 'Verification note' : '検証の説明'}</dt>
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
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-4">
              <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black dark:bg-white">
                <Activity className="h-4 w-4 animate-pulse text-white dark:text-black" aria-hidden="true" />
              </div>
              <div
                role="status"
                aria-label={isEn ? 'ORIGIN is working' : 'ORIGINが処理中'}
                className="flex items-center gap-2 rounded-2xl rounded-tl-none border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-white/10 dark:bg-neutral-900"
              >
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-500" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-purple-500 delay-75" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-pink-500 delay-150" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="absolute bottom-0 w-full bg-gradient-to-t from-slate-50 via-slate-50 to-transparent p-4 pb-6 pt-10 dark:from-black dark:via-black">
        <div className="group relative mx-auto max-w-3xl">
          <div className="absolute -inset-1 rounded-2xl bg-gradient-to-r from-indigo-500 to-purple-500 opacity-20 blur transition duration-500 group-hover:opacity-40" />
          <div className="relative flex items-end gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm focus-within:ring-2 focus-within:ring-indigo-500/50 dark:border-white/10 dark:bg-neutral-900">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={isEn ? 'Message ORIGIN...' : 'ORIGINにメッセージを入力...'}
              aria-label={isEn ? 'Message ORIGIN' : 'ORIGINへのメッセージ'}
              className="max-h-32 min-h-[44px] flex-1 resize-none border-none bg-transparent p-3 text-sm leading-relaxed focus:outline-none"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  handleSend();
                }
              }}
            />
            <button
              type="button"
              aria-label={isEn ? 'Send message' : 'メッセージを送信'}
              onClick={() => handleSend()}
              disabled={!input.trim() || isTyping}
              className="mb-0.5 mr-0.5 shrink-0 rounded-xl bg-black p-3 text-white transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100 dark:bg-white dark:text-black"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
