import { useEffect, useRef, useState } from 'react';
import { verifyMeleeDisc, type DiscInfo } from '../../../lib/disc.ts';
import { errorText, localDiscReader } from './local-disc.ts';

function DiscDetails({ info }: { info: DiscInfo | undefined }) {
  return <div id="disc-details" hidden={!info}>
    <dl className="disc-meta"><div><dt>DISC</dt><dd id="disc-id">{info && `${info.gameId} / revision ${info.revision}`}</dd></div><div><dt>FILES INDEXED</dt><dd id="disc-count">{info?.files.length.toLocaleString()}</dd></div><div className="hash-row"><dt>EXECUTABLE SHA-1</dt><dd id="disc-hash">{info?.dolSha1}</dd></div></dl>
    <div className="file-list" id="file-list">{info?.files.slice(0, 8).map((file) => <div key={file.path}><span>{file.path}</span><span>{(file.size / 1024).toFixed(1)} KiB</span></div>)}</div>
  </div>;
}

export function DiscPanel() {
  const lifecycle = useRef<AbortController | undefined>(undefined);
  const inspecting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState('NOT SELECTED');
  const [result, setResult] = useState('Your disc never leaves this device.');
  const [info, setInfo] = useState<DiscInfo>();
  useEffect(() => {
    const controller = new AbortController(); lifecycle.current = controller;
    inspecting.current = false;
    return () => { controller.abort(); lifecycle.current = undefined; };
  }, []);

  async function inspect(file: File) {
    const signal = lifecycle.current?.signal;
    if (!signal || signal.aborted || inspecting.current) return;
    inspecting.current = true; setBusy(true); setStatus('CHECKING'); setInfo(undefined);
    setResult(`Checking ${file.name} locally…`);
    try {
      const verified = await verifyMeleeDisc(localDiscReader(file, signal));
      signal.throwIfAborted();
      setInfo(verified); setStatus('DISC VERIFIED');
      setResult(`${verified.title} · USA v1.02 · executable checksum matches.`);
    } catch (error) {
      if (!signal.aborted) { setStatus('NOT SUPPORTED'); setResult(errorText(error)); }
    } finally {
      if (!signal.aborted) { inspecting.current = false; setBusy(false); }
    }
  }

  return <section className="panel disc-panel" aria-labelledby="disc-title">
    <div className="panel-heading"><div><p className="eyebrow">02 / YOUR DISC</p><h2 id="disc-title">Bring your own Melee.</h2></div><span className={`status${status === 'NOT SUPPORTED' ? ' error' : status === 'DISC VERIFIED' ? '' : ' neutral'}`} id="disc-status" role="status">{status}</span></div>
    <p className="muted">Select your unmodified USA v1.02 ISO. Its header, filesystem, and executable checksum are checked locally.</p>
    <div className={`dropzone${dragging ? ' dragging' : ''}`} id="dropzone" onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => {
      event.preventDefault(); setDragging(false); const file = event.dataTransfer.files[0]; if (file) void inspect(file);
    }}>
      <span className="disc-symbol" aria-hidden="true">◎</span><strong>Drop your disc image here</strong><span className="fine">ISO or GCM · extract 7z archives first</span>
      <label className="file-button">Choose local disc<input value="" id="disc-file" type="file" accept=".iso,.gcm" aria-label="Choose local disc" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void inspect(file); }} /></label>
    </div>
    <p id="disc-result" className="result" role="status">{result}</p>
    <DiscDetails info={info} />
    <div className="privacy"><span>↳</span><p>No upload endpoint. No game assets bundled.<br />Only the byte ranges needed for inspection are read.</p></div>
  </section>;
}
