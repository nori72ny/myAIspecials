import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Send, User, Sparkles, Activity, CheckCircle2, Zap, AlertTriangle, RefreshCw, Settings } from 'lucide-react';
import { cn } from '../../utils';
import ReactMarkdown from 'react-markdown';
import { useAppState } from '../../hooks/useAppState';

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

type AiCoreState = 'UNKNOWN' | 'CONNECTING' | 'HEALTHY' | 'DEGRADED' | 'OFFLINE' | 'RATE_LIMITED' | 'PROVIDER_UNAVAILABLE' | 'NOT_CONFIGURED';

function verificationLabel(status: RoutingMetadata['verificationStatus'], isEn: boolean): string {
  if (status === 'not-required') return isEn ? 'Verification not required' : '検証不要';
  if (status === 'passed') return isEn ? 'Verified' : '検証済み';
  if (status === 'failed') return isEn ? 'Verification failed' : '検証失敗';
  if (status === 'pending') return isEn ? 'Verification pending' : '検証待ち';
  return isEn ? 'Not independently verified' : '独立検証なし';
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

      if (!response.ok) {
        throw data;
      }

      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'ai',
        content: data.content,
        routing: data.routing,
      };
      setMessages((previous) => [...previous, aiMsg]);
      dispatchAiCoreState('HEALTHY');
    } catch (caughtError: unknown) {
      const error = (caughtError && typeof caughtError === 'object'
        ? caughtError
        : {}) as ChatApiError;

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

      const errMsg: Message = {
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
      setMessages((previous) => [...previous, errMsg]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleSend = async (overrideInput?: string) => {
    if (isTyping) return;
    const textToSend = overrideInput || input;
    if (!textToSend.trim()) return;

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: textToSend };
    const updatedMessages = [...messages, userMsg];
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
    <div className="flex flex-col h-full bg-slate-50/50 dark:bg-black">
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-6 max-w-4xl mx-auto w-full pb-32"
      >
        <AnimatePresence initial={false}>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                'flex gap-4 w-full',
                msg.role === 'user' ? 'flex-row-reverse' : 'flex-row',
              )}
            >
              <div className={cn(
                'w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1',
                msg.role === 'user'
                  ? 'bg-slate-200 dark:bg-neutral-800'
                  : msg.error ? 'bg-red-100 dark:bg-red-500/20' : 'bg-black dark:bg-white',
              )}>
                {msg.role === 'user' ? (
                  <User className="w-4 h-4 text-slate-600 dark:text-neutral-300" />
                ) : msg.error ? (
                  <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400" />
                ) : (
                  <Sparkles className="w-4 h-4 text-white dark:text-black" />
                )}
              </div>

              <div className="flex flex-col gap-2 max-w-[80%]">
                {msg.error ? (
                  <div role="alert" className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 p-4 rounded-2xl rounded-tl-none shadow-sm flex flex-col gap-3">
                    <h4 className="text-sm font-bold text-red-800 dark:text-red-300">{msg.content}</h4>
                    <p className="text-sm text-red-700 dark:text-red-400 whitespace-pre-wrap">{msg.error.description}</p>

                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      {msg.error.retryable && (
                        <button
                          onClick={handleRetry}
                          disabled={isTyping}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-red-100 dark:bg-red-500/20 hover:bg-red-200 dark:hover:bg-red-500/30 text-red-700 dark:text-red-300 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          {isEn ? 'Retry' : '再試行'}
                        </button>
                      )}
                      {msg.error.showSettings && (
                        <button
                          onClick={() => window.dispatchEvent(new CustomEvent('openSettings'))}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-neutral-800 hover:bg-slate-50 dark:hover:bg-neutral-700 text-slate-700 dark:text-neutral-300 border border-slate-200 dark:border-neutral-700 text-xs font-medium rounded-lg transition-colors"
                        >
                          <Settings className="w-3.5 h-3.5" />
                          {isEn ? 'Check connection settings' : '接続設定を確認'}
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-4 text-[10px] text-red-500/70 font-mono mt-1 border-t border-red-200/50 dark:border-red-500/20 pt-2">
                      <span>Error Code: {msg.error.code}</span>
                      <span>Trace: {msg.error.requestId}</span>
                    </div>
                  </div>
                ) : (
                  <div className={cn(
                    'p-4 rounded-2xl text-sm leading-relaxed',
                    msg.role === 'user'
                      ? 'bg-indigo-600 text-white rounded-tr-none'
                      : 'bg-white dark:bg-neutral-900 border border-slate-200 dark:border-white/10 rounded-tl-none shadow-sm',
                  )}>
                    <div className={cn(
                      'markdown-body',
                      msg.role === 'user' && 'text-white prose-p:text-white prose-strong:text-white',
                    )}>
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  </div>
                )}

                {msg.routing && (
                  <div className="flex flex-wrap items-center gap-2 px-1 text-[10px] font-mono text-slate-500 dark:text-neutral-400">
                    <div className="flex items-center gap-1">
                      <Zap className="w-3 h-3 text-amber-500" />
                      <span>{msg.routing.model}</span>
                    </div>
                    <span aria-hidden="true">·</span>
                    <div className="flex items-center gap-1" title={msg.routing.verificationReason}>
                      <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                      <span>{verificationLabel(msg.routing.verificationStatus, isEn)}</span>
                    </div>
                    <span aria-hidden="true">·</span>
                    <span>{msg.routing.timeMs}ms</span>
                    <span aria-hidden="true">·</span>
                    <span>{msg.routing.freeOnly && (msg.routing.actualCostUsd ?? msg.routing.cost ?? 0) === 0
                      ? (isEn ? 'Free' : '無料')
                      : `$${(msg.routing.actualCostUsd ?? msg.routing.cost ?? 0).toFixed(4)}`}</span>
                    <span aria-hidden="true">·</span>
                    <span className="truncate max-w-[220px]" title={msg.routing.reason}>
                      {msg.routing.reason}
                    </span>
                  </div>
                )}
              </div>
            </motion.div>
          ))}
          {isTyping && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex gap-4"
            >
              <div className="w-8 h-8 rounded-full bg-black dark:bg-white flex items-center justify-center shrink-0 mt-1">
                <Activity className="w-4 h-4 text-white dark:text-black animate-pulse" />
              </div>
              <div className="bg-white dark:bg-neutral-900 border border-slate-200 dark:border-white/10 rounded-2xl rounded-tl-none px-4 py-3 shadow-sm flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" />
                <span className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-bounce delay-75" />
                <span className="w-1.5 h-1.5 bg-pink-500 rounded-full animate-bounce delay-150" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="absolute bottom-0 w-full bg-gradient-to-t from-slate-50 via-slate-50 to-transparent dark:from-black dark:via-black p-4 pb-6 pt-10">
        <div className="max-w-3xl mx-auto relative group">
          <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-2xl blur opacity-20 group-hover:opacity-40 transition duration-500" />
          <div className="relative flex items-end gap-2 bg-white dark:bg-neutral-900 border border-slate-200 dark:border-white/10 p-2 rounded-2xl shadow-sm focus-within:ring-2 focus-within:ring-indigo-500/50">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={isEn ? 'Message ORIGIN...' : 'ORIGINにメッセージを入力...'}
              aria-label={isEn ? 'Message ORIGIN' : 'ORIGINへのメッセージ'}
              className="flex-1 max-h-32 min-h-[44px] bg-transparent border-none resize-none p-3 focus:outline-none text-sm leading-relaxed"
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
              className="p-3 mb-0.5 mr-0.5 bg-black dark:bg-white text-white dark:text-black rounded-xl hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100 transition-all shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
