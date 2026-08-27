import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export type SimulationParameter = {
  name: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
};

export type SimulationOutput = {
  name: string;
  expression: string;
  unit?: string;
};

export type SimulationSpec = {
  title?: string;
  parameters: SimulationParameter[];
  outputs?: SimulationOutput[];
};

type Token = { kind: 'number' | 'identifier' | 'operator' | 'paren'; value: string };

function tokenize(expression: string): Token[] | null {
  const tokens: Token[] = [];
  let index = 0;
  while (index < expression.length) {
    const char = expression[index];
    if (/\s/.test(char)) { index += 1; continue; }
    if (/[0-9.]/.test(char)) {
      const match = expression.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
      if (!match) return null;
      tokens.push({ kind: 'number', value: match[0] });
      index += match[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const match = expression.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/);
      if (!match) return null;
      tokens.push({ kind: 'identifier', value: match[0] });
      index += match[0].length;
      continue;
    }
    if ('+-*/'.includes(char)) { tokens.push({ kind: 'operator', value: char }); index += 1; continue; }
    if ('()'.includes(char)) { tokens.push({ kind: 'paren', value: char }); index += 1; continue; }
    return null;
  }
  return tokens;
}

function evaluateExpression(expression: string, values: Record<string, number>): number | null {
  const tokens = tokenize(expression);
  if (!tokens || tokens.length === 0) return null;
  let position = 0;

  const parsePrimary = (): number | null => {
    const token = tokens[position];
    if (!token) return null;
    if (token.kind === 'number') { position += 1; return Number(token.value); }
    if (token.kind === 'identifier') {
      position += 1;
      if (token.value === 'min' || token.value === 'max' || token.value === 'abs') {
        if (tokens[position]?.value !== '(') return null;
        position += 1;
        const first = parseAdditive();
        if (first === null) return null;
        if (token.value === 'abs') {
          if (tokens[position]?.value !== ')') return null;
          position += 1;
          return Math.abs(first);
        }
        if (tokens[position]?.value !== ',') return null;
        position += 1;
        const second = parseAdditive();
        if (second === null || tokens[position]?.value !== ')') return null;
        position += 1;
        return token.value === 'min' ? Math.min(first, second) : Math.max(first, second);
      }
      return Number.isFinite(values[token.value]) ? values[token.value] : null;
    }
    if (token.value === '(') {
      position += 1;
      const value = parseAdditive();
      if (tokens[position]?.value !== ')') return null;
      position += 1;
      return value;
    }
    if (token.value === '+' || token.value === '-') {
      position += 1;
      const value = parsePrimary();
      return value === null ? null : token.value === '-' ? -value : value;
    }
    return null;
  };

  const parseMultiplicative = (): number | null => {
    let value = parsePrimary();
    while (value !== null && (tokens[position]?.value === '*' || tokens[position]?.value === '/')) {
      const operator = tokens[position].value;
      position += 1;
      const right = parsePrimary();
      if (right === null || (operator === '/' && right === 0)) return null;
      value = operator === '*' ? value * right : value / right;
    }
    return value;
  };

  function parseAdditive(): number | null {
    let value = parseMultiplicative();
    while (value !== null && (tokens[position]?.value === '+' || tokens[position]?.value === '-')) {
      const operator = tokens[position].value;
      position += 1;
      const right = parseMultiplicative();
      if (right === null) return null;
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  }

  const result = parseAdditive();
  return position === tokens.length && result !== null && Number.isFinite(result) ? result : null;
}

function formatValue(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 4 }).format(value);
}

export function parseSimulationSpec(source: string): SimulationSpec | null {
  try {
    const parsed: unknown = JSON.parse(source);
    if (!parsed || typeof parsed !== 'object') return null;
    const candidate = parsed as Partial<SimulationSpec>;
    if (!Array.isArray(candidate.parameters) || candidate.parameters.length === 0 || candidate.parameters.length > 12) return null;
    const parameters = candidate.parameters.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const value = item as Partial<SimulationParameter>;
      if (typeof value.name !== 'string' || !value.name.trim() || !Number.isFinite(value.value) || !Number.isFinite(value.min) || !Number.isFinite(value.max)) return [];
      if (value.min > value.max || value.value < value.min || value.value > value.max) return [];
      return [{ name: value.name.trim(), value: value.value, min: value.min, max: value.max, step: Number.isFinite(value.step) && value.step! > 0 ? value.step : undefined, unit: typeof value.unit === 'string' ? value.unit : undefined }];
    });
    if (parameters.length !== candidate.parameters.length) return null;
    const outputs = Array.isArray(candidate.outputs) ? candidate.outputs.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const output = item as Partial<SimulationOutput>;
      return typeof output.name === 'string' && typeof output.expression === 'string'
        ? [{ name: output.name, expression: output.expression, unit: typeof output.unit === 'string' ? output.unit : undefined }]
        : [];
    }) : [];
    if (outputs.length > 12) return null;
    return { title: typeof candidate.title === 'string' ? candidate.title : undefined, parameters, outputs };
  } catch {
    return null;
  }
}

export function AdaptiveSimulationCanvas({ spec, className = '' }: { spec: SimulationSpec; className?: string }): ReactNode {
  const initialValues = useMemo(() => Object.fromEntries(spec.parameters.map((parameter) => [parameter.name, parameter.value])), [spec.parameters]);
  const [values, setValues] = useState<Record<string, number>>(initialValues);

  const results = useMemo(() => (spec.outputs ?? []).map((output) => ({
    ...output,
    value: evaluateExpression(output.expression, values),
  })), [spec.outputs, values]);

  return (
    <section className={`rounded-2xl border border-cyan-400/20 bg-slate-950 p-4 shadow-lg ${className}`} aria-label={spec.title ?? 'Interactive simulation'}>
      {spec.title && <h3 className="mb-4 text-base font-semibold text-slate-100">{spec.title}</h3>}
      <div className="space-y-4">
        {spec.parameters.map((parameter) => {
          const value = values[parameter.name] ?? parameter.value;
          return (
            <label key={parameter.name} className="block">
              <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium text-slate-200">{parameter.name}</span>
                <span className="tabular-nums text-cyan-300">{formatValue(value)}{parameter.unit ? ` ${parameter.unit}` : ''}</span>
              </div>
              <input
                type="range"
                min={parameter.min}
                max={parameter.max}
                step={parameter.step ?? 1}
                value={value}
                onChange={(event) => setValues((current) => ({ ...current, [parameter.name]: Number(event.target.value) }))}
                className="min-h-11 w-full accent-cyan-300"
                aria-label={parameter.name}
              />
              <div className="mt-1 flex justify-between text-xs text-slate-400"><span>{formatValue(parameter.min)}</span><span>{formatValue(parameter.max)}</span></div>
            </label>
          );
        })}
      </div>
      {results.length > 0 && (
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {results.map((result) => (
            <div key={`${result.name}-${result.expression}`} className="rounded-xl border border-cyan-300/20 bg-slate-950/80 p-4">
              <div className="text-xs font-medium text-slate-400">{result.name}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-cyan-300">{result.value === null ? '—' : formatValue(result.value)}</div>
              {result.unit && <div className="mt-1 text-xs text-slate-400">{result.unit}</div>}
            </div>
          ))}
        </div>
      )}
      <p className="mt-4 text-xs text-slate-500">このシミュレーションはブラウザ内だけで計算され、外部APIを呼び出しません。</p>
    </section>
  );
}

export function SimulationCodeBlock({ source }: { source: string }): ReactNode {
  const spec = parseSimulationSpec(source);
  if (!spec) {
    return <pre className="overflow-x-auto rounded-xl bg-slate-950 p-4 text-sm text-slate-200"><code>{source}</code></pre>;
  }
  return <AdaptiveSimulationCanvas spec={spec} />;
}
