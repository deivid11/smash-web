/** Extract a single complete function without rewriting its source text. */
export function extractCFunction(source: string, name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) throw new Error('Invalid C symbol name.');
  const pattern = new RegExp(`^(?:static\\s+)?(?:inline\\s+)?(?:[A-Za-z_][A-Za-z0-9_]*[ \\t*]+)+${name}\\s*\\([^;{}]*\\)\\s*\\{`, 'gm');
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) throw new Error(`Expected one definition of ${name}, found ${matches.length}.`);
  const match = matches[0]!, start = match.index!, brace = start + match[0].lastIndexOf('{');
  let depth = 0, mode: 'code' | 'line' | 'block' | 'string' | 'char' = 'code';
  for (let i = brace; i < source.length; i++) {
    const char = source[i], next = source[i + 1];
    if (mode === 'line') { if (char === '\n') mode = 'code'; continue; }
    if (mode === 'block') { if (char === '*' && next === '/') { mode = 'code'; i++; } continue; }
    if (mode === 'string' || mode === 'char') {
      if (char === '\\') { i++; continue; }
      if (char === (mode === 'string' ? '"' : "'")) mode = 'code';
      continue;
    }
    if (char === '/' && next === '/') { mode = 'line'; i++; }
    else if (char === '/' && next === '*') { mode = 'block'; i++; }
    else if (char === '"') mode = 'string';
    else if (char === "'") mode = 'char';
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Unterminated function ${name}.`);
}
