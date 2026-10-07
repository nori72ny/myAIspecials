import type { ArtifactCell } from './artifactGeneratorV12.js';

// Cache only a deliberately small, independently calculated Excel subset.
// Unsupported expressions keep their formula but must never inherit an input cache.
export function calculateFormulaCaches(rows: ArtifactCell[][]): ArtifactCell[][] {
  const memo = new Map<string, number>();
  const active = new Set<string>();
  let remaining = 100_000;
  const fail = (): never => { throw new Error('UNCALCULATED_FORMULA'); };
  const tick = () => { if (--remaining < 0) fail(); };
  const address = (ref: string): [number, number] => {
    const match = /^\$?([A-Z]{1,3})\$?([1-9]\d*)$/i.exec(ref);
    if (!match) return fail();
    let col = 0;
    for (const char of match[1].toUpperCase()) col = col * 26 + char.charCodeAt(0) - 64;
    const row = Number(match[2]);
    if (col > 16384 || row > 1048576) return fail();
    return [row - 1, col - 1];
  };
  const cell = (r: number, c: number, depth: number): number => {
    tick();
    if (depth > 64) return fail();
    const key = `${r}:${c}`;
    if (memo.has(key)) return memo.get(key)!;
    if (active.has(key)) return fail();
    const value = rows[r]?.[c];
    if (value == null) return 0;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'object') return fail();
    active.add(key);
    try {
      const result = expression(value.formula.replace(/^\s*=/, ''), depth + 1);
      if (!Number.isFinite(result)) return fail();
      memo.set(key, result);
      return result;
    } finally { active.delete(key); }
  };
  const expression = (source: string, depth: number): number => {
    if (depth > 64 || source.length > 512) return fail();
    const tokens = source.match(/\$?[A-Za-z]{1,3}\$?[1-9]\d*|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_]+|\S/g) ?? [];
    let pos = 0;
    const take = (token: string) => tokens[pos]?.toUpperCase() === token && (++pos > 0);
    const requireToken = (token: string) => { if (!take(token)) fail(); };
    const atom = (level: number): number => {
      tick();
      if (level > 64) return fail();
      if (take('+')) return atom(level + 1);
      if (take('-')) return -atom(level + 1);
      if (take('(')) { const value = add(level + 1); requireToken(')'); return value; }
      if (take('SUM')) {
        requireToken('(');
        let total = 0;
        if (take(')')) return 0;
        do {
          if (tokens[pos + 1] === ':') {
            const [r1, c1] = address(tokens[pos++]);
            pos++;
            const [r2, c2] = address(tokens[pos++] ?? '');
            const count = (Math.abs(r2 - r1) + 1) * (Math.abs(c2 - c1) + 1);
            if (count > remaining) return fail();
            for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
              for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
                tick();
                const value = rows[r]?.[c];
                // Excel SUM ignores text and booleans in a referenced range.
                if (typeof value !== 'string' && typeof value !== 'boolean') total += cell(r, c, depth + 1);
              }
            }
          } else total += add(level + 1);
        } while (take(','));
        requireToken(')');
        return total;
      }
      const token = tokens[pos++] ?? '';
      if (/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(token)) return Number(token);
      const [r, c] = address(token);
      return cell(r, c, depth + 1);
    };
    const multiply = (level: number): number => {
      let value = atom(level);
      while (tokens[pos] === '*' || tokens[pos] === '/') {
        const operator = tokens[pos++];
        const right = atom(level);
        value = operator === '*' ? value * right : value / right;
      }
      return value;
    };
    const add = (level: number): number => {
      let value = multiply(level);
      while (tokens[pos] === '+' || tokens[pos] === '-') {
        const operator = tokens[pos++];
        const right = multiply(level);
        value = operator === '+' ? value + right : value - right;
      }
      return value;
    };
    const result = add(depth);
    if (pos !== tokens.length || !Number.isFinite(result)) return fail();
    return result;
  };
  return rows.map((row, r) => row.map((value, c) => {
    if (!value || typeof value !== 'object') return value;
    try { return { formula: value.formula, cachedValue: cell(r, c, 0) }; }
    catch { return { formula: value.formula }; }
  }));
}
