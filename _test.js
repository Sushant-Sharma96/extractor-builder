const { transform } = require('./server/transform');

const sample = `<!doctype html><html><head><title>Acme Analytics</title></head>
<body>
<div id="root">
  <div class="min-h-screen">
    <header class="flex justify-between items-center px-8 py-4 bg-white">
      <nav class="flex items-center gap-6">
        <a href="/" class="font-bold text-xl text-slate-900">Acme</a>
        <a href="/features" class="text-slate-600 hover:text-slate-900">Features</a>
        <a href="/pricing" class="text-slate-600 hover:text-slate-900">Pricing</a>
      </nav>
      <a href="/start" class="bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700">Get started</a>
    </header>

    <section class="px-8 py-24 text-center">
      <h1 class="text-5xl font-bold text-slate-900 mb-6">Analytics that actually make sense</h1>
      <p class="text-lg text-slate-600 mb-8 max-w-2xl mx-auto">Understand your users without a data team.</p>
      <img src="https://cdn.lovable.dev/hero-abc123.png" alt="Product dashboard" class="rounded-xl shadow-xl w-full max-w-4xl mx-auto">
    </section>

    <section class="px-8 py-24 bg-slate-50">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
        <div class="bg-white rounded-xl shadow-md p-6">
          <h3 class="text-xl font-semibold mb-2">Real-time</h3>
          <p class="text-slate-600">See events as they happen.</p>
        </div>
        <div class="bg-white rounded-xl shadow-md p-6">
          <h3 class="text-xl font-semibold mb-2">Private</h3>
          <p class="text-slate-600">Your data stays yours.</p>
        </div>
        <div class="bg-white rounded-xl shadow-md p-6">
          <h3 class="text-xl font-semibold mb-2">Fast</h3>
          <p class="text-slate-600">Loads in milliseconds.</p>
        </div>
      </div>
    </section>

    <footer class="px-8 py-12 bg-slate-900 text-slate-400 text-center">
      <p>© 2025 Acme Inc.</p>
    </footer>
  </div>
</div>
</body></html>`;

const out = transform(sample);
console.log('SUMMARY:', out.sectionsSummary);
console.log('\n===== HTML =====\n');
console.log(out.html);
console.log('\n===== CSS =====\n');
console.log(out.css);
