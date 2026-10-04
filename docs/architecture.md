# Package metadata

The site uses plain JavaScript and Cloudflare Workers static assets.
The Worker supplies the search, package, Cabal file, document, and import APIs.
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
`public/markdown.js` renders the Markdown as DOM nodes and does not parse HTML.
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
Each tab has a URL, for example `#package/text/2.1.4/readme`.
The README tab opens first if the README is available.
Otherwise, the description tab opens first.
`public/haddock.js` renders the Haddock markup in package descriptions.
A line that contains only a period starts a new paragraph.

## Development

Use Node.js 24, Nix, Git, and Cabal.

1. Run `npm ci`.
2. Run `scripts/build-parser.sh`.
3. Run `npm run build`.
4. Run `just check`.
5. Run `npx wrangler d1 migrations apply DB --local`.
6. Run `npm run dev`.

Set `AIHC_ROOT` to use an existing compiler checkout at the required revision.
The build script otherwise creates a checkout in `.compiler`.
The lock file fixes parser dependency versions and Cabal revisions.
The tests use Cabal fixtures through the real Wasm parser.
Worker tests use local D1 and R2 and a fixture source for Hackage requests.

## Deployment

The `main` branch requires a PR and the `check` status.
The rule applies to administrators.
Each push to `main` runs checks and deploys the checked build.
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
The normal build, check, and deployment commands also build these files.

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

The current runtime does not include AIHC, WASI components, networking, threads, `fork`, or full terminal job control.
Symbolic links and advanced WASI polling are not supported.
Programs that need these interfaces can fail.
The tests compile C, execute the output in Workers, and check pipes, background jobs, and file storage snapshots.

## Fixture source

`test/fixtures/text-2.1.4.cabal` contains the published Cabal file from Hackage.
Its BSD license is in `test/fixtures/text-LICENSE`.
The fixture retains the original CRLF line breaks.
