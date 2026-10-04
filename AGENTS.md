# Repository instructions

These instructions apply to all files in this repository.

## Commits and pull requests

Use [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) for every commit and PR title.
Use this format:

```text
<type>[optional scope][optional !]: <description>
```

- Use `feat` for a new feature and `fix` for a defect correction.
- Use `docs`, `test`, `refactor`, `perf`, `build`, `ci`, `chore`, or `revert` for other changes.
- Use lowercase types and scopes.
- Write a short description that starts with an imperative verb.
- Use a scope when it helps identify the affected part, such as `parser`, `api`, or `ui`.
- Mark a breaking change with `!` before the colon or a `BREAKING CHANGE:` footer.
- Describe the breaking change and required migration in the commit body and PR description.
- Keep the PR title suitable for the squash commit message.
- Describe the final change and its validation in the PR description.

Examples:

```text
docs: add repository instructions
fix(parser): retain conditional dependencies
feat(ui): add package filters
feat(api)!: change the import response
```

## Written English

Use [ASD-STE100 Simplified Technical English](https://www.asd-ste100.org/about_STE.html) for all new or changed project prose.
This includes documentation, UI text, error messages, comments, commit messages, and PR text.
Use the writing rules and dictionary in the [official standard](https://www.asd-ste100.org/assets/files/ASD-STE100_ISSUE9.pdf).
The following points are a quick reference, not the complete standard:

- Use approved words with their approved meanings and parts of speech.
- Use consistent technical nouns and verbs for project concepts.
- Keep exact product names, identifiers, commands, and API fields.
- Explain an unfamiliar technical term when you first use it.
- Use active voice in instructions.
- Give one instruction per sentence.
- Limit procedural sentences to 20 words and descriptive sentences to 25 words.
- Keep each paragraph about one subject, with no more than six sentences.
- Use explicit subjects and clear references.
- Do not use idioms, contractions, or semicolons in prose.
- Review vocabulary and grammar as well as sentence length.

Preserve technical meaning when you edit text.
Keep quotations, third-party text, licenses, and source fixtures unchanged unless the task requires a change.

## AIHC branding

Match the branding on [the AIHC blog](https://blog.aihc.app/) and [the AIHC manual](https://docs.aihc.app/).
Inspect both sites before a visual change.
Use their shared colors, logo, favicon, typography, and light and dark themes.
Use the current shared design if these reference values change.

The following colors were verified on 2026-10-04:

| Role | Light theme | Dark theme |
| --- | --- | --- |
| Page background | `#faf8f3` | `#151318` |
| Surface | `#ffffff` | `#1d1a22` |
| Main text | `#1d1a17` | `#ebe6de` |
| Muted text | `#6b655d` | `#9c958b` |
| Border | `#e6e0d6` | `#2b2731` |
| Accent | `#5e5086` | `#b7a8e6` |
| Strong accent | `#46396b` | `#d1c6f0` |
| Soft accent | `#eee9f7` | `#27223a` |
| Code background | `#f3f0ea` | `#1d1a22` |

- Use shared CSS variables for these roles.
- Use Inter for interface text, a serif font for headings, and a monospace font for code.
- Use Newsreader or the manual's serif stack: Iowan Old Style, Palatino Linotype, Palatino, Georgia, serif.
- Reuse the shared AIHC mark. Do not replace it with a generic lambda or a new symbol.
- Use the SVG favicon from [the blog](https://blog.aihc.app/favicon.svg) or [the manual](https://docs.aihc.app/assets/favicon.svg).
- Both favicon files contain the same white mark on a purple (`#5e5086`) rounded square.
- Store reused assets locally and reference them from the page head.
- Keep browser theme colors consistent with the active page theme.
- Preserve visible keyboard focus, readable contrast, and layouts that work on small screens.
- Verify visual changes in both themes and at desktop and mobile widths.

The reference styles are the blog's linked stylesheet and [the manual's extra stylesheet](https://docs.aihc.app/stylesheets/extra.css).
Existing green colors and the lambda mark in `public/` are not the brand reference.

## Validation

Read `docs/architecture.md` for the project structure and build steps.
Run checks that apply to the changed files:

- For documentation changes, review the text, links, and `git diff --check` output.
- For Worker or JavaScript changes, run `npm run check`.
- For parser changes, rebuild with `just build`, then run `just check`.
- For visual changes, also verify the favicon, typography, theme colors, and responsive layout against both reference sites.

Record the checks and any checks you could not run in the PR description.
