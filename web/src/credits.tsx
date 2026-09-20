import { memo } from 'react';

/** Pinned upstream references. The decomp commit mirrors third_party/melee.lock.json
 * (and README.md); update all three together on a pin bump. The ACE repo/commit mirror
 * docs/characters/ACE_FIGHTERS.md and docs/characters/ZERO.md. */
export const DECOMP_REPO = 'https://github.com/doldecomp/melee';
export const DECOMP_COMMIT = '0bac93a5ee2f985dac6220bd36ed7078ae6ac0c9';
export const ACE_REPO = 'https://github.com/Chri222k/ACE-BUILD-PUBLIC-';

/** Visible research credits: the decompiled Melee repo and the ACE 2.0 m-ex build this
 * prototype reads code, parameters and fighter data from. No upstream code, game
 * asset, or reference executable is redistributed by this project. */
export const Credits = memo(function Credits() {
  return <details className="credits-block">
    <summary>CREDITS</summary>
    <p><strong>Melee decompilation</strong> — function extraction, parameters and stage/fighter research read the pinned <a href={DECOMP_REPO} target="_blank" rel="noreferrer">doldecomp/melee ↗</a> checkout (<code>{DECOMP_COMMIT.slice(0, 12)}</code>). The upstream tree stays unchanged; only selected original functions compile behind the gameplay bridge.</p>
    <p><strong>ACE 2.0</strong> — the Akaneia-fork m-ex build (<a href={ACE_REPO} target="_blank" rel="noreferrer">Chri222k/ACE-BUILD-PUBLIC- ↗</a>) supplies the modded-fighter reference data (Zero, Toad, Meta Knight, Sonic, Raichu, Charizard, Wolf, Diddy Kong, King Dedede, Wario, Shadow, Blastoise, Lucas, Metal Sonic, Ninten, Daisy, Fay, Sonic BM, Dr. Luigi, Knuckles, Lucina, Lucas TDX, Shadow Mewtwo, Luigi &amp; Boo, Metal Mario, Skull Kid, Chun-Li, Giga Bowser, Tails, Blood Falcon, Wolf SSBU). The extension disc is read locally at the owner&apos;s request and never redistributed.</p>
    <p><strong>Thank you, ACE team and Team Akaneia</strong> — every modded fighter in this roster exists because of the ACE 2.0 build by Chri222k and the ACE contributors, which itself stands on Team Akaneia&apos;s Akaneia build and the m-ex framework. Their characters, animations and move design are their work; this project only reads them from the player&apos;s own copy of the mod and claims no authorship of them.</p>
    <p><strong>Format research</strong> — HSD/archive interpretation follows noclip.website; audio decoding follows vgmstream. Full notices live in <code>third_party/NOTICE.md</code>.</p>
    <p className="credits-fine">Non-profit fan project and independent research prototype. Not affiliated with Nintendo, HAL Laboratory, or the credited projects. Public source availability does not grant redistribution rights.</p>
  </details>;
});
