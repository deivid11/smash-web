import { DiscPanel } from './DiscPanel.tsx';
import { RngPanel } from './RngPanel.tsx';

function LabHeader() {
  return <header className="topbar">
    <a className="brand" href="/" aria-label="Smash Web home"><span className="brand-icon">S<span>↗</span></span> SMASH<span className="brand-light">WEB</span></a>
    <div className="topbar-right"><span className="local-dot" /> LOCAL RESEARCH BUILD <span className="version">0.1 / PRE-ALPHA</span></div>
  </header>;
}

function LabIntroduction() {
  return <>
    <section className="hero">
      <div><p className="eyebrow">PROJECT 01 <span>/</span> GAMECUBE → BROWSER</p><h1>Original code.<br /><span>New playground.</span></h1>
        <p className="intro">A workbench for a faithful Melee browser port.<br />C at the core. WebAssembly in the browser. One step at a time.</p><a className="viewer-launch" href="/play.html">Play the local prototype ↗</a>{' '}<a className="viewer-launch" href="/viewer.html">Asset viewer ↗</a></div>
      <div className="phase"><span className="phase-label">CURRENT PHASE</span><strong>03<span>/ 05</span></strong><span className="phase-name">Local playable prototype</span><div className="phase-track"><i /><i /><i /><i /><i /></div></div>
    </section>
    <div className="notice"><span className="notice-icon">i</span><p><strong>This is a port lab, not a playable game.</strong> Original RNG code runs below. A separate playable prototype now supports a limited local match. The complete Melee engine and online play remain unfinished.</p></div>
  </>;
}

const milestones = [
  ['Foundation', 'Disc validation + C → WASM'],
  ['Asset rendering', 'Original stages + animation'],
  ['Playable prototype', 'Local two-fighter match'],
  ['Expand fidelity', 'Mechanics + four players'],
  ['Online rooms', 'Central relay + rollback'],
] as const;

function Roadmap() {
  return <section className="roadmap" aria-labelledby="roadmap-title"><div className="roadmap-heading"><p className="eyebrow">THE PATH FORWARD</p><h2 id="roadmap-title">Build the foundation. Preserve the game.</h2></div><ol>
    {milestones.map(([title, detail], index) => <li key={title} className={index === 2 ? 'active' : undefined}><span>0{index + 1}</span><strong>{title}</strong><small>{detail}</small></li>)}
  </ol></section>;
}

export function LabApp() {
  return <div className="shell">
    <LabHeader />
    <main><LabIntroduction /><div className="workspace"><RngPanel /><DiscPanel /></div><Roadmap /></main>
    <footer><span>Independent research · Not affiliated with Nintendo or HAL Laboratory.</span><a href="https://github.com/doldecomp/melee" target="_blank" rel="noreferrer">Built on doldecomp/melee ↗</a></footer>
  </div>;
}
