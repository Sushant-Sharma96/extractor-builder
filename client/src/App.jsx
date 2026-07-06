import { useState } from 'react';

const API = '/api/convert';

export default function App() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [tab, setTab] = useState('html');

  async function convert() {
    if (!url.trim()) {
      setError('Paste a Lovable URL first.');
      return;
    }
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), write: true, downloadImages: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Conversion failed.');
      setResult(data);
      setTab('html');
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
            placeholder="https://your-project.lovable.app"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Lovable URL"
          />
          <button className="run" onClick={convert} disabled={loading}>
            {loading ? 'Extracting…' : 'Generate'}
          </button>
        </div>

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
            <span className="render-mode">
              rendered via {result.renderMode === 'headless' ? 'headless browser' : 'direct fetch'}
            </span>
          </div>

          <div className="tabs">
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
            <CopyButton
              text={tab === 'html' ? result.html : tab === 'css' ? result.css : scriptText}
              label={`Copy ${tab === 'html' ? 'HTML' : tab === 'css' ? 'CSS' : 'script.js'}`}
            />
          </div>

          <pre className="code"><code>{
            tab === 'html' ? result.html
              : tab === 'css' ? result.css
                : scriptText
          }</code></pre>
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
