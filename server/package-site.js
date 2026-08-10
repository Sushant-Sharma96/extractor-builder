// package-site.js
// Writes a self-contained per-site bundle: index.html, styles.css, script.js,
// assets/ (downloaded images, de-duplicated), and a README.md manifest.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function slugifyUrl(url) {
  try {
    const u = new URL(url);
    return (u.hostname.split('.')[0] || 'site').replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  } catch { return 'site'; }
}

const EXT_BY_TYPE = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/webp': '.webp',
  'image/gif': '.gif', 'image/svg+xml': '.svg', 'image/avif': '.avif', 'image/x-icon': '.ico',
};

async function downloadAssets(assetUrls, assetsDir, { localByUrl = null, fetchRemote = true } = {}) {
  const map = new Map(); // originalUrl -> relative path (assets/xxx)
  if (!assetUrls || !assetUrls.length) return map;
  fs.mkdirSync(assetsDir, { recursive: true });
  const usedNames = new Set();
  const urls = [...new Set(assetUrls.filter((u) => /^https?:/i.test(u)))];

  async function one(url) {
    try {
      let buf;
      let type = '';
      const localPath = localByUrl && (localByUrl[url] || localByUrl.get && localByUrl.get(url));
      if (localPath && fs.existsSync(localPath)) {
        buf = fs.readFileSync(localPath);
        type = EXT_BY_TYPE[path.extname(localPath).toLowerCase()]
          ? Object.keys(EXT_BY_TYPE).find((k) => EXT_BY_TYPE[k] === path.extname(localPath).toLowerCase()) || ''
          : '';
        if (!type) {
          const ext = path.extname(localPath).toLowerCase();
          for (const [mime, e] of Object.entries(EXT_BY_TYPE)) if (e === ext) { type = mime; break; }
        }
      } else if (!fetchRemote) {
        return;
      } else {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 20000);
        try {
          const res = await fetch(url, { redirect: 'follow', signal: ctrl.signal });
          if (!res.ok) return;
          buf = Buffer.from(await res.arrayBuffer());
          type = (res.headers.get('content-type') || '').split(';')[0].trim();
        } finally {
          clearTimeout(timer);
        }
      }
      let ext = EXT_BY_TYPE[type] || path.extname(new URL(url).pathname) || '.img';
      if (ext.length > 5) ext = '.img';
      let base = (path.basename(new URL(url).pathname).replace(/\.[^.]*$/, '') || 'asset').replace(/[^a-z0-9-]/gi, '-').slice(0, 40);
      const hash = crypto.createHash('md5').update(url).digest('hex').slice(0, 6);
      let name = `${base}-${hash}${ext}`;
      while (usedNames.has(name)) name = `${base}-${hash}-${Math.random().toString(36).slice(2, 5)}${ext}`;
      usedNames.add(name);
      fs.writeFileSync(path.join(assetsDir, name), buf);
      map.set(url, `assets/${name}`);
    } catch { /* skip unreachable asset */ }
  }

  // Parallel downloads (cap concurrency) — sequential was the main convert hang.
  const concurrency = 8;
  let idx = 0;
  async function worker() {
    while (idx < urls.length) {
      const i = idx;
      idx += 1;
      await one(urls[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, () => worker()));
  return map;
}

function rewriteAssetRefs(html, map) {
  let out = html;
  for (const [url, rel] of map) {
    // HTML attribute values have already been escaped (esc() in
    // materialize-html.js turns "&" into "&amp;"), but `url` here is the raw
    // JS string used to fetch the asset. Figma's signed URLs always contain
    // "&" in the query string, so a raw split/join never matches the escaped
    // HTML and a successfully-downloaded asset was silently left unlinked,
    // falling through to the "download failed" placeholder below. Match both
    // forms.
    out = out.split(url).join(rel);
    const escapedUrl = url.replace(/&/g, '&amp;');
    if (escapedUrl !== url) out = out.split(escapedUrl).join(rel);
  }
  // Failed downloads leave expiring Figma signed URLs.
  // Prefer rewriting to a data-URI thumb over an empty/broken <img>.
  out = out.replace(
    /<img\b([^>]*?)\ssrc="(https:\/\/[^"]*figma\.com[^"]*)"([^>]*)>/gi,
    (full, pre, url, post) => {
      const altM = (pre + post).match(/\salt="([^"]*)"/i);
      const aria = (altM && altM[1]) || 'Event';
      const data = defaultPackageThumb(aria);
      return `<img${pre} src="${data}"${post.replace(/\sdata-asset-missing="true"/gi, '')} data-asset-fallback="true">`;
    }
  );
  out = out.replace(
    /url\(\s*["']?https:\/\/[^)"']*figma\.com[^)"']*["']?\s*\)/gi,
    'none'
  );
  out = out.replace(
    /<img\b([^>]*?)\ssrc=""([^>]*)>/gi,
    (full, pre, post) => {
      const altM = (pre + post).match(/\salt="([^"]*)"/i);
      const aria = altM && altM[1] && altM[1] !== 'Image unavailable' ? altM[1] : 'Event';
      return `<img${pre} src="${defaultPackageThumb(aria)}"${post} data-asset-fallback="true">`;
    }
  );
  // Legacy placeholder divs from older emits → real img with embedded thumb
  out = out.replace(
    /<div class="event-card__image event-card__image--placeholder"[^>]*aria-label="([^"]*)"[^>]*><\/div>/gi,
    (full, aria) => `<img class="event-card__image" src="${defaultPackageThumb(aria)}" alt="${aria}" width="128" height="100" data-asset-fallback="true">`
  );
  return out;
}

function defaultPackageThumb(title) {
  const label = String(title || 'EVENT').slice(0, 18).toUpperCase().replace(/[<>&"]/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="100" viewBox="0 0 128 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#3b1f6e"/><stop offset="55%" stop-color="#6b2d8b"/><stop offset="100%" stop-color="#e07a3a"/></linearGradient></defs><rect width="128" height="100" rx="10" fill="url(#g)"/><text x="64" y="48" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif" font-size="12" font-weight="700">${label}</text><text x="64" y="66" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif" font-size="7" opacity="0.9">Build. Break. Beyond.</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function buildReadme(model, result, assetMap) {
  const lines = [];
  lines.push(`# ${(model.title || 'Converted site').trim()}`);
  lines.push('');
  lines.push(`Static copy of ${model.url}, generated by stripmine.`);
  lines.push('');
  lines.push('## Files');
  lines.push('- `index.html` — clean semantic HTML (Tailwind classes replaced by reusable semantic ones)');
  lines.push('- `styles.css` — design tokens + shared classes + one commented block per section');
  lines.push('- `script.js` — reconstructed interactivity (accordion, tabs, menu, smooth-scroll)');
  lines.push(`- \`assets/\` — ${assetMap.size} downloaded image(s)`);
  lines.push('');
  lines.push('## Sections');
  for (const s of result.sections || []) lines.push(`- ${s.label}`);
  lines.push('');
  lines.push('## Fidelity notes');
  lines.push('- Styles come from the site\'s own compiled CSS, so colors/gradients/responsive/hover match exactly.');
  lines.push('- Interactivity is reconstructed with standard patterns — not a 1:1 React clone.');
  lines.push('- Custom (non-aria) accordions: all content is captured; some panels start expanded.');
  lines.push('- Forms have no backend (wired for UX only). The "Edit with Lovable" badge and analytics are removed.');
  lines.push('');
  return lines.join('\n');
}

async function packageSite(model, result, { outRoot, downloadImages = true, localByUrl = null } = {}) {
  const slug = (model.slug ? String(model.slug).replace(/[^a-z0-9-]/gi, '-').toLowerCase().replace(/^-+|-+$/g, '') : '') || slugifyUrl(model.url);
  const dir = path.join(outRoot, slug);
  const assetsDir = path.join(dir, 'assets');
  fs.mkdirSync(dir, { recursive: true });

  let assetMap = new Map();
  if (downloadImages || localByUrl) {
    assetMap = await downloadAssets(model.assets, assetsDir, {
      localByUrl,
      fetchRemote: downloadImages !== false,
    });
  }
  const html = rewriteAssetRefs(result.html, assetMap);
  const css = rewriteAssetRefs(result.css, assetMap); // Figma bg-image url()s live in CSS
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  fs.writeFileSync(path.join(dir, 'styles.css'), css);
  fs.writeFileSync(path.join(dir, 'script.js'), result.js || '');
  fs.writeFileSync(path.join(dir, 'README.md'), buildReadme(model, result, assetMap));

  return { dir, slug, assets: assetMap.size, html };
}

module.exports = { packageSite, slugifyUrl };
