# Package metadata

The site is a Cloudflare Worker with static assets.
The Worker renders the site pages and supplies the search, package, Cabal file, document, and import APIs.
The static assets supply the stylesheet, the scripts, the fonts, and the shell page.
D1 stores package versions and the search and dependency indexes.
R2 stores immutable Cabal files, JSON metadata, READMEs, and changelogs.

## Parser

The Haskell program uses `aihc-cabal-syntax` 2.0.0.0.
It reads Cabal source from stdin and writes one JSON value to stdout.
AIHC compiles the program to a WASI P3 component.
`jco-transpile` 0.16.0 produces JavaScript and core Wasm modules.
The Worker imports the core Wasm modules at build time.
Each parser call has separate stdin, stdout, and component state.

The metadata retains conditional branches.
The dependency index includes every branch and its condition.
A reverse dependency means that an imported Cabal file names the package.
It does not prove that a dependency solver can select the viewed version.
The module list includes exposed modules from every branch.
The site contains imported versions only.

## Imports

Imports are public.
The form requires an exact package name and numeric version.
The Worker can download only Cabal files and package documents from `hackage.haskell.org`.
It rejects redirects and files above one MiB.
It checks the parsed name and version before any write.
The request limit is ten imports per minute per IP address and Cloudflare location.

R2 keys contain the SHA-256 digest of the source.
The Worker stores both objects before it changes D1.
One D1 transaction replaces a version and its dependency index.
A repeated import can retrieve a revised Cabal file.
Old immutable objects stay in R2 for source history.

## Package documents

Imports download documents from `/package/{name}-{version}/readme.txt` and `/package/{name}-{version}/changelog.txt` on Hackage.
Hackage extracts these documents from the package source archive.
The Worker rejects redirects and limits each document to one MiB.
Each download has a 15-second timeout.
The Worker stores document bytes in R2 under keys that contain their SHA-256 digest.

The `package_documents` table stores document keys and status separately from Cabal metadata.
The status is `available`, `missing`, or `failed`.
A Hackage 404 response gives `missing` status.
Other download failures give `failed` status and do not stop the Cabal import.
Storage failures stop the import before the database changes.

One D1 transaction writes the release, dependencies, and document references after all R2 writes finish.
Repeated imports use saved `available` and `missing` results.
They try `failed` downloads again.
Existing releases without document records have `not_imported` status in the package API.
Import the version again to download its documents.

The package API includes status and digest information for both documents.
The `/api/readme/{name}/{version}` and `/api/changelog/{name}/{version}` APIs serve saved document bytes as plain text.
The Hackage endpoints do not identify the original file format.
The page shows a README as Markdown and a changelog as plain text.
`src/markdown.js` renders the Markdown as HTML text and escapes the source text. It does not parse HTML.
The page shows HTML in package documents as text.
The content security policy lets the page load images from HTTPS addresses.
The page loads Markdown images over HTTPS and does not send a referrer.
The page shows the alternative text for an image with a relative address.

## Site design

The site uses the AIHC colors, fonts, mark, and favicon from the blog and the manual.
The page loads Inter and Newsreader from `public/fonts`.
Each font file name contains the first eight characters of the SHA-256 digest of the file.
The `public/_headers` file gives `/fonts/*` a one-year immutable cache.
Change the file name and all references when you change a font file.
The font faces use `font-display: optional`, so the browser does not change fonts after the first paint.
Both pages preload both font files.
`public/theme.js` sets the theme before the page draws.
The theme button cycles through the system, light, and dark modes, as in the manual.
The shell page uses the same header, footer, stylesheet, and theme script as the package pages.
The browser stores the selected mode under the `aihc-theme` key.

The home page shows the package search first.
The import form is in a dialog.
The footer link and the empty search results open this dialog.

The package page shows the package name, version, and synopsis.
Tabs show the description, README, API, dependencies, dependents, changelog, and Cabal fields.
Each tab has a URL, for example `/package/text/2.1.4/readme`.
A search has a URL, for example `/search?q=Data.Text`.
The Worker renders the home page, the search page, and the package pages with the templates in `src/pages.js`.
`src/html.js` escapes all values in the templates.
Each page has a title, a description, a canonical link, and Open Graph fields for link previews.
Search pages and error pages have a `noindex` robots field.
`/sitemap.xml` lists all imported versions and `/robots.txt` points to it.
A page response has a one-minute browser cache. An error page has no cache.
The pages work without scripts.
`public/app.js` adds the import dialog and shows search results while the visitor types.
The README tab opens first if the README is available.
Otherwise, the description tab opens first.
`src/haddock.js` renders the Haddock markup in package descriptions as HTML text.
A line that contains only a period starts a new paragraph.

## Development

Use Node.js 24, Nix, Git, and Just.
Build the components on Linux with an x86-64 or ARM64 processor.
On macOS, download the `worker-build` artifact from a successful continuous integration (CI) run into the checkout.
Run `npm ci`, then continue at step 3.

1. Run `npm ci`.
2. Run `just build`.
3. Run `just check`.
4. Run `npx wrangler d1 migrations apply DB --local`.
5. Run `npm run dev`.

The lock files `parser/aihc.lock` and `haddock/aihc.lock` fix dependency versions and Cabal revisions.
The tests use Cabal fixtures through the real Wasm parser.
Worker tests use local D1 and R2 and a fixture source for Hackage requests.

### Nix builds

A Nix derivation specifies build inputs and outputs.
`flake.lock` fixes both compiler revisions and their Nix dependencies.
The `parser` and `haddock` derivations compile the Wasm components separately.
The `parser-assets` and `haddock-assets` derivations produce JavaScript, core Wasm modules, and browser archives.
The `toolchain` derivation supplies the compressed browser C toolchain.
`shell/toolchain.json` fixes its revision and SHA-256 digests.

The `components` derivation collects these outputs.
The `parser-style` derivation checks Haskell formatting and lint rules.
CI also caches this check, so unchanged parser sources do not need the lint tools again.

Run `nix build .#components` to build all component assets.
Run `scripts/build-components.sh` to also copy these assets into the checkout.
`just build` uses this script, then builds the browser shell.
The parser and Haddock build scripts select their separate asset derivations.
Repeated commands reuse the Nix store outputs.
Changes to site pages, styles, or Worker code do not change these derivations.

`nix/sources.json` records hashes for every locked Hackage archive and Cabal revision.
Nix downloads these files before compilation.
`nix/hackage-cache.py` prepares an index that contains only the locked Cabal revisions.
The compiler uses this index and the downloaded sources with `--locked`.
The CI build sandbox prevents network access during compilation.
The build does not run `cabal update` or download the full Hackage index.

After a dependency lock change, run `python3 scripts/update-nix-sources.py`.
Review the changed hashes with the changed lock entries.
After an npm dependency change, update `npmDepsHash` in `flake.nix` with the result from `prefetch-npm-deps package-lock.json`.
Run `python3 -m unittest discover -s test -p '*_test.py'` with Python 3.12 or later to check dependency coverage and index offsets.

## Deployment

The `main` branch requires a PR and the `check` status.
The rule applies to administrators.
Each push to `main` runs checks and deploys the checked build.
GitHub Actions stores the Nix component outputs in a binary cache.
Its key includes the compiler locks, component sources, dependency hashes, and asset build scripts.
An exact cache match restores the outputs without compiler evaluation or compilation.
A partial match lets Nix reuse unchanged component outputs.
When the cache key changes, CI restores the larger compiler dependency cache.
Nix then builds only outputs that are absent from the restored store.

The check job uploads the generated modules, parser component, and complete static asset directory.
The deployment job downloads this artifact and runs `npm run deploy:built`.
It does not rebuild the shell or download the browser toolchain.
The deployment applies D1 migrations before it deploys the Worker and static assets.
The workflow uses the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
The account ID is not confidential and can also come from the Worker configuration.

The token needs Workers Scripts Edit, D1 Edit, and Workers R2 Storage Write.
Custom domain setup also needs the applicable zone permissions.
The site domain is `hackage.aihc.app`.

No compiler progress counts change in this repository.

## Browser shell

The `/shell/` page supplies a browser WASI environment.
WASI is the WebAssembly System Interface.
The page uses the browser WebAssembly engine and xterm.js terminal.
The shell source is in `shell/`.
Run `npm run build:shell` to build the static files.
The normal build and check commands also build these files.
The local deployment command builds the shell before deployment.
CI deploys the static files from the check job.

Each WASI Preview 1 command runs in a separate Web Worker.
A Web Worker runs JavaScript on a separate browser thread.
Each process has separate memory, arguments, environment variables, and file descriptors.
The shell supplies small JavaScript file utilities through the same process system.
The runtime uses `browser_wasi_shim` for WASI calls.
It does not emulate Linux.

The page keeps one filesystem for all processes in the session.
File descriptors refer to shared filesystem objects.
Workers send filesystem requests to the page through messages.
A shared response buffer lets a Worker wait for a synchronous WASI call.
Pipes use bounded shared ring buffers with atomic wait and notification operations.
The `/shell/*` response headers enable cross-origin isolation for these buffers.

The shell supports quotes, pipes, file operators, background jobs, and `wait`.
Foreground programs receive terminal input one line at a time.
Background programs receive closed input unless a pipe or file supplies input.
The Stop button and Ctrl+C terminate foreground Workers.

IndexedDB, the browser file database, stores `/home/user` after commands and uploads.
The page uses a browser lock to prevent simultaneous writes from separate tabs.
If file storage is not available, the page reports temporary storage.
The `/tmp` directory is temporary.
System directories are read-only.
Upload and download controls transfer files between the computer and the virtual filesystem.
Files remain in the browser and are not sent to the server.

Clang 8.0.1, LLD, and their WASI system files come from a fixed `binji/wasm-clang` revision.
The build checks SHA-256 digests before it compresses these assets.
The browser loads the toolchain from this site when a compiler command first needs it.
The runtime adapts the older WASI interface used by this toolchain.

The `clang` command supports one C source file, object output, optimization levels, and include and definition options.
The shell starts Clang and LLD as separate processes for compilation and linking.
Use `clang -cc1` or `wasm-ld` for direct tool access.

The runtime does not include the AIHC compiler, networking, threads, `fork`, or full terminal job control.
Symbolic links and advanced WASI polling are not supported.
Programs that need these interfaces can fail.
The tests compile C, execute the output in Workers, and check pipes, background jobs, and file storage snapshots.

### aihc-haddock

The `aihc-haddock` command is a WASI P3 component, not a Preview 1 module.
`scripts/build-haddock.sh` gets the Haddock assets from Nix and copies `haddock.wasm` into the checkout.
The Nix derivation uses `haddock/aihc.lock` and the compiler revision in `flake.lock`.
It compiles with `--target wasm32-wasip3` and `aihc-haddock -hackage`, so the component does not download the Hackage index.
The index is about 140 MB, which is too large for a browser.
The component derivations support Linux, where the build filesystem is case-sensitive.

`scripts/transpile-haddock.mjs` uses `jco-transpile` to make JavaScript and core Wasm modules.
It writes gzip files to `public/shell/haddock`.
It also writes `core-libs.tar.gz`, which holds the AIHC core library sources.
The package planner needs these sources.
The component cannot read environment variables, so the shell mounts the sources at `/core-libs`.

The shell compiles the core modules once for each page and sends them to a new Web Worker for each command.
`shell/haddock-worker.js` runs the component with the host in `shell/haddock-host.js`.
The host supplies the `wasi:cli`, `wasi:clocks`, and `wasi:filesystem` interfaces.
It does not supply a network.
The browser must support WebAssembly JSPI, which the generated component uses.

The Worker copies the files under the shell directory into an in-memory filesystem.
This directory becomes the root of that filesystem, because the component resolves relative paths against the root.
The command cannot read files outside this directory.
When the command ends, the shell copies the new and changed files back to the shell filesystem.
The command writes standard output to a pipe or to the terminal.
The command does not read standard input.

The `hackage-get NAME-VERSION` shell command downloads a package source archive and unpacks it in the current directory.
It uses the Worker route `/hackage/package/NAME-VERSION/NAME-VERSION.tar.gz`.
Hackage does not send CORS headers, so the browser cannot request it directly.
The route accepts GET and HEAD requests for source archives and Cabal files only.
It rejects redirects and files above 64 MiB.
It does not serve the Hackage index.

Without the Hackage index, the command cannot find dependencies.
Each dependency that is not an AIHC core library must be in a subdirectory of the current directory.
Use `hackage-get` for each dependency, then use `aihc-haddock build NAME-VERSION --no-deps`.
The tests run the component through the shell in Node.js 24.

## Fixture source

`test/fixtures/text-2.1.4.cabal` contains the published Cabal file from Hackage.
Its BSD license is in `test/fixtures/text-LICENSE`.
The fixture retains the original CRLF line breaks.
