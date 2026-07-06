// tailwind-map.js
// Translates Tailwind utility classes into plain CSS declarations.
// This is intentionally pragmatic: it covers the utilities that show up on
// ~95% of real marketing pages. Anything unknown is ignored (and logged in
// verbose mode) rather than crashing the whole conversion.

// --- spacing scale (rem) -----------------------------------------------------
const SPACE = {
  0: '0', px: '1px', 0.5: '0.125rem', 1: '0.25rem', 1.5: '0.375rem',
  2: '0.5rem', 2.5: '0.625rem', 3: '0.75rem', 3.5: '0.875rem', 4: '1rem',
  5: '1.25rem', 6: '1.5rem', 7: '1.75rem', 8: '2rem', 9: '2.25rem',
  10: '2.5rem', 11: '2.75rem', 12: '3rem', 14: '3.5rem', 16: '4rem',
  20: '5rem', 24: '6rem', 28: '7rem', 32: '8rem', 36: '9rem', 40: '10rem',
  44: '11rem', 48: '12rem', 52: '13rem', 56: '14rem', 60: '15rem',
  64: '16rem', 72: '18rem', 80: '20rem', 96: '24rem',
};

const FONT_SIZE = {
  xs: ['0.75rem', '1rem'], sm: ['0.875rem', '1.25rem'], base: ['1rem', '1.5rem'],
  lg: ['1.125rem', '1.75rem'], xl: ['1.25rem', '1.75rem'], '2xl': ['1.5rem', '2rem'],
  '3xl': ['1.875rem', '2.25rem'], '4xl': ['2.25rem', '2.5rem'], '5xl': ['3rem', '1'],
  '6xl': ['3.75rem', '1'], '7xl': ['4.5rem', '1'], '8xl': ['6rem', '1'], '9xl': ['8rem', '1'],
};

const FONT_WEIGHT = {
  thin: 100, extralight: 200, light: 300, normal: 400, medium: 500,
  semibold: 600, bold: 700, extrabold: 800, black: 900,
};

const RADIUS = {
  none: '0', sm: '0.125rem', DEFAULT: '0.25rem', md: '0.375rem', lg: '0.5rem',
  xl: '0.75rem', '2xl': '1rem', '3xl': '1.5rem', full: '9999px',
};

const SHADOW = {
  sm: '0 1px 2px 0 rgba(0,0,0,0.05)',
  DEFAULT: '0 1px 3px 0 rgba(0,0,0,0.1), 0 1px 2px -1px rgba(0,0,0,0.1)',
  md: '0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1)',
  lg: '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1)',
  xl: '0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)',
  '2xl': '0 25px 50px -12px rgba(0,0,0,0.25)',
  none: 'none',
};

// A compact slice of Tailwind's default palette. Arbitrary values ([#fff],
// [12px]) and rgb are handled separately, so this only needs the common tokens.
const COLORS = {
  white: '#ffffff', black: '#000000', transparent: 'transparent', current: 'currentColor',
  'slate-50': '#f8fafc', 'slate-100': '#f1f5f9', 'slate-200': '#e2e8f0', 'slate-300': '#cbd5e1',
  'slate-400': '#94a3b8', 'slate-500': '#64748b', 'slate-600': '#475569', 'slate-700': '#334155',
  'slate-800': '#1e293b', 'slate-900': '#0f172a', 'slate-950': '#020617',
  'gray-50': '#f9fafb', 'gray-100': '#f3f4f6', 'gray-200': '#e5e7eb', 'gray-300': '#d1d5db',
  'gray-400': '#9ca3af', 'gray-500': '#6b7280', 'gray-600': '#4b5563', 'gray-700': '#374151',
  'gray-800': '#1f2937', 'gray-900': '#111827', 'gray-950': '#030712',
  'zinc-100': '#f4f4f5', 'zinc-200': '#e4e4e7', 'zinc-400': '#a1a1aa', 'zinc-500': '#71717a',
  'zinc-700': '#3f3f46', 'zinc-800': '#27272a', 'zinc-900': '#18181b', 'zinc-950': '#09090b',
  'neutral-100': '#f5f5f5', 'neutral-200': '#e5e5e5', 'neutral-400': '#a3a3a3',
  'neutral-500': '#737373', 'neutral-700': '#404040', 'neutral-800': '#262626', 'neutral-900': '#171717',
  'red-400': '#f87171', 'red-500': '#ef4444', 'red-600': '#dc2626', 'red-700': '#b91c1c',
  'orange-400': '#fb923c', 'orange-500': '#f97316', 'orange-600': '#ea580c',
  'amber-400': '#fbbf24', 'amber-500': '#f59e0b',
  'yellow-400': '#facc15', 'yellow-500': '#eab308',
  'green-400': '#4ade80', 'green-500': '#22c55e', 'green-600': '#16a34a', 'green-700': '#15803d',
  'emerald-400': '#34d399', 'emerald-500': '#10b981', 'emerald-600': '#059669',
  'teal-400': '#2dd4bf', 'teal-500': '#14b8a6',
  'cyan-400': '#22d3ee', 'cyan-500': '#06b6d4',
  'sky-400': '#38bdf8', 'sky-500': '#0ea5e9', 'sky-600': '#0284c7',
  'blue-400': '#60a5fa', 'blue-500': '#3b82f6', 'blue-600': '#2563eb', 'blue-700': '#1d4ed8',
  'indigo-400': '#818cf8', 'indigo-500': '#6366f1', 'indigo-600': '#4f46e5', 'indigo-700': '#4338ca',
  'violet-400': '#a78bfa', 'violet-500': '#8b5cf6', 'violet-600': '#7c3aed',
  'purple-400': '#c084fc', 'purple-500': '#a855f7', 'purple-600': '#9333ea', 'purple-700': '#7e22ce',
  'fuchsia-500': '#d946ef', 'pink-400': '#f472b6', 'pink-500': '#ec4899', 'pink-600': '#db2777',
  'rose-400': '#fb7185', 'rose-500': '#f43f5e',
};

function color(token) {
  if (!token) return null;
  const arb = token.match(/^\[(.+)\]$/);
  if (arb) return arb[1].replace(/_/g, ' ');
  if (COLORS[token]) return COLORS[token];
  return null;
}

function len(token) {
  if (token == null) return null;
  const arb = token.match(/^\[(.+)\]$/);
  if (arb) return arb[1].replace(/_/g, ' ');
  if (token in SPACE) return SPACE[token];
  if (/^\d+$/.test(token)) return `${Number(token) * 0.25}rem`;
  return null;
}

// Directional padding / margin helpers.
const SIDES = {
  t: ['top'], r: ['right'], b: ['bottom'], l: ['left'],
  x: ['left', 'right'], y: ['top', 'bottom'],
};

function spacingRule(prop, dir, value) {
  const v = len(value);
  if (v == null) return null;
  if (!dir) return { [prop]: v };
  const out = {};
  for (const side of SIDES[dir] || []) out[`${prop}-${side}`] = v;
  return Object.keys(out).length ? out : null;
}

// The main resolver: one utility → declarations object (or null if unknown).
function resolveUtility(u) {
  // padding / margin, e.g. p-4, px-6, mt-2, mx-auto
  let m = u.match(/^(p|m)([trblxy])?-(.+)$/);
  if (m) {
    const prop = m[1] === 'p' ? 'padding' : 'margin';
    if (m[3] === 'auto') {
      if (!m[2]) return { margin: 'auto' };
      const out = {};
      for (const s of SIDES[m[2]] || []) out[`${prop}-${s}`] = 'auto';
      return Object.keys(out).length ? out : null;
    }
    return spacingRule(prop, m[2], m[3]);
  }

  // gap
  m = u.match(/^gap(-[xy])?-(.+)$/);
  if (m) {
    const v = len(m[2]);
    if (v == null) return null;
    if (m[1] === '-x') return { 'column-gap': v };
    if (m[1] === '-y') return { 'row-gap': v };
    return { gap: v };
  }

  // width / height / max-width
  m = u.match(/^(w|h|min-w|min-h|max-w|max-h)-(.+)$/);
  if (m) {
    const map = { w: 'width', h: 'height', 'min-w': 'min-width', 'min-h': 'min-height', 'max-w': 'max-width', 'max-h': 'max-height' };
    const prop = map[m[1]];
    const t = m[2];
    if (t === 'full') return { [prop]: '100%' };
    if (t === 'screen') return { [prop]: prop.includes('width') ? '100vw' : '100vh' };
    if (t === 'auto') return { [prop]: 'auto' };
    if (t === 'fit') return { [prop]: 'fit-content' };
    if (t === 'min') return { [prop]: 'min-content' };
    if (t === 'max') return { [prop]: 'max-content' };
    if (t === 'px') return { [prop]: '1px' };
    const MAXW = { xs: '20rem', sm: '24rem', md: '28rem', lg: '32rem', xl: '36rem', '2xl': '42rem', '3xl': '48rem', '4xl': '56rem', '5xl': '64rem', '6xl': '72rem', '7xl': '80rem', prose: '65ch' };
    if (prop === 'max-width' && MAXW[t]) return { [prop]: MAXW[t] };
    const v = len(t);
    return v == null ? null : { [prop]: v };
  }

  // display / layout
  const DISPLAY = {
    flex: { display: 'flex' }, 'inline-flex': { display: 'inline-flex' },
    grid: { display: 'grid' }, block: { display: 'block' },
    'inline-block': { display: 'inline-block' }, inline: { display: 'inline' },
    hidden: { display: 'none' }, contents: { display: 'contents' }, table: { display: 'table' },
  };
  if (DISPLAY[u]) return DISPLAY[u];

  if (u === 'flex-col') return { 'flex-direction': 'column' };
  if (u === 'flex-row') return { 'flex-direction': 'row' };
  if (u === 'flex-wrap') return { 'flex-wrap': 'wrap' };
  if (u === 'flex-1') return { flex: '1 1 0%' };
  if (u === 'flex-auto') return { flex: '1 1 auto' };
  if (u === 'flex-none') return { flex: 'none' };
  if (u === 'grow') return { 'flex-grow': '1' };
  if (u === 'shrink-0') return { 'flex-shrink': '0' };

  const JUSTIFY = { start: 'flex-start', end: 'flex-end', center: 'center', between: 'space-between', around: 'space-around', evenly: 'space-evenly' };
  m = u.match(/^justify-(.+)$/);
  if (m && JUSTIFY[m[1]]) return { 'justify-content': JUSTIFY[m[1]] };
  const ALIGN = { start: 'flex-start', end: 'flex-end', center: 'center', baseline: 'baseline', stretch: 'stretch' };
  m = u.match(/^items-(.+)$/);
  if (m && ALIGN[m[1]]) return { 'align-items': ALIGN[m[1]] };
  m = u.match(/^justify-items-(.+)$/);
  if (m && ALIGN[m[1]]) return { 'justify-items': ALIGN[m[1]] };
  if (u === 'place-items-center') return { 'place-items': 'center' };
  m = u.match(/^self-(.+)$/);
  if (m && ALIGN[m[1]]) return { 'align-self': ALIGN[m[1]] };
  m = u.match(/^content-(.+)$/);
  if (m && JUSTIFY[m[1]]) return { 'align-content': JUSTIFY[m[1]] };

  // grid columns
  m = u.match(/^grid-cols-(\d+)$/);
  if (m) return { 'grid-template-columns': `repeat(${m[1]}, minmax(0, 1fr))` };
  m = u.match(/^col-span-(\d+)$/);
  if (m) return { 'grid-column': `span ${m[1]} / span ${m[1]}` };

  // position
  const POS = { relative: 'relative', absolute: 'absolute', fixed: 'fixed', sticky: 'sticky', static: 'static' };
  if (POS[u]) return { position: POS[u] };
  m = u.match(/^inset-([xy])-(.+)$/);
  if (m) {
    const v = m[2] === '0' ? '0' : len(m[2]);
    if (v == null) return null;
    if (m[1] === 'x') return { left: v, right: v };
    return { top: v, bottom: v };
  }
  m = u.match(/^(top|right|bottom|left|inset)-(.+)$/);
  if (m) {
    const v = m[2] === 'auto' ? 'auto' : (m[2] === '0' ? '0' : len(m[2]));
    if (v == null) return null;
    if (m[1] === 'inset') return { top: v, right: v, bottom: v, left: v };
    return { [m[1]]: v };
  }
  m = u.match(/^z-(\d+|auto)$/);
  if (m) return { 'z-index': m[1] };

  // typography
  // typography — font families (incl. arbitrary font-[Family_Name])
  m = u.match(/^font-\[(.+)\]$/);
  if (m) {
    const fam = m[1].replace(/_/g, ' ');
    return { 'font-family': fam.includes(',') ? fam : `"${fam}", sans-serif` };
  }
  const FONT_FAMILY = {
    sans: 'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"',
    serif: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  };
  m = u.match(/^font-(sans|serif|mono)$/);
  if (m) return { 'font-family': FONT_FAMILY[m[1]] };

  m = u.match(/^text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)$/);
  if (m) { const [fs, lh] = FONT_SIZE[m[1]]; return { 'font-size': fs, 'line-height': lh }; }
  m = u.match(/^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/);
  if (m) return { 'font-weight': String(FONT_WEIGHT[m[1]]) };
  if (u === 'italic') return { 'font-style': 'italic' };
  if (u === 'underline') return { 'text-decoration': 'underline' };
  if (u === 'no-underline') return { 'text-decoration': 'none' };
  if (u === 'uppercase') return { 'text-transform': 'uppercase' };
  if (u === 'lowercase') return { 'text-transform': 'lowercase' };
  if (u === 'capitalize') return { 'text-transform': 'capitalize' };
  const TALIGN = { left: 'left', center: 'center', right: 'right', justify: 'justify' };
  m = u.match(/^text-(left|center|right|justify)$/);
  if (m) return { 'text-align': TALIGN[m[1]] };
  const LEADING = { none: '1', tight: '1.25', snug: '1.375', normal: '1.5', relaxed: '1.625', loose: '2' };
  m = u.match(/^leading-(.+)$/);
  if (m) { if (LEADING[m[1]]) return { 'line-height': LEADING[m[1]] }; const v = len(m[1]); return v ? { 'line-height': v } : null; }
  const TRACK = { tighter: '-0.05em', tight: '-0.025em', normal: '0', wide: '0.025em', wider: '0.05em', widest: '0.1em' };
  m = u.match(/^tracking-(.+)$/);
  if (m && TRACK[m[1]]) return { 'letter-spacing': TRACK[m[1]] };

  // text / bg / border colors
  m = u.match(/^text-(.+)$/);
  if (m) { const c = color(m[1]); if (c) return { color: c }; }
  m = u.match(/^bg-(.+)\/(\d+)$/);
  if (m) {
    const token = m[1];
    const c = color(token) || (token === 'background' ? '#fdfcf8' : null);
    if (c) return { 'background-color': c, opacity: String(Number(m[2]) / 100) };
  }
  m = u.match(/^bg-(.+)$/);
  if (m) {
    const c = color(m[1]) || (m[1] === 'background' ? '#fdfcf8' : null);
    if (c) return { 'background-color': c };
  }
  m = u.match(/^border-(.+)$/);
  if (m) {
    const c = color(m[1]) || (m[1] === 'border' ? '#e5e7eb' : null);
    if (c) return { 'border-color': c };
  }

  // borders
  if (u === 'border') return { 'border-width': '1px', 'border-style': 'solid' };
  m = u.match(/^border-([trbl])$/);
  if (m) { const side = { t: 'top', r: 'right', b: 'bottom', l: 'left' }[m[1]]; return { [`border-${side}-width`]: '1px', [`border-${side}-style`]: 'solid' }; }
  m = u.match(/^border-(\d+)$/);
  if (m) return { 'border-width': `${m[1]}px`, 'border-style': 'solid' };

  // radius
  m = u.match(/^rounded(-(t|r|b|l|tl|tr|br|bl))?(-(none|sm|md|lg|xl|2xl|3xl|full))?$/);
  if (m) {
    const size = m[4] ? RADIUS[m[4]] : RADIUS.DEFAULT;
    const corner = m[2];
    if (!corner) return { 'border-radius': size };
    const cornerMap = {
      t: ['top-left', 'top-right'], b: ['bottom-left', 'bottom-right'],
      l: ['top-left', 'bottom-left'], r: ['top-right', 'bottom-right'],
      tl: ['top-left'], tr: ['top-right'], br: ['bottom-right'], bl: ['bottom-left'],
    };
    const out = {};
    for (const c of cornerMap[corner] || []) out[`border-${c}-radius`] = size;
    return out;
  }

  // shadow
  m = u.match(/^shadow(-(sm|md|lg|xl|2xl|none))?$/);
  if (m) return { 'box-shadow': m[2] ? SHADOW[m[2]] : SHADOW.DEFAULT };

  // opacity
  m = u.match(/^opacity-(\d+)$/);
  if (m) return { opacity: String(Number(m[1]) / 100) };

  // backdrop blur
  if (u === 'backdrop-blur' || u === 'backdrop-blur-sm') return { 'backdrop-filter': 'blur(8px)' };
  if (u === 'backdrop-blur-md') return { 'backdrop-filter': 'blur(12px)' };
  if (u === 'backdrop-blur-lg') return { 'backdrop-filter': 'blur(16px)' };

  // overflow
  m = u.match(/^overflow-(hidden|auto|scroll|visible|x-hidden|y-hidden)$/);
  if (m) {
    if (m[1] === 'x-hidden') return { 'overflow-x': 'hidden' };
    if (m[1] === 'y-hidden') return { 'overflow-y': 'hidden' };
    return { overflow: m[1] };
  }

  // object-fit
  m = u.match(/^object-(cover|contain|fill|none)$/);
  if (m) return { 'object-fit': m[1] };

  // cursor
  if (u === 'cursor-pointer') return { cursor: 'pointer' };

  // transition (kept minimal)
  if (u === 'transition' || u.startsWith('transition-')) return { transition: 'all 0.2s ease' };

  return null; // unknown → ignored
}

module.exports = { resolveUtility, COLORS };
