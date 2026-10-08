// Change the ABI when the plan consumer or documentation model changes.
export const GENERATOR = 'aihc-haddock-7b0c8493-web-1';
export const TARGET = 'linux-x86_64';
export const MAX_MODEL = 8 * 1024 * 1024;
export const MAX_SOURCE = 16 * 1024 * 1024;
export const MAX_UNPACKED = 128 * 1024 * 1024;
export const HASH = /^[a-f0-9]{64}$/;
export const NAME = /^(?=.{1,128}$)[A-Za-z0-9]*[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]*[A-Za-z][A-Za-z0-9]*)*$/;
export const VERSION = /^(?=.{1,128}$)\d{1,9}(?:\.\d{1,9})*$/;
export const MODULE = /^[A-Z][A-Za-z0-9_']*(?:\.[A-Z][A-Za-z0-9_']*)*$/;
export const encode = value => new TextEncoder().encode(value);
export async function digest(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
}
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function requireValue(condition, message) { if (!condition) throw new Error(message); }
export function validatePlan(plan) {
  requireValue(plan?.format === 1 && plan.generator === GENERATOR && plan.target === TARGET, 'The plan uses an unsupported generator or target.');
  requireValue(NAME.test(plan.root?.name) && VERSION.test(plan.root?.version) && HASH.test(plan.root?.cabalSha256), 'The plan has an invalid root package.');
  requireValue(HASH.test(plan.metadataSha256) && Number.isSafeInteger(plan.resolvedAt) && plan.resolvedAt > 0, 'The plan has an invalid metadata snapshot.');
  requireValue(Array.isArray(plan.packages) && plan.packages.length > 0 && plan.packages.length <= 256, 'The plan exceeds the package limit.');
  const packages = new Map();
  let total = 0;
  for (const pkg of plan.packages) {
    requireValue(NAME.test(pkg.name) && VERSION.test(pkg.version) && !packages.has(pkg.name), 'The plan has an invalid or duplicate package.');
    requireValue(['core', 'hackage'].includes(pkg.source) && HASH.test(pkg.cabalSha256), 'The plan has an invalid source.');
    requireValue(pkg.flags && typeof pkg.flags === 'object' && !Array.isArray(pkg.flags) && Object.keys(pkg.flags).length <= 128
      && Object.entries(pkg.flags).every(([key, value]) => /^[a-zA-Z0-9_-]{1,128}$/.test(key) && typeof value === 'boolean'), 'The plan has invalid flags.');
    requireValue(Array.isArray(pkg.dependencies) && pkg.dependencies.length <= 256 && new Set(pkg.dependencies).size === pkg.dependencies.length
      && pkg.dependencies.every(name => typeof name === 'string'), 'The plan has invalid dependencies.');
    if (pkg.source === 'hackage') {
      requireValue(Number.isSafeInteger(pkg.revision) && pkg.revision >= 0 && HASH.test(pkg.archiveSha256)
        && Number.isSafeInteger(pkg.archiveSize) && pkg.archiveSize > 0 && pkg.archiveSize <= MAX_SOURCE, 'The source archive exceeds the limit or has no checksum.');
      total += pkg.archiveSize;
    } else requireValue(/^(aihc-(base|internal|prim|rts|template-haskell)|system-cxx-std-lib)$/.test(pkg.name), 'The plan has an unknown core library.');
    packages.set(pkg.name, pkg);
  }
  requireValue(total <= 96 * 1024 * 1024, 'The plan exceeds the total download limit.');
  const root = packages.get(plan.root.name);
  requireValue(root?.version === plan.root.version && root.cabalSha256 === plan.root.cabalSha256 && root.source === 'hackage', 'The root package does not match the plan.');
  const seen = new Set(); const active = new Set();
  function visit(name) {
    requireValue(packages.has(name) && !active.has(name), 'The plan has a missing or circular dependency.');
    if (seen.has(name)) return;
    active.add(name); packages.get(name).dependencies.forEach(visit); active.delete(name); seen.add(name);
  }
  visit(plan.root.name);
  requireValue(seen.size === packages.size, 'The plan contains unused packages.');
  return plan;
}

// Limit all model trees before a renderer visits them.
export function validateModel(model, plan) {
  let nodes = 0;
  function walk(value, depth) {
    requireValue(++nodes <= 200000 && depth <= 48, 'The documentation exceeds the structure limit.');
    if (typeof value === 'string') requireValue(value.length <= 200000, 'The documentation contains text above the size limit.');
    else if (value && typeof value === 'object') for (const child of Object.values(value)) walk(child, depth + 1);
  }
  walk(model, 0);
  requireValue(model?.format_version === 1 && model.name === plan.root.name && model.version === plan.root.version, 'The documentation does not match the package.');
  requireValue(Array.isArray(model.modules) && model.modules.length <= 2000 && Array.isArray(model.dependencies), 'The documentation model is invalid.');
  const root = plan.packages.find(pkg => pkg.name === plan.root.name);
  const deps = root.dependencies.map(name => { const pkg = plan.packages.find(p => p.name === name); return `${pkg.name}-${pkg.version}`; }).sort();
  requireValue(JSON.stringify([...model.dependencies].sort()) === JSON.stringify(deps), 'The documentation dependencies do not match the plan.');
  const names = new Set();
  for (const mod of model.modules) {
    requireValue(MODULE.test(mod.name) && !names.has(mod.name) && typeof mod.exposed === 'boolean', 'The documentation has an invalid or duplicate module.');
    names.add(mod.name);
    requireValue(Array.isArray(mod.decls) && Array.isArray(mod.diagnostics) && mod.diagnostics.every(x => typeof x === 'string')
      && Array.isArray(mod.instances) && (mod.exports === null || Array.isArray(mod.exports)), 'The module model is invalid.');
    function declaration(decl) {
      requireValue(typeof decl.name === 'string' && decl.name.length > 0 && decl.name.length <= 1000
        && ['type', 'value'].includes(decl.namespace)
        && (decl.signature === null || typeof decl.signature === 'string') && Array.isArray(decl.subordinates), 'The declaration model is invalid.');
      try { encodeURIComponent(decl.name); } catch { throw new Error('The declaration name contains invalid Unicode.'); }
      decl.subordinates.forEach(declaration);
    }
    mod.decls.forEach(declaration);
  }
  return model;
}
