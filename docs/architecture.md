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
The page also shows documents as plain text because the Hackage endpoints do not identify the original file format.
The page shows HTML in package documents as text.

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

## Fixture source

`test/fixtures/text-2.1.4.cabal` contains the published Cabal file from Hackage.
Its BSD license is in `test/fixtures/text-LICENSE`.
The fixture retains the original CRLF line breaks.
