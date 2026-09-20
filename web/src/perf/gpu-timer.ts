/** GPU time of the main scene draw via EXT_disjoint_timer_query_webgl2.
 * Queries are asynchronous: results arrive a few frames later through poll(),
 * never forcing a pipeline stall. Unsupported contexts (most mobile browsers,
 * Firefox, Safari) make every call a no-op; disjoint results (context loss,
 * power events) are discarded rather than reported. */

interface TimerQueryExt { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }

const MAX_PENDING = 6;

export class GpuTimer {
  private readonly ext: TimerQueryExt | null;
  private active: WebGLQuery | null = null;
  private readonly pending: WebGLQuery[] = [];
  private readonly free: WebGLQuery[] = [];

  constructor(private readonly gl: WebGLRenderingContext | WebGL2RenderingContext) {
    let ext: TimerQueryExt | null = null;
    try {
      if (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext) ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerQueryExt | null;
    } catch { ext = null; }
    this.ext = ext;
  }

  get supported(): boolean { return this.ext !== null; }

  begin(): void {
    const ext = this.ext;
    if (!ext || this.active || this.pending.length >= MAX_PENDING) return;
    const gl = this.gl as WebGL2RenderingContext;
    const query = this.free.pop() ?? gl.createQuery();
    if (!query) return;
    gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
    this.active = query;
  }

  end(): void {
    const ext = this.ext, query = this.active;
    if (!ext || !query) return;
    (this.gl as WebGL2RenderingContext).endQuery(ext.TIME_ELAPSED_EXT);
    this.pending.push(query); this.active = null;
  }

  /** Reports finished query durations (ms), oldest first. */
  poll(report: (ms: number) => void): void {
    const ext = this.ext;
    if (!ext || !this.pending.length) return;
    const gl = this.gl as WebGL2RenderingContext;
    const disjoint = !!gl.getParameter(ext.GPU_DISJOINT_EXT);
    while (this.pending.length) {
      const query = this.pending[0]!;
      if (!disjoint && !gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;
      this.pending.shift();
      if (!disjoint) report(Number(gl.getQueryParameter(query, gl.QUERY_RESULT)) / 1e6);
      this.free.push(query);
    }
  }

  dispose(): void {
    const gl = this.gl as WebGL2RenderingContext;
    if (this.active && this.ext) { try { gl.endQuery(this.ext.TIME_ELAPSED_EXT); } catch { /* context lost */ } }
    for (const query of [...this.pending, ...this.free, ...(this.active ? [this.active] : [])]) { try { gl.deleteQuery(query); } catch { /* context lost */ } }
    this.pending.length = 0; this.free.length = 0; this.active = null;
  }
}
