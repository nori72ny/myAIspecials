import React, { useEffect, useRef, useState } from 'react';
import { Send, Square } from 'lucide-react';

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  isGenerating?: boolean;
  onStop?: () => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/** Apple/Linear-style floating composer. Safe to reuse in Chat and Agent surfaces. */
export default function Composer({
  value,
  onChange,
  onSubmit,
  isGenerating = false,
  onStop,
  placeholder = 'やりたいことを入力',
  disabled = false,
  className = '',
}: ComposerProps) {
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canSubmit = value.trim().length > 0 && !disabled && !isGenerating;

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 176)}px`;
  }, [value]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (canSubmit) void onSubmit();
  };

  return (
    <form
      onSubmit={submit}
      className={`origin-composer ${focused ? 'is-focused' : ''} ${className}`.trim()}
      aria-label="ORIGIN Composer"
    >
      <textarea
        ref={textareaRef}
        value={value}
        rows={1}
        disabled={disabled}
        placeholder={placeholder}
        aria-label="ORIGINへの依頼"
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (canSubmit) void onSubmit();
          }
        }}
        className="origin-composer__input"
      />
      <button
        type={isGenerating ? 'button' : 'submit'}
        onClick={isGenerating ? onStop : undefined}
        disabled={isGenerating ? !onStop : !canSubmit}
        aria-label={isGenerating ? '生成を停止' : '依頼を送信'}
        className={`origin-composer__action ${value.trim() || isGenerating ? 'is-ready' : ''} ${isGenerating ? 'is-generating' : ''}`}
      >
        {isGenerating ? <Square className="h-4 w-4 fill-current" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
      </button>
    </form>
  );
}
