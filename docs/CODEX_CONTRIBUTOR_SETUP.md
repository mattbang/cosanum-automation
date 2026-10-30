# Codex setup for project contributors

This page is for a group member working from their own computer and GitHub account. Start with the credential-free, synthetic workflow. The [general contributor guide](CONTRIBUTING.md) gives the expected local output and troubleshooting steps.

## Install and get access

1. Ask Matt to invite your GitHub username to the [repository](https://github.com/mattbang/cosanum-automation) and, if you will manage tasks, to the [project board](https://github.com/users/mattbang/projects/1). Accept both invitations. Repository and project permissions are separate.
2. Install [Git](https://git-scm.com/downloads), [Node.js 24](https://nodejs.org/en/download), and [Python 3.11 or newer](https://www.python.org/downloads/). The checked-in [`.node-version`](../.node-version) specifies Node 24. Set your own Git name and email so your commits are attributed to you: `git config --global user.name "Your Name"` and `git config --global user.email "your-verified-github-email"`.
3. Install the [ChatGPT desktop app](https://learn.chatgpt.com/docs/app), sign in with **your own** ChatGPT account, choose **Codex**, and open your local clone as the project folder. The [Codex CLI](https://learn.chatgpt.com/docs/cli) or [IDE extension](https://learn.chatgpt.com/docs/developer-settings) is optional; the desktop app is enough to start. Each contributor uses their own account and local configuration.
4. Clone the repository with your own GitHub authentication: `git clone https://github.com/mattbang/cosanum-automation.git`, then `cd cosanum-automation`. GitHub Desktop or a credential manager can handle GitHub sign-in. A Codex sign-in does not itself grant GitHub write access.

The [optional dev container](../.devcontainer/devcontainer.json) supplies Node 24 and Python 3.13. Use it with a dev-container-capable editor or Codespaces; local Docker is needed only for a local container. See [the contributor guide](CONTRIBUTING.md) for its port-privacy check.

## First local run

From the repository root, run:

```sh
node --version
python3 --version
npm run check
npm run dev
```

Open `http://127.0.0.1:4173/` for the read-only synthetic Demo Hub. The root check and preview use built-in tooling, so there is no root `npm install` step. On Windows, `python --version` may be the appropriate Python command. The preview intentionally blocks Google writes. Follow [CONTRIBUTING.md](CONTRIBUTING.md) if a check or port fails.

## Work with Codex and GitHub

1. Pick or agree on one issue from the project board. Read the issue, [README](../README.md), and [AGENTS.md](../AGENTS.md). Tell Codex the issue number, intended result, and which checks to run.
2. Create a focused branch from current `main`, for example `git switch -c feat/short-topic` after `git pull --ff-only`. Use a separate worktree if another task is already in progress locally. Do not develop on or bulk-stage a dirty checkout.
3. Make a small change, run the relevant checks, inspect the diff, commit with your own Git identity, push your branch, and open a pull request. Ask another member to review it. Include the exact check result and what remains unverified.
4. The GitHub connection in Codex is optional. Use the app's plugin/integration settings to connect **your own GitHub account** if you want Codex to read issues or help with PRs. You can instead use the GitHub website or optional [GitHub CLI](https://cli.github.com/) (`gh auth login`). Neither a GitHub connector nor an MCP server is required for local editing and checks.

Codex personal settings are stored in `~/.codex/config.toml` and can be managed in [Developer settings](https://learn.chatgpt.com/docs/developer-settings). Start with the default permissions and grant access only when a task needs it. Do not copy Matt's Codex configuration, login cache, OAuth files, or tokens. Repository guidance belongs in `AGENTS.md`; personal settings stay on your own computer.

## Install dependencies only for the module you work on

| Work area | Local setup and checks | Extra software |
| --- | --- | --- |
| Apps Script source, docs, root preview | `npm run check`; `npm run dev` | None beyond Git, Node, Python |
| API in `server/` | `npm --prefix server ci`; `npm --prefix server run check`; `npm --prefix server test` | PostgreSQL only for the separate native database integration test |
| Mobile app in `mobile/` | `cd mobile`; `npm ci`; `npx tsc --noEmit`; `node --test tests/*.test.cjs` | Expo Go for a phone preview; Android Studio/Xcode only for native build or device work |
| Shared Site in `shared-demo-site/` | `cd shared-demo-site`; `npm run install:ci`; `npx tsc --noEmit`; `npm run build` | None for source checks; deployment uses a separately authorized target |
| Participant page in `participant-web/` | `npm --prefix participant-web run check`; `npm --prefix participant-web test` | None |

Read each module's README before running its development server or connected test. Some module checks need dependencies and network access for their first install. Do not treat a local pass as a hosted, Google, or two-device acceptance result.

## Connectors and Google boundary

No CLI connector, MCP server, Google login, `clasp`, cloud account, or API key is required for the first contribution. If you want current OpenAI documentation inside Codex, the optional read-only Docs MCP can be added with `codex mcp add openaiDeveloperDocs --url https://developers.openai.com/mcp` and checked with `codex mcp list` ([official setup](https://developers.openai.com/resources/docs-mcp)). This requires the optional Codex CLI.

Connected Google work has its own [team test-environment plan](TEAM_TEST_ENVIRONMENT.md). Do not use Matt's saved `clasp` authorization or the historical prototype target. Matt must agree the exact account, resources, scopes, and verifier before connected access or deployment. The training web app remains owner-only; the public synthetic tour is separate. Keep private test identities, credentials, asset IDs, and raw evidence out of commits, PRs, and Codex chat.
