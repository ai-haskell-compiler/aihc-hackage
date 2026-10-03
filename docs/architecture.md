# Package metadata

The site uses plain JavaScript and Cloudflare Workers static assets.
The Worker supplies the search, package, Cabal file, and import APIs.
D1 stores package versions and the search and dependency indexes.
R2 stores immutable Cabal files and JSON metadata.

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
The Worker can download only Cabal files from `hackage.haskell.org`.
It rejects redirects and files above one MiB.
It checks the parsed name and version before any write.
The request limit is ten imports per minute per IP address and Cloudflare location.

R2 keys contain the SHA-256 digest of the source.
The Worker stores both objects before it changes D1.
One D1 transaction replaces a version and its dependency index.
A repeated import can retrieve a revised Cabal file.
Old immutable objects stay in R2 for source history.

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
