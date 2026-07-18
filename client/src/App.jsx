import { useState } from 'react';

const API = '/api/convert';

export default function App() {
  const [url, setUrl] = useState('');
  const [figmaUrl, setFigmaUrl] = useState('');
  const [figmaToken, setFigmaToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [tab, setTab] = useState('preview');

  async function convert() {
    const fig = figmaUrl.trim();
    const lov = url.trim();
    if (!fig && !lov) {
      setError('Paste a Lovable URL or a Figma design URL.');
      return;
    }
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const isFigma = !!fig;
      const res = await fetch(isFigma ? '/api/figma/convert' : API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isFigma
            ? { url: fig, token: figmaToken.trim() || undefined }
            : { url: lov, format: 'dev' },   // developer mode (v1 semantic pipeline) + live preview
        ),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Conversion failed.');
      setResult(data);
      setTab(data.previewUrl ? 'preview' : 'html');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') convert();
  }

  const scriptText = result?.scripts?.['script.js'] || result?.js || '';

  return (
    <div className="page">
      <header className="masthead">
        <div className="mark">
          <span className="brace">{'{'}</span>
          <span className="wordmark">stripmine</span>
          <span className="brace">{'}'}</span>
        </div>
        <p className="tagline">
          Paste a Lovable URL. Get a self-contained static site — semantic HTML,
          styles.css, script.js, and downloaded assets.
        </p>
      </header>

      <section className="console">
        <div className="prompt-row">
          <span className="prompt-sigil">→</span>
          <input
            className="url-input"
            type="url"
            inputMode="url"
            placeholder="https://your-project.lovable.app  (Lovable URL)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Lovable URL"
          />
        </div>

        <div className="prompt-row">
          <span className="prompt-sigil">◈</span>
          <input
            className="url-input"
            type="url"
            inputMode="url"
            placeholder="https://www.figma.com/design/…?node-id=…  (Figma URL)"
            value={figmaUrl}
            onChange={(e) => setFigmaUrl(e.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Figma URL"
          />
          <button className="run" onClick={convert} disabled={loading}>
            {loading ? 'Generating…' : 'Generate'}
          </button>
        </div>

        {figmaUrl.trim() && (
          <div className="prompt-row figma-auth">
            <span className="prompt-sigil" aria-hidden="true"> </span>
            <input
              className="url-input"
              type="password"
              placeholder="Figma Personal Access Token (or leave blank if connected / set in .env)"
              value={figmaToken}
              onChange={(e) => setFigmaToken(e.target.value)}
              aria-label="Figma token"
            />
            <a className="run secondary" href="/api/figma/login">Connect Figma</a>
          </div>
        )}

        <p className="hint">
          Paste a <strong>Lovable</strong> URL <em>or</em> a <strong>Figma</strong> design URL and click Generate.
          Figma needs a token — paste one, set <code>FIGMA_TOKEN</code> in <code>.env</code>, or click Connect Figma.
        </p>

        {error && <p className="error" role="alert">{error}</p>}
      </section>

      {result && (
        <section className="results">
          <div className="meta">
            <span className="chip">Sections</span>
            <span className="sections">{result.sectionsSummary || '—'}</span>
            {result.output?.dir && (
              <>
                <span className="chip">Output</span>
                <span className="sections">{result.output.dir}</span>
              </>
            )}
            {result.output?.assets != null && (
              <>
                <span className="chip">Assets</span>
                <span className="sections">{result.output.assets} downloaded</span>
              </>
            )}
            <span className="spacer" />
            {result.pipeline && (
              <span className="render-mode" style={{ marginRight: 12, fontWeight: 700, color: result.pipeline === 'v2' ? '#4ade80' : '#f59e0b' }}>
                pipeline: {result.pipeline}
              </span>
            )}
            <span className="render-mode">
              rendered via {result.renderMode === 'headless' ? 'headless browser' : 'direct fetch'}
            </span>
          </div>

          <div className="tabs">
            {result.previewUrl && (
              <button className={tab === 'preview' ? 'tab active' : 'tab'} onClick={() => setTab('preview')}>
                ▶ preview
              </button>
            )}
            <button className={tab === 'html' ? 'tab active' : 'tab'} onClick={() => setTab('html')}>
              index.html
            </button>
            <button className={tab === 'css' ? 'tab active' : 'tab'} onClick={() => setTab('css')}>
              styles.css
            </button>
            {scriptText && (
              <button className={tab === 'js' ? 'tab active' : 'tab'} onClick={() => setTab('js')}>
                script.js
              </button>
            )}
            <span className="spacer" />
            {tab === 'preview' ? (
              <a className="copy" href={result.previewUrl} target="_blank" rel="noreferrer">Open in new tab ↗</a>
            ) : (
              <CopyButton
                text={tab === 'html' ? result.html : tab === 'css' ? result.css : scriptText}
                label={`Copy ${tab === 'html' ? 'HTML' : tab === 'css' ? 'CSS' : 'script.js'}`}
              />
            )}
          </div>

          {tab === 'preview' ? (
            <iframe
              className="preview-frame"
              src={result.previewUrl}
              title="Generated site preview"
              style={{ width: '100%', height: '70vh', border: '1px solid #2a2a2a', borderRadius: 8, background: '#fff' }}
            />
          ) : (
            <pre className="code"><code>{
              tab === 'html' ? result.html
                : tab === 'css' ? result.css
                  : scriptText
            }</code></pre>
          )}
        </section>
      )}

      <footer className="foot">
        Reads each site&apos;s own compiled CSS via headless Chromium — no API key required.
        Copy the files or grab the bundle from the server output folder.
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
