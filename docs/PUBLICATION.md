# Publish a new GitHub repository

This package is prepared for the first public **v1.0** release. npm requires semantic version metadata, so `package.json`, its lockfile, `VERSION` and app metadata use **1.0.0**. Model names, dependency versions, internal schemas and saved-workflow identifiers are deliberately unchanged.

## Before creating the repository

1. Extract into a clean directory. Do not copy the old `.git` directory or historical release archives.
2. Follow the README setup. Real `.env`, local chain/registered-contract configuration, build output and test reports stay private and ignored.
3. Run `npm run check:publication` and the documented regression gate.
4. Read [VALIDATION.md](VALIDATION.md) and [SECURITY.md](../SECURITY.md). Manual/live acceptance remains explicitly outstanding.
5. Choose a repository-wide license appropriate to your ownership and dependencies. No license has been selected on your behalf; preserve existing per-file notices.

## Stage and inspect locally

```sh
git init
git branch -M main
git add .
git status --short
git diff --cached --stat
git diff --cached --check
npm run check:publication
```

Review the full staged diff locally before committing. `.gitignore` does not remove an already tracked secret. If a secret was ever committed, rotate it and clean the history; simply adding an ignore rule is insufficient. Never use `git add -f` on ignored private files.

The publication checker verifies representative ignore patterns, blank example credentials, metadata consistency and documentation links. It also rejects tracked sensitive paths when run in a Git repository. It is not a complete secret scanner; inspect custom files and configuration values yourself.

## GitHub content

Suggested repository name: `yanfu-governance-compiler`.

Use [INTRODUCTION.md](INTRODUCTION.md) for the About sentence, feature comparison and topics. The root README is the landing page; it includes the workflow chart and quick start. The release description can be based on [CHANGELOG.md](../CHANGELOG.md), with the validation limitations retained.

Once you have explicitly approved publication, create a new empty repository under your chosen account, set its remote and push the reviewed initial commit. Create the first release using tag **v1.0**. No remote, push, tag or GitHub release is created by the preparation process.

`private: true` in package.json prevents accidental npm publication; it does not control GitHub repository visibility.
