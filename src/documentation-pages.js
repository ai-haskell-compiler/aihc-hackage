import { layout, packageHref } from './pages.js';
import { html, raw } from './html.js';
import { renderModule } from '../documentation/render.js';

export function builderPage({ name = '', version = '' } = {}) {
  return layout({ title: 'Generate documentation', page: 'builder', noindex: true,
    description: 'Generate Haskell package documentation in your browser and share the result.',
    scripts: ['/builder/assets/app.js'],
    content: html`<section class="builder" id="builder" data-name="${name}" data-version="${version}">
      <div class="builder-heading"><p class="eyebrow">Contribute documentation</p><h1>Documentation starts<br>with a package.</h1>
        <p class="lede">Choose a package. Generate its documentation. Share the result.</p></div>
      <noscript><p>The documentation builder needs JavaScript. You can read published documentation without JavaScript.</p></noscript>
      <div class="builder-layout"><section class="builder-panel" aria-label="Package and build controls">
        <form id="build-form"><div class="builder-fields"><label for="build-name">Package<input id="build-name" name="name" list="build-packages" maxlength="128" required autocomplete="off" placeholder="text" value="${name}"></label>
          <datalist id="build-packages"></datalist><label for="build-version">Version<select id="build-version" name="version" required><option value="${version}">${version || 'Select'}</option></select></label></div>
          <p class="muted" id="build-synopsis">Select an imported package version.</p>
          <p class="builder-note" id="build-capability">Generation runs on your device. Keep this page open until it finishes.</p>
          <div class="builder-actions"><button id="build-start" disabled>Generate documentation</button><button type="button" class="secondary" id="build-cancel" hidden>Cancel</button></div>
        </form>
        <p id="build-status" role="status" aria-live="polite"></p>
        <p id="build-error" role="alert" hidden></p>
        <div id="build-existing" hidden><a id="build-existing-link">Read the saved documentation →</a></div>
        <section id="build-output" hidden aria-label="Generated documentation">
          <p id="build-summary"></p>
          <p class="builder-note">This preview is a community contribution. The service has not verified its content.</p>
          <div class="builder-actions"><button type="button" id="build-upload">Upload documentation</button><button type="button" class="secondary" id="build-download">Download JSON</button><button type="button" class="secondary" id="build-hoogle">Download Hoogle text</button></div>
          <p id="build-saved" class="muted"></p><p id="build-result" role="status"></p>
        </section>
      </section>
      <aside class="builder-stages" aria-label="Build stages"><h2>From source to documentation</h2><ol>
        <li data-stage="plan"><span class="stage-number">1</span><div><strong>Resolve dependencies</strong><p>Fix versions, flags, and the target platform.</p></div></li>
        <li data-stage="download"><span class="stage-number">2</span><div><strong>Download source</strong><p>Check file hashes and reuse saved files.</p></div></li>
        <li data-stage="generate"><span class="stage-number">3</span><div><strong>Generate documentation</strong><p>Run aihc-haddock in your browser.</p></div></li>
        <li data-stage="upload"><span class="stage-number">4</span><div><strong>Preview and upload</strong><p>Share a public community contribution.</p></div></li>
      </ol><p class="muted">Documentation describes Linux on x86-64. The generator can report incomplete results.</p></aside></div>
      <details id="build-details" hidden><summary>Build details</summary><pre id="build-log"></pre></details>
      <section id="build-preview" hidden><label for="build-module">Module<select id="build-module"></select></label><div id="build-preview-content"></div></section>
    </section>` });
}

export function documentationPage(result, selectedName) {
  const modules = result.model.modules.filter(mod => mod.exposed);
  const selected = selectedName ? modules.find(mod => mod.name === selectedName) : modules[0];
  if (selectedName && !selected) return null;
  const base = `/docs/${result.id}`;
  return layout({ title: `${selected?.name || result.name} · ${result.name}-${result.version}`, page: 'documentation',
    noindex: result.provenance !== 'verified', description: `API documentation for ${result.name}-${result.version}.`,
    content: html`<div class="package-head"><a class="back" href="${packageHref(result.name, result.version, 'api')}">← Package details</a>
      <h1 class="package-title">${result.name}<span class="badge">${result.version}</span></h1>
      <p class="builder-note">${result.provenance === 'verified' ? 'Verified build. The service reproduced this documentation.' : 'Community contribution. The service has not verified this documentation.'}
      ${result.diagnostics ? ` The generator reported ${result.diagnostics} diagnostics.` : ''}</p>
      <p class="muted">Target: Linux on x86-64. Some inferred types and resolved links are not available.</p></div>
      <div class="documentation-layout"><nav class="doc-modules" aria-label="Modules"><h2>Modules</h2>${modules.map(mod => html`<a href="${base}/${encodeURIComponent(mod.name)}"${mod === selected ? raw(' aria-current="page"') : ''}>${mod.name}</a>`)}</nav>
      <div>${selected ? renderModule(selected) : html`<p>This result has no exposed modules.</p>`}</div></div>
      <details class="raw"><summary>Build record and source files</summary><p>Generator: <code>${result.plan.generator}</code></p><p>Metadata snapshot: <code>${result.plan.metadataSha256}</code></p>
      <p><a href="/api/docs/plans/${result.plan_id}">Open the dependency plan</a> · <a href="/api/docs/results/${result.id}/model">Download the documentation model</a></p>
      <ul>${result.plan.packages.map(pkg => html`<li>${pkg.name}-${pkg.version} · ${pkg.source === 'core' ? 'Core library' : `Cabal revision ${pkg.revision}`}
        · <a href="/api/docs/objects/${pkg.cabalSha256}">Cabal file</a>${pkg.source === 'hackage' ? html` · <a href="/api/docs/objects/${pkg.archiveSha256}">Source archive</a>` : ''}</li>`)}</ul></details>` });
}
