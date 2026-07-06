// llm-enhance.js
// OPTIONAL. Deterministic conversion (transform.js) works with no API key.
// If you set ANTHROPIC_API_KEY and request enhancement, this sends the
// generated HTML + CSS to Claude for a semantic clean-up pass — better class
// names, tighter structure, more idiomatic CSS. Off by default.

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

async function enhance({ html, css }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set; enhancement unavailable.');

  const system =
    'You are a senior front-end engineer. You are given machine-generated ' +
    'semantic HTML and a global CSS file (already stripped of Tailwind). Improve ' +
    'them: use clearer, reusable class names; remove redundant wrappers; make the ' +
    'CSS idiomatic and DRY; keep the :root token system; keep image src attributes ' +
    'as placeholder filenames; keep the <link rel="stylesheet" href="styles.css"> ' +
    'reference. Do not invent content. Respond with ONLY a JSON object, no prose, ' +
    'no markdown fences: {"html": "...", "css": "..."}.';

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      system,
      messages: [{ role: 'user', content: `HTML:\n\n${html}\n\nCSS:\n\n${css}` }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .replace(/```json|```/g, '')
    .trim();
  try {
    const parsed = JSON.parse(text);
    if (parsed.html && parsed.css) return parsed;
  } catch {
    /* fall through */
  }
  throw new Error('Could not parse enhancement response as JSON.');
}

module.exports = { enhance };
