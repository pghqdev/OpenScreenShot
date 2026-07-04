# Contributing to OpenScreenShot

Thanks for your interest in contributing! 🎉 OpenScreenShot is an open-source Chrome extension and we welcome bug reports, feature ideas, and pull requests.

## Getting set up

1. Fork and clone the repo.
2. Install Node.js 22+ and npm 10+.
3. Run `npm install`.
4. Run `npm run icons` to generate the extension icons.
5. Run `npm run dev` and load `dist/` as an unpacked extension (see [README](./README.md)).

## Development workflow

- **TypeScript strict mode** is on. Please keep types clean — no `any` unless justified in a comment.
- Use the shared design tokens in `src/shared/design-tokens.ts` for colors, spacing, and typography. Don't hard-code hex values in components.
- Run the checks locally before pushing:

  ```bash
  npm run lint
  npm run typecheck
  npm test
  npm run build
  ```

- Format with `npm run format` (Prettier).

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(capture): scroll-and-stitch full-page capture
fix(popup): correct focus ring color in dark mode
docs(readme): add install instructions
chore(deps): bump vite to 7.3
```

## Branching

- Branch from `main`: `feat/...`, `fix/...`, `chore/...`.
- Keep PRs focused. One feature or fix per PR.
- Rebase onto `main` before requesting review.

## Pull requests

- Describe what changed and why.
- Include screenshots/GIFs for UI changes.
- Add or update tests where reasonable.
- Make sure CI is green.

## Milestones

We build in milestones (see [README](./README.md) status table). If you'd like to take on a chunk of work, open an issue first to discuss scope.

## Code of Conduct

By participating you agree to abide by our [Code of Conduct](./CODE_OF_CONDUCT.md).