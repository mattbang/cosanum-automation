# Contributor development environment

This plan reduces the time from a fresh checkout to a useful contribution while keeping the synthetic local workflow, connected Google verification, and the owner-only v0.1 release distinct. The work is tracked in [#27](https://github.com/mattbang/cosanum-automation/issues/27) and [#28](https://github.com/mattbang/cosanum-automation/issues/28). Their acceptance checks, rather than this page, determine when the environment is ready.

## What a contributor should see

The README will offer a short **Start here** path. A contributor clones the repository, runs one local check command, starts the Demo Hub preview, and sees a fictional request move through the read-only views. The preview must clearly say **synthetic data** and show a visible failure if an action would write to Google. A small screenshot or screen capture can explain the journey; the private full-run recording required for the v0.1 demo remains separate.

The first path requires only a supported Node version. An optional dev container gives contributors the same tool versions locally or in Codespaces, with a private preview port. The setup guide will list prerequisites, expected output, and a recovery step for a common failure. No contributor needs the demo owner's Mac or Google session to run these checks.

| Slice | Goal | Evidence that it works | Position |
| --- | --- | --- | --- |
| [#27](https://github.com/mattbang/cosanum-automation/issues/27) Local setup and PR checks | Pin tools; document a fresh checkout; run deterministic tests and synthetic read-only preview with one command each; add PR checks and the optional container. | A second account or clean environment follows the guide, sees the preview's blocked write, and gets a useful CI failure when a check breaks. | Can advance without Google permission. Align the guide with the reviewed source from [PR #24](https://github.com/mattbang/cosanum-automation/pull/24), [PR #25](https://github.com/mattbang/cosanum-automation/pull/25), and the preview from [PR #26](https://github.com/mattbang/cosanum-automation/pull/26). |
| [#28](https://github.com/mattbang/cosanum-automation/issues/28) Team Google test environment | Decide ownership and roles, provision isolated synthetic assets, document personal authorization and reset rules, and verify connected checks under two contributor accounts. | Two authorized contributors run recorded synthetic smoke checks; wrong-account access and reset/retry boundaries are observed. | Design can start now; provisioning follows a reviewed access and ownership plan. Schedule before a team-operated replay if needed. |

## How contributions move through the project

1. Work in a branch or pull request against versioned source. Run local checks and preview with public synthetic fixtures. CI repeats credential-free checks on the pull request.
2. Review code and fixture changes independently. A failing local check blocks handoff; a passing local check is evidence about local behavior only.
3. For a Google integration, name one connected verifier and exact source commit, script, Sheet, accounts, scopes, and expected side effects in a private run record. Only one owner changes the shared Apps Script deployment or Sheet schema at a time.
4. Record the connected result and any created Forms, events, messages, proofs, or archive files privately. Merge or mark a release card complete only against its stated acceptance check.

The team sandbox is for contributor development. It does not grant trainers, participants, or Process & Quality operators access to the owner-only admin app; that product access decision is [#9](https://github.com/mattbang/cosanum-automation/issues/9). Keep credentials, private fixtures, personal addresses, live asset IDs, raw evidence, and replay footage outside the public repository.

## Effect on the release roadmap

The v0.1 release still needs fresh Form identity [#3](https://github.com/mattbang/cosanum-automation/issues/3), controlled mail [#4](https://github.com/mattbang/cosanum-automation/issues/4), a reviewed owner-only deployment [#5](https://github.com/mattbang/cosanum-automation/issues/5), phone handoffs [#10](https://github.com/mattbang/cosanum-automation/issues/10), six connected scenarios [#6](https://github.com/mattbang/cosanum-automation/issues/6), and a private complete recording [#7](https://github.com/mattbang/cosanum-automation/issues/7). Local preview and CI can shorten their implementation loops but cannot close those connected checks.

The shared sandbox may later use the bounded synthetic-run design in [#8](https://github.com/mattbang/cosanum-automation/issues/8), but #8 remains a product-demo refinement, not implicit permission to reset existing evidence. New contributor accounts, Google ownership, or Codespaces administration are explicit setup decisions. No shared owner password or OAuth refresh token is part of the workflow.
