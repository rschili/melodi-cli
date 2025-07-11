# melodi-cli
[![NPM Version](https://img.shields.io/npm/v/%40rschili%2Fmelodi-cli?registry_uri=https%3A%2F%2Fregistry.npmjs.com%2F)](https://www.npmjs.com/package/@rschili/melodi-cli)
[![Build Status](https://github.com/rschili/melodi-cli/actions/workflows/node.js.yml/badge.svg)](https://github.com/rschili/melodi-cli/actions/workflows/node.js.yml)

iModel repository utility

This is a command line interface (CLI) for disecting and troubleshooting iModels.
The name is an anagram of the word iModel.

It provides a fluent interactive interface that prompts the user with a series of options to guide them through the process.

It uses local directories referred to as workspaces to store the iModels and their metadata.
When called in an empty directory, it will create a new workspace.
When called in a directory that already contains a workspace, it will use that workspace.

## Requirements

- Node.js 22.14 or later

## Installation

```bash
npm install -g @rschili/melodi-cli
```

## Usage

```bash
melodi
```

## Local files

Workspaces are self-contained, but there are some files that melodi-cli stores outside of the workspace dir.

- User settings are stored in
  - **Linux/macOS:** `$XDG_CONFIG_HOME/melodi` or `$HOME/.config/melodi/`
  - **Windows:** `%LOCALAPPDATA%\melodi\config\`
- Cached data (e.g. downloaded schemas and known etags) are stored in
  - **Linux/macOS:** `%XDG_CACHE_HOME/melodi/` or `$HOME/.cache/melodi/`
  - **Windows:** `%LOCALAPPDATA%\melodi\cache\`
- The daily update checker stores its cache in `$XDG_CONFIG_HOME/simple-update-notifier/` or `$HOME/.config/simple-update-notifier/` (The package `simple-update-notifier` is used to check for updates).

## Contributing
If you want to contribute, please fork the repository and submit a pull request.
I'm using make to wrap all my commands, you can use that, or just call npm directly.

```bash
git clone https://github.com/rschili/melodi-cli.git
npm install
make build
make run
```

Next TODO:

- [x] Create new empty DB
- [x] Query ECDb
- [x] Unified Db type that wraps specialities of each Db [e.g. Sqlite, ECDb, Briefcase, Standalone]
- [x] Pretty print query results
- [x] ESM
- [x] Show available iTwins and iModels
- [x] Download iModel seeds from Hub
- [x] Pull Changesets
- [ ] Apply Changesets
- [ ] Named Versions
- [ ] Sqlite queries
- [ ] Schema Management / Schema Import
- [ ] Troubleshooter / integrity checker
- [ ] Sync existing Briefcase with online iModels
- [ ] Insert/Update/Delete
- [ ] Transactions
- [ ] Snapshots
- [ ] Test and document how to use this with a local itwinjs-core/backend or imodeljs-native build
