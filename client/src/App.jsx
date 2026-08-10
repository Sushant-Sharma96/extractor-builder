import { useState, useEffect } from 'react';

const API = '/api/convert';
/** Locked product path — dual-path auto (classifier routes A/B; no user mode picker). */
const EMIT_MODE = 'auto';

export default function App() {
  const [url, setUrl] = useState('');
  const [figmaUrl, setFigmaUrl] = useState('');
  const [figmaToken, setFigmaToken] = useState('');
  const [forceRefresh, setForceRefresh] = useState(false);
  // Phase 5 opt-in renderer toggle (docs/COMPILER_MIGRATION_BLUEPRINT.md) — UI wiring
  // only; default stays 'legacy', matching emitArtifacts()'s own default. Persisted
  // to localStorage — plain useState here silently reset to 'legacy' on every
  // reload/remount, so a page refresh mid-session would flip the next Generate
  // back to legacy with no visible change to the (still-showing) selected pill.
  const [renderer, setRenderer] = useState(() => {
    try {
      const saved = localStorage.getItem('stripmine.renderer');
      return saved === 'ir-experimental' ? 'ir-experimental' : 'legacy';
    } catch {
      return 'legacy';
    }
  });

  useEffect(() => {
    try { localStorage.setItem('stripmine.renderer', renderer); } catch { /* ignore */ }
  }, [renderer]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [tab, setTab] = useState('preview');
  const [showToken, setShowToken] = useState(false);

  async function convert(overrides = {}) {
    const fig = figmaUrl.trim();
    const lov = url.trim();
    if (!fig && !lov) {
      setError({ message: 'Paste a Figma or Lovable URL to generate.' });
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    const refresh = overrides.refresh != null ? overrides.refresh : forceRefresh;
    const force = overrides.force === true;
    try {
      const isFigma = !!fig;
      const res = await fetch(isFigma ? '/api/figma/convert' : API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isFigma
            ? {
              url: fig,
              token: figmaToken.trim() || undefined,
              emitMode: EMIT_MODE,
              refresh: refresh || undefined,
              force: force || undefined,
              renderer,
            }
            : { url: lov, format: 'dev' },
        ),
      });
      const raw = await res.text();
      let data = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        throw Object.assign(new Error(
          raw
            ? `Server returned non-JSON (HTTP ${res.status}).`
            : `Empty response (HTTP ${res.status}). Retry Generate.`,
        ), { status: res.status });
      }
      if (!res.ok) {
        const msg = (data && (data.message || data.error)) || 'Conversion failed.';
        throw Object.assign(new Error(msg), {
          status: res.status,
          errorCode: data && data.errorCode,
          budget: data && data.budget,
          cache: data && data.cache,
        });
      }
      if (!data) throw new Error('Server returned empty JSON.');
      setResult(data);
      setTab(data.previewUrl ? 'preview' : 'html');
    } catch (e) {
      setError({
        message: e.message,
        status: e.status,
        errorCode: e.errorCode,
        budget: e.budget,
        cache: e.cache,
      });
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') convert();
  }

  const scriptText = result?.scripts?.['script.js'] || result?.js || '';
  const isBudgetError = error && (
    error.errorCode === 'BUDGET_DENY'
    || error.errorCode === 'BUDGET_QUEUE'
    || /Tier-1|soft-limit|Budget/i.test(error.message || '')
  );
  const cacheStatus = result?.cache?.status || '';
  const grade = result?.layoutReport?.quality?.grade;
  const hasFigma = !!figmaUrl.trim();

  return (
    <div className="page">
      <header className="masthead">
        <div className="masthead-top">
          <span className="eyebrow">
            <span className="eyebrow-dot" aria-hidden />
            Figma → production HTML
          </span>
          <span className="mode-lock" title="Dual-path auto: Auto Layout → flex; freeform → scaled artboard">
            Dual-path · auto
          </span>
        </div>
        <div className="mark">
          <span className="brace">{'{'}</span>
          <span className="wordmark">stripmine</span>
          <span className="brace">{'}'}</span>
        </div>
        <p className="tagline">
          Paste a Figma URL and generate self-contained HTML, CSS, and assets.
        </p>
      </header>

      <section className="console">
        <div className="stack-field">
          <label className="stack-label" htmlFor="figma-url">Figma URL</label>
          <div className="row">
            <input
              id="figma-url"
              className="url-input"
              type="url"
              inputMode="url"
              placeholder="https://www.figma.com/design/…?node-id=…"
              value={figmaUrl}
              onChange={(e) => setFigmaUrl(e.target.value)}
              onKeyDown={onKeyDown}
              autoFocus
            />
            <button className="run" type="button" onClick={() => convert()} disabled={loading}>
              {loading ? 'Generating…' : 'Generate'}
            </button>
          </div>
        </div>

        <div className="stack-field stack-field--secondary">
          <label className="stack-label" htmlFor="lovable-url">Lovable URL <span className="optional">optional</span></label>
          <input
            id="lovable-url"
            className="url-input"
            type="url"
            inputMode="url"
            placeholder="https://your-project.lovable.app"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>

        {hasFigma && (
          <div className="toolbar">
            <button
              type="button"
              className={`toggle ${forceRefresh ? 'on' : ''}`}
              aria-pressed={forceRefresh}
              onClick={() => setForceRefresh((v) => !v)}
            >
              <span className="toggle-track" aria-hidden>
                <span className="toggle-knob" />
              </span>
              <span className="toggle-copy">
                <strong>Force refresh</strong>
                <small>{forceRefresh ? 'Uses Figma API quota' : 'Uses cache when available'}</small>
              </span>
            </button>

            <div className="renderer-select" role="radiogroup" aria-label="Renderer">
              <button
                type="button"
                role="radio"
                aria-checked={renderer === 'legacy'}
                className={`renderer-option ${renderer === 'legacy' ? 'active' : ''}`}
                onClick={() => setRenderer('legacy')}
              >
                Legacy
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={renderer === 'ir-experimental'}
                className={`renderer-option ${renderer === 'ir-experimental' ? 'active' : ''}`}
                onClick={() => setRenderer('ir-experimental')}
                title="Diagnostic opt-in renderer — does not yet match legacy output byte-for-byte"
              >
                IR Experimental
              </button>
            </div>

            <button
              type="button"
              className="linkish"
              onClick={() => setShowToken((v) => !v)}
            >
              {showToken ? 'Hide token' : 'Token / Connect'}
            </button>
          </div>
        )}

        {hasFigma && showToken && (
          <div className="stack-field">
            <label className="stack-label" htmlFor="figma-token">Figma token</label>
            <div className="row">
              <input
                id="figma-token"
                className="url-input"
                type="password"
                placeholder="Optional — .env FIGMA_TOKEN used if empty"
                value={figmaToken}
                onChange={(e) => setFigmaToken(e.target.value)}
              />
              <a className="run secondary" href="/api/figma/login">Connect</a>
            </div>
          </div>
        )}

        {error && (
          <div className={`alert ${isBudgetError ? 'alert--budget' : 'alert--error'}`} role="alert">
            <p className="alert-title">
              {isBudgetError ? 'Quota soft-limit' : 'Conversion failed'}
            </p>
            <p className="alert-body">{error.message}</p>
            {isBudgetError && (
              <div className="alert-actions">
                <button
                  type="button"
                  className="run secondary"
                  disabled={loading}
                  onClick={() => {
                    setForceRefresh(false);
                    convert({ refresh: false, force: false });
                  }}
                >
                  Retry with cache
                </button>
                <button
                  type="button"
                  className="run"
                  disabled={loading}
                  onClick={() => convert({ refresh: forceRefresh, force: true })}
                >
                  Force convert
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {result && (
        <section className="results">
          <div className="status-bar" role="status">
            <span className={`status-pill ${grade === 'A' ? 'ok' : grade === 'C' ? 'warn' : ''}`}>
              Quality {grade || '—'}
            </span>
            <span className="status-pill ok">Flex</span>
            <span className={`status-pill ${/HIT|SUBTREE/i.test(cacheStatus) ? 'ok' : /MISS/i.test(cacheStatus) ? 'miss' : ''}`}>
              Cache {cacheStatus || '—'}
            </span>
            {result.renderer && (
              <span className={`status-pill ${result.renderer === 'ir-experimental' ? 'warn' : ''}`}>
                Renderer {result.renderer === 'ir-experimental' ? 'IR Experimental' : 'Legacy'}
              </span>
            )}
            {result.rendererSwitchedFrom && (
              <span
                className="status-pill warn"
                title={`This output folder previously held '${result.rendererSwitchedFrom}' output — it was just overwritten by this '${result.renderer}' compile.`}
              >
                ⚠ overwrote {result.rendererSwitchedFrom} output
              </span>
            )}
            {result.output?.assets != null && (
              <span className="status-pill">{result.output.assets} assets</span>
            )}
            <p className="status-note">
              {result.layoutReport?.quality?.summary
                || 'Ready — check Preview against Figma.'}
            </p>
          </div>

          <div className="meta">
            {result.sectionsSummary && (
              <>
                <span className="chip">Sections</span>
                <span className="sections">{result.sectionsSummary}</span>
              </>
            )}
            {result.output?.dir && (
              <>
                <span className="chip">Output</span>
                <span className="sections path">{result.output.dir}</span>
              </>
            )}
            <span className="spacer" />
            <span className="render-mode">
              {/HIT|SUBTREE/i.test(cacheStatus) ? '0 Figma REST · cache' : 'live fetch'}
            </span>
          </div>

          <div className="preview-shell">
            <div className="tabs">
              {result.previewUrl && (
                <button className={tab === 'preview' ? 'tab active' : 'tab'} onClick={() => setTab('preview')}>
                  Preview
                </button>
              )}
              <button className={tab === 'html' ? 'tab active' : 'tab'} onClick={() => setTab('html')}>
                HTML
              </button>
              <button className={tab === 'css' ? 'tab active' : 'tab'} onClick={() => setTab('css')}>
                CSS
              </button>
              {scriptText && (
                <button className={tab === 'js' ? 'tab active' : 'tab'} onClick={() => setTab('js')}>
                  JS
                </button>
              )}
              <span className="spacer" />
              {tab === 'preview' && result.previewUrl ? (
                <a className="copy" href={result.previewUrl} target="_blank" rel="noreferrer">Open ↗</a>
              ) : (
                <CopyButton
                  text={tab === 'html' ? result.html : tab === 'css' ? result.css : scriptText}
                  label="Copy"
                />
              )}
            </div>

            {tab === 'preview' && result.previewUrl ? (
              <iframe
                key={result.previewUrl + (result.compiler?.artifactFingerprint || '')}
                className="preview-frame"
                src={`${result.previewUrl}${result.previewUrl.includes('?') ? '&' : '?'}v=${encodeURIComponent(result.compiler?.artifactFingerprint || Date.now())}`}
                title="Converted design preview"
                referrerPolicy="no-referrer"
              />
            ) : (
              <pre className="code"><code>{
                tab === 'html' ? result.html
                  : tab === 'css' ? result.css
                    : scriptText
              }</code></pre>
            )}
          </div>
        </section>
      )}

      <footer className="foot">
        After the first generate, leave Force refresh off — re-runs use cache only.
      </footer>
    </div>
  );
}

function CopyButton({ text, label }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }
  return (
    <button className="copy" onClick={copy}>
      {copied ? 'Copied ✓' : label}
    </button>
  );
}
