import { ViewerControls } from './ViewerControls.tsx';
import { ViewerStage } from './ViewerStage.tsx';
import { useAssetViewer } from './useAssetViewer.ts';
import { Credits } from '../credits.tsx';

function ViewerHeader() {
  return <header className="viewer-header"><a href="/" className="logo">SMASH<span>WEB</span></a><span className="milestone">02 / ORIGINAL ASSETS</span><a className="back-link" href="/play.html">Play prototype ↗</a><a href="/index.html">Port lab ↗</a></header>;
}

export function ViewerApp({ server = false }: { server?: boolean }) {
  const controller = useAssetViewer(server);
  return <><ViewerHeader /><main className="viewer-layout"><ViewerStage controller={controller} server={server} /><ViewerControls controller={controller} /></main><footer className="viewer-footer"><Credits /></footer></>;
}
