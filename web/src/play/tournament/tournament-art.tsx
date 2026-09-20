/** Tournament artwork, drawn in SVG/CSS so it costs no downloads: the cup,
 * laurels, the split VS bolt, mode emblems, arena spotlights and confetti. */
import type { CSSProperties } from 'react';
import type { TournamentMode } from '../../../../lib/game/tournament/bracket.ts';

export function Trophy({ className = '', tone = 'gold' }: { className?: string; tone?: 'gold' | 'silver' | 'bronze' }) {
  const id = `cup-${tone}`;
  const stops = tone === 'gold' ? ['#fff3b0', '#ffc933', '#b8720a'] : tone === 'silver' ? ['#ffffff', '#c3cedd', '#69778c'] : ['#ffd9b0', '#d98a4a', '#7a4318'];
  return <svg className={`tourney-trophy ${className}`} viewBox="0 0 120 140" aria-hidden="true">
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={stops[0]} /><stop offset="0.5" stopColor={stops[1]} /><stop offset="1" stopColor={stops[2]} /></linearGradient>
      <radialGradient id={`${id}-glow`} cx="0.5" cy="0.4" r="0.6"><stop offset="0" stopColor={stops[1]} stopOpacity="0.55" /><stop offset="1" stopColor={stops[1]} stopOpacity="0" /></radialGradient>
    </defs>
    <ellipse cx="60" cy="58" rx="58" ry="56" fill={`url(#${id}-glow)`} />
    <path d="M28 18h64v8c0 30-12 50-32 56C40 76 28 56 28 26z" fill={`url(#${id})`} stroke="#3a2404" strokeWidth="2.5" strokeLinejoin="round" />
    <path d="M28 24H12c0 22 8 34 22 38M92 24h16c0 22-8 34-22 38" fill="none" stroke={`url(#${id})`} strokeWidth="7" strokeLinecap="round" />
    <path d="M28 24H12c0 22 8 34 22 38M92 24h16c0 22-8 34-22 38" fill="none" stroke="#3a2404" strokeWidth="1.2" strokeLinecap="round" opacity="0.5" />
    <path d="M52 82h16l3 22H49z" fill={`url(#${id})`} stroke="#3a2404" strokeWidth="2.5" strokeLinejoin="round" />
    <rect x="34" y="104" width="52" height="12" rx="3" fill={`url(#${id})`} stroke="#3a2404" strokeWidth="2.5" />
    <rect x="26" y="116" width="68" height="16" rx="4" fill="#1b2438" stroke="#3a2404" strokeWidth="2.5" />
    <path d="M60 32l5.3 11 12 1.6-8.8 8.3 2.2 11.9L60 59l-10.7 5.8 2.2-11.9-8.8-8.3 12-1.6z" fill="#fffbe0" opacity="0.92" />
    <path d="M38 24c0 24 6 40 16 48" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" opacity="0.45" />
  </svg>;
}

export function Laurel({ className = '' }: { className?: string }) {
  const leaves = Array.from({ length: 9 }, (_, index) => index);
  const branch = (flip: boolean) => <g transform={flip ? 'translate(200 0) scale(-1 1)' : undefined}>
    <path d="M92 150C40 136 18 92 28 30" fill="none" stroke="#c9a23a" strokeWidth="3" strokeLinecap="round" />
    {leaves.map(index => {
      const t = index / (leaves.length - 1), x = 92 - 70 * Math.sin(t * 1.35) - 4 * t, y = 150 - 124 * t, angle = -70 + 95 * t;
      return <ellipse key={index} cx={x} cy={y} rx="16" ry="6.5" transform={`rotate(${angle} ${x} ${y}) translate(-12 0)`} fill="url(#laurel-leaf)" stroke="#5a4208" strokeWidth="1" />;
    })}
  </g>;
  return <svg className={`tourney-laurel ${className}`} viewBox="0 0 200 160" aria-hidden="true">
    <defs><linearGradient id="laurel-leaf" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff0a8" /><stop offset="1" stopColor="#c48a12" /></linearGradient></defs>
    {branch(false)}{branch(true)}
  </svg>;
}

export function VsBolt({ className = '' }: { className?: string }) {
  return <svg className={`tourney-vs ${className}`} viewBox="0 0 120 120" aria-hidden="true">
    <defs><linearGradient id="vs-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff6c2" /><stop offset="0.55" stopColor="#ffb300" /><stop offset="1" stopColor="#ff3d52" /></linearGradient></defs>
    <path d="M70 2 22 66h30L40 118l58-72H66z" fill="#0008" transform="translate(4 4)" />
    <path d="M70 2 22 66h30L40 118l58-72H66z" fill="url(#vs-fill)" stroke="#fff" strokeWidth="3" strokeLinejoin="round" />
    <text x="60" y="76" textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight="950" fontStyle="italic" fontSize="44" fill="#101827" stroke="#fff" strokeWidth="5" paintOrder="stroke">VS</text>
  </svg>;
}

export function ModeEmblem({ mode, className = '' }: { mode: TournamentMode; className?: string }) {
  return <svg className={`tourney-emblem emblem-${mode} ${className}`} viewBox="0 0 100 100" aria-hidden="true">
    <defs><radialGradient id={`emblem-${mode}`} cx="0.5" cy="0.35" r="0.75"><stop offset="0" stopColor={mode === 'classic' ? '#ff8a96' : mode === 'hill' ? '#ffe28a' : '#b79bff'} /><stop offset="1" stopColor={mode === 'classic' ? '#8f1024' : mode === 'hill' ? '#9a5b00' : '#3a1d8a'} /></radialGradient></defs>
    <circle cx="50" cy="50" r="46" fill={`url(#emblem-${mode})`} stroke="#fff" strokeOpacity="0.7" strokeWidth="3" />
    {mode === 'classic' && <g stroke="#fff" strokeWidth="7" strokeLinecap="round"><path d="M28 72 72 28M28 28l44 44" /><circle cx="50" cy="50" r="8" fill="#fff" stroke="none" /></g>}
    {mode === 'hill' && <g fill="#fff"><path d="M22 66l10-32 12 16 6-22 6 22 12-16 10 32z" /><rect x="22" y="70" width="56" height="8" rx="2" /></g>}
    {mode === 'random' && <g><rect x="24" y="24" width="52" height="52" rx="10" fill="#fff" transform="rotate(12 50 50)" /><g fill="#3a1d8a" transform="rotate(12 50 50)"><circle cx="38" cy="38" r="5" /><circle cx="62" cy="62" r="5" /><circle cx="50" cy="50" r="5" /><circle cx="62" cy="38" r="5" /><circle cx="38" cy="62" r="5" /></g></g>}
  </svg>;
}

/** Sweeping arena spotlights + a crowd line behind a screen. Pure CSS animation. */
export function ArenaLights({ calm = false }: { calm?: boolean }) {
  return <div className={`tourney-lights${calm ? ' calm' : ''}`} aria-hidden="true"><i /><i /><i /><span /></div>;
}

const CONFETTI = ['#ffd24a', '#ff4d67', '#4da3ff', '#74e6c6', '#ffffff', '#b79bff'];
export function Confetti({ count = 46 }: { count?: number }) {
  return <div className="tourney-confetti" aria-hidden="true">{Array.from({ length: count }, (_, index) => {
    const style = { '--x': `${(index * 37) % 100}%`, '--d': `${(index % 9) * 0.22}s`, '--t': `${2.6 + (index % 5) * 0.45}s`, '--r': `${(index * 53) % 360}deg`, '--c': CONFETTI[index % CONFETTI.length] } as CSSProperties;
    return <i key={index} style={style} />;
  })}</div>;
}
