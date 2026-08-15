import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  History,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  User,
  X,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
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
  kind?: 'conversation' | 'intro';
  answer?: OriginAnswerEnvelope;
  routing?: RoutingMetadata;
  error?: {
    code: string;
    messageKey: string;
    retryable: boolean;
    requestId: string;
    description: string;
    retryAfterSeconds?: number;
  };
};

const CHAT_HISTORY_STORAGE_KEY = 'origin_chat_sessions_v1';
const MAX_STORED_SESSIONS = 50;

type ChatSession = {
  id: string;
  title: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
};

function newSessionId(): string {
  return `origin-${Date.now()}-${window.crypto.randomUUID()}`;
}

function readChatSessions(): ChatSession[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CHAT_HISTORY_STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((session): session is ChatSession => Boolean(
        session
        && typeof session.id === 'string'
        && typeof session.title === 'string'
        && Array.isArray(session.messages)
        && typeof session.createdAt === 'string'
        && typeof session.updatedAt === 'string',
      ))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, MAX_STORED_SESSIONS);
  } catch {
    return [];
  }
}

function sessionTitle(messages: Message[], isEn: boolean): string {
  const firstRequest = messages.find((message) => message.role === 'user')?.content.trim();
  if (!firstRequest) return isEn ? 'New conversation' : '新しい依頼';
  return firstRequest.length > 42 ? `${firstRequest.slice(0, 42)}…` : firstRequest;
}

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

function shouldShowVerificationDetails(answer: OriginAnswerEnvelope): boolean {
  return answer.evidence.length > 0
    || answer.verification.status !== 'not-required'
    || answer.limitations.length > 0;
}

function shouldShowStructuredAnswer(answer: OriginAnswerEnvelope): boolean {
  return shouldShowVerificationDetails(answer)
    || answer.nextActions.length > 0
    || answer.richOutputs.length > 0;
}

type ChatApiError = {
  code?: string;
  messageKey?: string;
  message?: string;
  retryable?: boolean;
  requestId?: string;
  retryAfterSeconds?: number;
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
  return routing?.verificationStatus === answer.verification.status;
}

function answerCompletionAnnouncement(
  answer: OriginAnswerEnvelope | undefined,
  isEn: boolean,
): string {
  if (!answer) {
    return isEn ? 'ORIGIN’s answer is ready.' : 'ORIGINの回答が届きました。';
  }

  const sources = sourceCoverageLabel(answer, isEn);
  const review = independentReviewCoverageLabel(answer, isEn);
  return isEn
    ? `ORIGIN’s answer is ready. ${sources}. Independent AI review: ${review}.`
    : `ORIGINの回答が届きました。${sources}。別AIによる確認：${review}。`;
}

function processingStatus(seconds: number, isEn: boolean): string {
  if (seconds < 5) return isEn ? 'Understanding your request' : '依頼を確認中';
  if (seconds < 15) return isEn ? 'Checking the free AI connection' : '無料AIの接続を確認中';
  if (seconds < 30) return isEn ? 'Creating the answer' : '回答を作成中';
  return isEn ? 'Checking and finishing the answer' : '回答を確認・仕上げ中';
}

function markdownTableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function mobileFriendlyMarkdown(source: string): string {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const rendered: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const headerLine = lines[index];
    const separatorLine = lines[index + 1] ?? '';
    const headers = markdownTableCells(headerLine);
    const separators = markdownTableCells(separatorLine);
    const isTable = headerLine.includes('|')
      && separators.length === headers.length
      && separators.length > 1
      && separators.every((cell) => /^:?-{3,}:?$/.test(cell));

    if (!isTable) {
      rendered.push(headerLine);
      continue;
    }

    const rows: string[][] = [];
    index += 2;
    while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
      const cells = markdownTableCells(lines[index]);
      if (cells.length === headers.length) rows.push(cells);
      index += 1;
    }
    index -= 1;

    for (const row of rows) {
      const title = row[0] || headers[0];
      rendered.push(`- **${headers[0]}：${title}**`);
      for (let column = 1; column < headers.length; column += 1) {
        if (row[column]) rendered.push(`  - **${headers[column]}：** ${row[column]}`);
      }
    }
    rendered.push('');
  }

  return rendered.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function SafeMarkdown({
  children,
  isEn,
}: {
  children: string;
  isEn: boolean;
}) {
  return (
    <ReactMarkdown
      components={{
        h1: ({ children: heading }) => (
          <h2 className="mb-3 mt-7 text-xl font-semibold leading-snug text-origin-ink first:mt-0">{heading}</h2>
        ),
        h2: ({ children: heading }) => (
          <h2 className="mb-3 mt-7 text-lg font-semibold leading-snug text-origin-ink first:mt-0">{heading}</h2>
        ),
        h3: ({ children: heading }) => (
          <h3 className="mb-2 mt-5 text-base font-semibold leading-snug text-origin-ink">{heading}</h3>
        ),
        p: ({ children: paragraph }) => (
          <p className="mb-4 leading-7 last:mb-0">{paragraph}</p>
        ),
        ul: ({ children: items }) => (
          <ul className="mb-4 list-disc space-y-2 pl-5 marker:text-origin-brand">{items}</ul>
        ),
        ol: ({ children: items }) => (
          <ol className="mb-4 list-decimal space-y-2 pl-5 marker:font-semibold marker:text-origin-brand">{items}</ol>
        ),
        li: ({ children: item }) => <li className="pl-1 leading-7">{item}</li>,
        strong: ({ children: text }) => <strong className="font-semibold text-origin-ink">{text}</strong>,
        blockquote: ({ children: quote }) => (
          <blockquote className="my-4 border-l-2 border-origin-brand pl-4 text-origin-muted">{quote}</blockquote>
        ),
        a: ({ children: label, href }) => (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="font-medium text-origin-brand underline decoration-origin-brand/40 underline-offset-2"
          >
            {label}
          </a>
        ),
        img: ({ alt }) => (
          <span
            role="note"
            className="inline-flex rounded-md border border-origin-border bg-origin-surface-muted px-2 py-1 text-[13px] text-origin-muted dark:border-origin-border dark:bg-origin-surface-muted dark:text-origin-muted"
          >
            {isEn
              ? `External image not loaded automatically${alt ? `: ${alt}` : ''}`
              : `外部画像は自動表示しません${alt ? `：${alt}` : ''}`}
          </span>
        ),
      }}
    >
      {mobileFriendlyMarkdown(children)}
    </ReactMarkdown>
  );
}

export default function UnifiedChat({
  initialPrompt,
  settingsOverride,
}: UnifiedChatProps) {
  const settings: ChatSettings = settingsOverride ?? {
    language: 'ja',
    timeoutSeconds: 45,
  };
  const isEn = settings.language === 'en';

  const defaultGreeting = isEn
    ? 'Hello. Describe what you want to do in your own words.'
    : 'こんにちは。やりたいことを、そのまま入力してください。';

  const initialSessionsRef = useRef<ChatSession[]>(readChatSessions());
  const [sessions, setSessions] = useState<ChatSession[]>(initialSessionsRef.current);
  const [activeSessionId, setActiveSessionId] = useState<string>(() => (
    initialPrompt?.trim() ? newSessionId() : initialSessionsRef.current[0]?.id ?? newSessionId()
  ));
  const [messages, setMessages] = useState<Message[]>(() => {
    if (initialPrompt?.trim()) return [];
    return initialSessionsRef.current[0]?.messages ?? [{
      id: '1',
      role: 'ai',
      content: defaultGreeting,
      kind: 'intro',
    }];
  });
  const [showHistory, setShowHistory] = useState(false);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [processingSeconds, setProcessingSeconds] = useState(0);
  const [completionAnnouncement, setCompletionAnnouncement] = useState('');
  const [retrySecondsRemaining, setRetrySecondsRemaining] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inFlightRef = useRef(false);
  const handledInitialPromptRef = useRef<string | null>(null);

  const dispatchAiCoreState = (state: AiCoreState) => {
    window.dispatchEvent(new CustomEvent('aiCoreStateChange', { detail: state }));
  };

  const createNewConversation = () => {
    if (inFlightRef.current) return;
    const id = newSessionId();
    setActiveSessionId(id);
    setMessages([{
      id: `intro-${id}`,
      role: 'ai',
      content: defaultGreeting,
      kind: 'intro',
    }]);
    setInput('');
    setShowHistory(false);
  };

  const openSession = (session: ChatSession) => {
    if (inFlightRef.current) return;
    setActiveSessionId(session.id);
    setMessages(session.messages);
    setInput('');
    setShowHistory(false);
  };

  const deleteSession = (sessionId: string) => {
    if (inFlightRef.current) return;
    const confirmed = window.confirm(
      isEn ? 'Delete this conversation history?' : 'この履歴を削除しますか？',
    );
    if (!confirmed) return;

    const nextSessions = sessions.filter((session) => session.id !== sessionId);
    setSessions(nextSessions);
    window.localStorage.setItem(CHAT_HISTORY_STORAGE_KEY, JSON.stringify(nextSessions));

    if (sessionId === activeSessionId) {
      const next = nextSessions[0];
      if (next) {
        setActiveSessionId(next.id);
        setMessages(next.messages);
      } else {
        const id = newSessionId();
        setActiveSessionId(id);
        setMessages([{
          id: `intro-${id}`,
          role: 'ai',
          content: defaultGreeting,
          kind: 'intro',
        }]);
      }
    }
  };

  const processSend = async (messageList: Message[]) => {
    setIsTyping(true);
    setProcessingSeconds(0);
    setCompletionAnnouncement('');
    dispatchAiCoreState('CONNECTING');

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: messageList
            .filter((message) => !message.error && message.kind !== 'intro')
            .map((message) => ({
              role: message.role,
              content: message.content,
            })),
          userLocation: settings.location,
          executionPolicy: {
            maxEstimatedCostUsd: 0,
            // Keep the client aligned with the server-owned 90-second floor.
            // Existing devices may still have a legacy 45-50 second value.
            timeoutMs: Math.max(90, Math.min(120, settings.timeoutSeconds ?? 90)) * 1000,
          },
        }),
      });

      const contentType = response.headers?.get?.('content-type') ?? '';
      if (response.headers?.get && !contentType.toLowerCase().includes('application/json')) {
        throw {
          code: 'ORIGIN_API_NON_JSON',
          message: isEn
            ? `ORIGIN returned an invalid API response (HTTP ${response.status}).`
            : `ORIGIN APIから正しい形式の応答を受け取れませんでした（HTTP ${response.status}）。`,
          retryable: true,
          requestId: '',
        };
      }

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

      const answerWasProvided = Object.prototype.hasOwnProperty.call(data, 'answer');
      const parsedAnswer = answerWasProvided
        ? parseOriginAnswerEnvelope(data.answer)
        : undefined;
      if (
        answerWasProvided
        && (!parsedAnswer || !verificationMatchesRouting(parsedAnswer, data.routing))
      ) {
        throw {
          code: 'ANSWER_INTEGRITY_UNVERIFIED',
          message: isEn
            ? 'The answer was hidden because its structure or verification record could not be confirmed.'
            : '回答の構造または確認記録を検証できなかったため、内容を表示しません。',
          retryable: false,
          requestId: '',
        };
      }
      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'ai',
        content: data.content,
        answer: parsedAnswer,
        routing: data.routing,
      };
      setMessages((previous) => [...previous, aiMessage]);
      setCompletionAnnouncement(answerCompletionAnnouncement(aiMessage.answer, isEn));
      dispatchAiCoreState('HEALTHY');
    } catch (caughtError: unknown) {
      setCompletionAnnouncement('');
      const error = (caughtError && typeof caughtError === 'object' ? caughtError : {}) as ChatApiError;

      let aiCoreState: AiCoreState = 'OFFLINE';
      let title = isEn ? 'Could not connect to ORIGIN' : 'ORIGINに接続できませんでした';
      let description = error.message || (isEn
        ? 'The request failed. Please try again later.'
        : '処理に失敗しました。しばらくしてから再試行してください。');
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
        const retryAfterSeconds = Number(error.retryAfterSeconds);
        if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
          setRetrySecondsRemaining(Math.ceil(retryAfterSeconds));
          description = isEn
            ? `The free AI is temporarily rate-limited. Retry will be available in about ${Math.ceil(retryAfterSeconds)} seconds.`
            : `無料AIが一時的に混み合っています。約${Math.ceil(retryAfterSeconds)}秒後に再試行できます。`;
        } else {
          description = isEn
            ? 'The free daily or provider limit may have been reached. Please try again later.'
            : '無料AIの日次上限または提供元の混雑上限に達した可能性があります。時間をおいて再試行してください。';
        }
      } else if (
        error.code === 'FREE_PROVIDER_NOT_CONFIGURED'
        || error.code === 'PROVIDER_NOT_CONFIGURED'
        || error.code === 'API_KEY_INVALID'
      ) {
        aiCoreState = 'NOT_CONFIGURED';
        title = isEn
          ? 'The free AI connection is not ready'
          : '無料AIの接続準備が完了していません';
        description = isEn
          ? 'ORIGIN cannot answer until its server-side connection is ready. There is no problem with your request.'
          : 'ORIGIN側の接続準備が完了するまで回答できません。入力した依頼に問題はありません。';
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
      } else if (error.code === 'ANSWER_INTEGRITY_UNVERIFIED') {
        aiCoreState = 'DEGRADED';
        title = isEn
          ? 'The answer verification record could not be confirmed'
          : '回答の確認記録を検証できませんでした';
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
      } else if (error.code === 'ORIGIN_API_NON_JSON') {
        aiCoreState = 'OFFLINE';
        title = isEn ? 'ORIGIN API is not reachable' : 'ORIGIN APIに接続できません';
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
          retryAfterSeconds: error.retryAfterSeconds,
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
    if (inFlightRef.current || retrySecondsRemaining > 0) return;

    const validMessages = [...messages];
    while (validMessages.length > 0 && validMessages[validMessages.length - 1].error) {
      validMessages.pop();
    }

    inFlightRef.current = true;
    setMessages(validMessages);
    await processSend(validMessages);
  };

  useEffect(() => {
    const hasRequest = messages.some((message) => message.role === 'user');
    if (!hasRequest) return;

    const now = new Date().toISOString();
    setSessions((previous) => {
      const existing = previous.find((session) => session.id === activeSessionId);
      const updated: ChatSession = {
        id: activeSessionId,
        title: sessionTitle(messages, isEn),
        messages,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      const next = [updated, ...previous.filter((session) => session.id !== activeSessionId)]
        .slice(0, MAX_STORED_SESSIONS);
      window.localStorage.setItem(CHAT_HISTORY_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, [activeSessionId, messages, isEn]);

  useEffect(() => {
    if (retrySecondsRemaining <= 0) return;
    const timer = window.setInterval(() => {
      setRetrySecondsRemaining((seconds) => Math.max(0, seconds - 1));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [retrySecondsRemaining > 0]);

  useEffect(() => {
    if (!isTyping) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setProcessingSeconds(Math.floor((Date.now() - startedAt) / 1_000));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [isTyping]);

  useEffect(() => {
    const prompt = initialPrompt?.trim();
    if (!prompt || handledInitialPromptRef.current === prompt) return;
    handledInitialPromptRef.current = prompt;
    void handleSend(prompt);
  }, [initialPrompt]);

  useEffect(() => {
    const scrollRegion = scrollRef.current;
    if (!scrollRegion) return;

    const latestMessage = messages[messages.length - 1];
    if (!isTyping && latestMessage?.role === 'ai' && latestMessage.kind !== 'intro') {
      const latestAnswer = scrollRegion.querySelector<HTMLElement>(
        `[data-message-id="${latestMessage.id}"]`,
      );
      if (latestAnswer) {
        const scrollRegionRect = scrollRegion.getBoundingClientRect();
        const latestAnswerRect = latestAnswer.getBoundingClientRect();
        scrollRegion.scrollTop += latestAnswerRect.top - scrollRegionRect.top;
      }
      return;
    }

    scrollRegion.scrollTop = scrollRegion.scrollHeight;
  }, [messages, isTyping]);

  return (
    <div className="origin-chat relative flex h-full min-h-0 flex-col bg-transparent dark:bg-origin-paper">
      <div className="flex items-center justify-between border-b border-origin-border bg-white/90 px-3 py-2 dark:bg-origin-surface/90 sm:px-6">
        <button
          type="button"
          onClick={() => setShowHistory(true)}
          className="flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-origin-brand transition hover:bg-origin-brand-soft"
          aria-label={isEn ? 'Open conversation history' : '過去の依頼履歴を開く'}
        >
          <History className="h-4 w-4" aria-hidden="true" />
          {isEn ? 'History' : '履歴'}
          {sessions.length > 0 && (
            <span className="rounded-full bg-origin-brand-soft px-2 py-0.5 text-xs">{sessions.length}</span>
          )}
        </button>
        <button
          type="button"
          onClick={createNewConversation}
          disabled={isTyping}
          className="flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-origin-brand transition hover:bg-origin-brand-soft disabled:opacity-50"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {isEn ? 'New' : '新規'}
        </button>
      </div>

      {showHistory && (
        <div className="absolute inset-0 z-30 flex bg-black/30" role="presentation" onClick={() => setShowHistory(false)}>
          <aside
            role="dialog"
            aria-modal="true"
            aria-label={isEn ? 'Conversation history' : '過去の依頼履歴'}
            className="h-full w-[min(88vw,380px)] overflow-y-auto border-r border-origin-border bg-white shadow-xl dark:bg-origin-surface"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 flex items-center justify-between border-b border-origin-border bg-white px-4 py-3 dark:bg-origin-surface">
              <h2 className="font-semibold text-origin-ink">{isEn ? 'History' : '過去の依頼'}</h2>
              <button type="button" onClick={() => setShowHistory(false)} className="min-h-11 min-w-11 rounded-xl p-2 hover:bg-origin-surface-muted" aria-label={isEn ? 'Close history' : '履歴を閉じる'}>
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            {sessions.length === 0 ? (
              <p className="p-5 text-sm text-origin-muted">{isEn ? 'No saved requests yet.' : '保存された依頼はまだありません。'}</p>
            ) : (
              <ul className="divide-y divide-origin-border">
                {sessions.map((session) => (
                  <li key={session.id} className="flex items-stretch gap-1 p-2">
                    <button
                      type="button"
                      onClick={() => openSession(session)}
                      className="min-w-0 flex-1 rounded-xl px-3 py-3 text-left hover:bg-origin-surface-muted"
                    >
                      <span className="block truncate text-sm font-medium text-origin-ink">{session.title}</span>
                      <time className="mt-1 block text-xs text-origin-muted">
                        {new Intl.DateTimeFormat(isEn ? 'en' : 'ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(session.updatedAt))}
                      </time>
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteSession(session.id)}
                      className="min-h-11 min-w-11 self-center rounded-xl p-2 text-origin-muted hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                      aria-label={isEn ? `Delete ${session.title}` : `${session.title}を削除`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      )}

      <div
        ref={scrollRef}
        role="log"
        aria-live="off"
        aria-busy={isTyping}
        aria-label={isEn ? 'Conversation history' : '会話履歴'}
        className="mx-auto w-full max-w-[820px] flex-1 space-y-6 overflow-y-auto px-3 py-5 sm:px-6 sm:py-8"
      >
        <AnimatePresence initial={false}>
          {messages.map((message) => (
            <motion.div
              key={message.id}
              data-message-id={message.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              role="article"
              aria-label={message.role === 'user'
                ? (isEn ? 'Your request' : 'あなたの依頼')
                : message.kind === 'intro'
                  ? (isEn ? 'ORIGIN guidance' : 'ORIGINの案内')
                : message.error
                  ? (isEn ? 'ORIGIN error' : 'ORIGINのエラー')
                  : (isEn ? 'ORIGIN answer' : 'ORIGINの回答')}
              className={cn(
                'flex w-full gap-3 sm:gap-4',
                message.role === 'user' ? 'flex-row-reverse' : 'flex-row',
              )}
            >
              <div className={cn(
                'mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                message.role === 'user'
                  ? 'bg-slate-200 dark:bg-neutral-800'
                  : message.error ? 'bg-red-100 dark:bg-red-500/20' : 'hidden',
              )}>
                {message.role === 'user' ? (
                  <User className="h-4 w-4 text-slate-600 dark:text-neutral-300" aria-hidden="true" />
                ) : message.error ? (
                  <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" aria-hidden="true" />
                ) : (
                  <Sparkles className="h-4 w-4 text-white dark:text-black" aria-hidden="true" />
                )}
              </div>

              <div className={cn(
                'flex min-w-0 flex-col gap-3',
                message.role === 'user' ? 'max-w-[88%] sm:max-w-[72%]' : 'flex-1',
              )}>
                {message.error ? (
                  <div role="alert" className="flex flex-col gap-3 rounded-2xl border border-origin-border border-l-4 border-l-red-400 bg-white p-4 shadow-sm dark:border-origin-border dark:border-l-red-400 dark:bg-origin-surface">
                    <h4 className="text-sm font-semibold text-origin-ink dark:text-origin-ink">{message.content}</h4>
                    <p className="whitespace-pre-wrap text-sm leading-6 text-origin-muted dark:text-origin-muted">{message.error.description}</p>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {message.error.retryable && (
                        <button
                          type="button"
                          onClick={handleRetry}
                          disabled={isTyping || retrySecondsRemaining > 0}
                          className="flex min-h-11 items-center gap-1.5 rounded-xl bg-origin-brand-soft px-3.5 py-2 text-[13px] font-semibold text-origin-brand transition-colors hover:bg-origin-brand-border disabled:opacity-50 dark:bg-origin-brand-soft dark:text-origin-brand dark:hover:bg-origin-brand-border"
                        >
                          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                          {retrySecondsRemaining > 0
                            ? (isEn
                                ? `Retry in ${retrySecondsRemaining}s`
                                : `${retrySecondsRemaining}秒後に再試行`)
                            : (isEn ? 'Retry' : '再試行')}
                        </button>
                      )}
                    </div>

                    <details
                      data-testid="error-details"
                      className="group mt-1 border-t border-origin-border pt-2 text-[13px] text-origin-muted dark:border-origin-border dark:text-origin-muted"
                    >
                      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md py-1 font-medium outline-none focus-visible:ring-2 focus-visible:ring-origin-brand">
                        <span>{isEn ? 'Technical information' : '技術情報'}</span>
                        <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
                      </summary>
                      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-origin-surface-muted p-2 font-mono text-[13px] dark:bg-origin-surface-muted">
                        <dt>{isEn ? 'Error code' : 'エラーコード'}</dt>
                        <dd className="break-all">{message.error.code}</dd>
                        <dt>{isEn ? 'Reference ID' : '問い合わせID'}</dt>
                        <dd className="break-all">{message.error.requestId}</dd>
                      </dl>
                    </details>
                  </div>
                ) : (
                  <div className={cn(
                    'text-sm leading-relaxed',
                    message.role === 'user'
                      ? 'rounded-2xl bg-origin-brand px-4 py-3 text-white shadow-sm dark:bg-origin-brand dark:text-origin-paper'
                      : 'rounded-2xl border border-origin-border bg-white p-5 shadow-sm dark:border-origin-border dark:bg-origin-surface sm:p-6',
                  )}>
                    <div className={cn(
                      'markdown-body',
                      message.role === 'user' && 'text-white prose-p:text-white prose-strong:text-white',
                    )}>
                      {message.answer && shouldShowSeparateConclusion(message.answer) && (
                        <section data-testid="answer-conclusion" className="mb-6 border-l-2 border-origin-brand pl-4 dark:border-origin-brand">
                          <h3 className="mb-2 text-[13px] font-semibold tracking-[0.08em] text-origin-brand dark:text-origin-brand">
                            {isEn ? 'Conclusion' : '結論'}
                          </h3>
                          <SafeMarkdown isEn={isEn}>{message.answer.conclusion}</SafeMarkdown>
                        </section>
                      )}
                      <SafeMarkdown isEn={isEn}>{message.answer?.answer ?? message.content}</SafeMarkdown>
                    </div>

                    {message.answer && shouldShowStructuredAnswer(message.answer) && (
                      <div data-testid="structured-answer" className="mt-7 space-y-5 border-t border-slate-200/80 pt-5 dark:border-white/10">
                        {shouldShowVerificationDetails(message.answer) && (
                          <section
                            data-testid="answer-trust-overview"
                            aria-labelledby={`answer-trust-overview-${message.id}`}
                            className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/5"
                          >
                          <h3
                            id={`answer-trust-overview-${message.id}`}
                            className="mb-2 text-[13px] font-semibold text-origin-muted dark:text-origin-muted"
                          >
                            {isEn ? 'What was checked' : 'この回答の確認範囲'}
                          </h3>
                          <dl className="grid gap-2 text-[13px] sm:grid-cols-2">
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
                        )}

                        {message.answer.evidence.length > 0 && (
                          <details
                            data-testid="answer-evidence-details"
                            className="group rounded-xl border border-slate-200 bg-white/70 dark:border-white/10 dark:bg-black/10"
                          >
                            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-3 py-2.5 text-[13px] font-semibold text-origin-muted outline-none transition hover:bg-origin-surface-muted focus-visible:ring-2 focus-visible:ring-origin-brand dark:text-origin-muted dark:hover:bg-origin-surface-muted dark:focus-visible:ring-origin-brand">
                              <span>{isEn ? 'Evidence and sources' : '根拠と出典'}</span>
                              <span className="rounded-lg bg-origin-surface-muted px-2 py-0.5 text-[13px] font-medium text-origin-muted dark:bg-origin-surface-muted dark:text-origin-muted">
                                {message.answer.evidence.length}
                              </span>
                              <span className="ml-auto font-medium text-slate-500 dark:text-neutral-500">
                                {isEn ? 'Show' : '表示'}
                              </span>
                              <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
                            </summary>
                            <ul className="space-y-3 border-t border-slate-200 px-3 py-3 text-sm dark:border-white/10">
                              {message.answer.evidence.map((item, index) => (
                                <li key={`${item.label}-${index}`}>
                                  <div className="flex flex-wrap items-center gap-2">
                                    {item.sourceUrl ? (
                                      <a className="underline underline-offset-2" href={item.sourceUrl} target="_blank" rel="noreferrer">
                                        {item.label}
                                      </a>
                                    ) : item.label}
                                    <span className="rounded-lg bg-origin-surface-muted px-2 py-0.5 text-[13px] text-origin-muted dark:bg-origin-surface-muted dark:text-origin-muted">
                                      {item.evidenceLevel === 'source-checked'
                                        ? (isEn ? 'Source checked' : '出典確認済み')
                                        : (isEn ? 'AI-provided · not checked' : 'AIが提示・未確認')}
                                    </span>
                                  </div>
                                  <p className="mt-1 text-[13px] text-origin-muted dark:text-origin-muted">
                                    {evidenceCheckLabel(item, isEn)}
                                  </p>
                                  {item.claim && (
                                    <p className="mt-1 text-[13px] text-origin-muted dark:text-origin-muted">
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
                          </details>
                        )}

                        {shouldShowVerificationDetails(message.answer) && (
                          <section data-testid="answer-verification">
                            <h3 className="mb-1 text-[13px] font-semibold text-origin-muted dark:text-origin-muted">
                              {isEn ? 'Verification' : '確認状況'}
                            </h3>
                            <p className="text-sm text-slate-700 dark:text-neutral-300">
                              {message.answer.verification.summary}
                            </p>
                          </section>
                        )}

                        {message.answer.limitations.length > 0 && (
                          <section>
                            <h3 className="mb-2 text-[13px] font-semibold text-origin-muted dark:text-origin-muted">
                              {isEn ? 'Limitations' : '制約・未確認事項'}
                            </h3>
                            <ul className="list-disc space-y-1 pl-5 text-sm">
                              {message.answer.limitations.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
                            </ul>
                          </section>
                        )}

                        {message.answer.nextActions.length > 0 && (
                          <section data-testid="answer-next-actions" className="rounded-xl border border-origin-brand-border bg-origin-brand-soft p-4 dark:border-origin-brand-border dark:bg-origin-brand-soft">
                            <h3 className="mb-3 text-[13px] font-semibold tracking-[0.06em] text-origin-brand dark:text-origin-brand">
                              {isEn ? 'Move forward next' : '次に進めること'}
                            </h3>
                            <ul className="list-decimal space-y-2 pl-5 text-sm leading-6 text-origin-ink marker:font-semibold marker:text-origin-brand dark:text-origin-ink dark:marker:text-origin-brand">
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
                    className="group rounded-xl border border-origin-border bg-white/60 text-[13px] text-origin-muted dark:border-origin-border dark:bg-origin-surface/60 dark:text-origin-muted"
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
              <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-950 dark:bg-white">
                <Activity className="h-4 w-4 animate-pulse text-white dark:text-black" aria-hidden="true" />
              </div>
              <div
                data-testid="processing-status-card"
                aria-label={isEn ? 'ORIGIN is working' : 'ORIGINが処理中'}
                className="min-w-0 flex-1 rounded-2xl border border-origin-border bg-origin-surface px-4 py-3 shadow-sm dark:border-origin-border dark:bg-origin-surface"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span aria-hidden="true" className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-origin-brand dark:bg-origin-brand" />
                  <span
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                    className="min-w-0 flex-1 truncate text-sm font-medium text-origin-ink dark:text-origin-ink"
                  >
                    {processingStatus(processingSeconds, isEn)}
                  </span>
                  <span aria-hidden="true" className="shrink-0 tabular-nums text-[13px] text-origin-muted dark:text-origin-muted">
                    {processingSeconds}{isEn ? 's' : '秒'}
                  </span>
                </div>
                <div className="mt-2 h-0.5 overflow-hidden rounded-full bg-origin-border dark:bg-origin-border" aria-hidden="true">
                  <motion.div
                    className="h-full rounded-full bg-origin-brand dark:bg-origin-brand"
                    initial={{ width: '12%' }}
                    animate={{
                      width: processingSeconds < 5
                        ? '24%'
                        : processingSeconds < 15
                          ? '48%'
                          : processingSeconds < 30
                            ? '72%'
                            : '88%',
                    }}
                    transition={{ duration: 0.35 }}
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div
        data-testid="response-announcement"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {completionAnnouncement}
      </div>

      <div className="safe-area-bottom shrink-0 border-t border-origin-border bg-origin-paper/95 px-3 pt-3 backdrop-blur dark:border-origin-border dark:bg-origin-paper/95 sm:px-4">
        <div className="mx-auto max-w-[820px]">
          <div className="flex items-end gap-2 rounded-2xl border border-origin-control bg-white p-2 shadow-sm transition focus-within:border-origin-brand focus-within:ring-2 focus-within:ring-origin-brand/20 dark:border-origin-control dark:bg-origin-surface dark:focus-within:border-origin-brand dark:focus-within:ring-origin-brand/20">
            <textarea
              id="origin-chat-input"
              rows={1}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={isEn ? 'Describe what you want to do' : 'やりたいことを入力'}
              aria-label={isEn ? 'Request to ORIGIN' : 'ORIGINへの依頼'}
              aria-describedby="origin-chat-guidance"
              className="max-h-40 min-h-12 flex-1 resize-none border-none bg-transparent px-3 py-3 text-base leading-relaxed text-origin-ink outline-none placeholder:text-origin-placeholder focus:outline-none dark:text-origin-ink dark:placeholder:text-origin-placeholder"
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter'
                  && !event.shiftKey
                  && !event.nativeEvent.isComposing
                  && event.keyCode !== 229
                ) {
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
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-origin-brand text-white shadow-sm outline-none transition hover:bg-origin-brand-hover focus-visible:ring-2 focus-visible:ring-origin-brand disabled:cursor-not-allowed disabled:bg-origin-control dark:bg-origin-brand dark:text-origin-paper dark:hover:bg-origin-brand-hover dark:disabled:bg-origin-control dark:disabled:text-white dark:focus-visible:ring-origin-brand"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div
            id="origin-chat-guidance"
            className="mt-2 flex flex-col gap-1 px-1 text-[13px] leading-5 text-origin-muted dark:text-origin-muted sm:flex-row sm:items-center sm:justify-between"
          >
            <span>{isEn ? 'Enter to send / Shift+Enter for a new line' : 'Enterで送信 / Shift+Enterで改行'}</span>
            <span>{isEn ? 'Do not enter passwords or API keys.' : 'パスワードやAPIキーは入力しないでください。'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
