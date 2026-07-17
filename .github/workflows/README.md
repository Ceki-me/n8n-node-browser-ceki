# GitHub Actions workflow for publishing to npm with provenance

## One-time setup

1. Go to [npmjs.com](https://npmjs.com) → Account Settings → **Access Tokens**
2. Create an **Automation Token** (or Granular Token scoped to `n8n-node-browser-ceki`)
3. Go to GitHub repo → **Settings** → **Secrets and variables** → **Actions**
4. Add new repository secret:
   - **Name:** `NPM_TOKEN`
   - **Value:** your npm Automation Token

## Publishing a new version

To release and publish to npm:

```bash
# 1. Make sure you're on main branch and all changes are committed
git checkout main
git pull

# 2. Run the release script (prompts for version: patch/minor/major)
npm run release

# 3. This will:
#    - Build the package
#    - Bump version in package.json
#    - Create a git commit and tag (e.g., v0.1.1)
#    - Push to GitHub
#    - GitHub Actions workflow triggers and publishes to npm with provenance
```

## Provenance verification

After publishing, verify provenance on npm:

```bash
npm view n8n-node-browser-ceki --json | jq '.attestations'
```

Or visit: https://www.npmjs.com/package/n8n-node-browser-ceki?activeTab=versions

## Requirements for n8n verification

This workflow meets n8n's requirements for Creator Portal submission:

- ✅ MIT license
- ✅ `n8n-community-node-package` keyword
- ✅ Proper `n8n` config in package.json
- ✅ Published via GitHub Actions with provenance (required after May 1, 2026)