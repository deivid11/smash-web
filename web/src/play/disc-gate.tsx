import { useState } from 'react';
import type { DiscGate } from './game-session.ts';

/** Client-disc mode boot screen: the player selects their own original ISO and, depending on
 * the host policy, the ACE 2.0 extension ISO. Files are read in this browser only. */
export function DiscGateOverlay({ gate, onStart }: { gate: DiscGate; onStart: (vanilla: File, ace: File | null) => void }) {
  const [vanilla, setVanilla] = useState<File | null>(null);
  const [ace, setAce] = useState<File | null>(null);
  const needsAce = gate.ace === 'required';
  const ready = !!vanilla && (!needsAce || !!ace) && !gate.verifying;
  const pick = (set: (file: File | null) => void) => (event: React.ChangeEvent<HTMLInputElement>) => set(event.target.files?.[0] ?? null);
  return <div className="loading-overlay disc-gate" role="dialog" aria-modal="true" aria-labelledby="disc-gate-title">
    <span className="loading-brand" aria-hidden="true">SMASH<span>WEB</span></span>
    <p className="loading-title" id="disc-gate-title">SELECT YOUR LEGAL COPY OF THE GAME</p>
    <label className="disc-slot">
      <span className="disc-slot-name">ORIGINAL · USA v1.02 <em>required</em></span>
      <input id="disc-vanilla" type="file" accept=".iso,.gcm" disabled={gate.verifying} onChange={pick(setVanilla)} />
    </label>
    {gate.ace !== 'off' && <label className="disc-slot">
      <span className="disc-slot-name">ACE 2.0 EXTENSION <em>{needsAce ? 'required' : 'optional · skip it to play the original roster'}</em></span>
      <input id="disc-ace" type="file" accept=".iso,.gcm" disabled={gate.verifying} onChange={pick(setAce)} />
    </label>}
    <button id="disc-start" className="primary" disabled={!ready} onClick={() => { if (vanilla) onStart(vanilla, gate.ace === 'off' ? null : ace); }}>
      {gate.verifying ? 'VERIFYING…' : ace && gate.ace !== 'off' ? 'PLAY ORIGINAL + ACE' : 'PLAY ORIGINAL'}
    </button>
    {gate.error && <p className="disc-gate-error" role="alert">{gate.error}</p>}
    <section className="disc-gate-about" aria-labelledby="disc-gate-about-title">
      <h2 id="disc-gate-about-title">ABOUT</h2>
      <p>Smash Web is a fan-made browser port of Super Smash Bros. Melee for the Nintendo GameCube: play the original fighters and stages, optional ACE 2.0 mod fighters, online matches and a roguelike mode, right in your browser.</p>
      <p>You must supply a legally obtained copy of the game disc (USA v1.02 ISO) to play.</p>
      <p>Your ISO and its assets stay on your device. Nothing is uploaded. After the first load, the game files it needs are saved in this browser so you are not asked again (Options → Clear downloaded data forgets them). Online rooms only match players who loaded the same discs.</p>
      <p>The source is open at <a href="https://github.com/deivid11/smash-web" target="_blank" rel="noreferrer">github.com/deivid11/smash-web</a>.</p>
      <p className="disc-gate-fine">Smash Web is not affiliated with, endorsed by, or sponsored by Nintendo or HAL Laboratory. Super Smash Bros., Nintendo GameCube, and all related characters, names, and marks are trademarks of Nintendo and their respective owners.</p>
    </section>
  </div>;
}
