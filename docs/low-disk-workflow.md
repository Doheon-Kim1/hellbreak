# Low-disk development workflow

The Git repository is the durable source of truth. Generated dependencies, builds, and browser binaries are temporary.

## Start a coding session

```bash
npm ci
```

Install Playwright Chromium only when a real browser test is required:

```bash
npx playwright install chromium
```

## Verify changes

```bash
npm test
npm run lint
npm run build
```

## Finish a coding session

After the commit is pushed, reclaim space:

```bash
rm -rf node_modules .next dist
npm cache clean --force
rm -rf ~/.cache/ms-playwright
```

The next session restores exact dependency versions from `package-lock.json` with `npm ci`.

## Storage policy

- Keep: source files, tests, docs, `package.json`, `package-lock.json`, Git metadata.
- Remove after verification: `node_modules`, `.next`, `dist`, Playwright browser binaries, npm download cache.
- Never store generated images or large media in Git; use external object storage and commit references only.
- Do not run Playwright installation unless browser automation is needed for that milestone.
