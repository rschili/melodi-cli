# melodi-cli

iModel repository utility

This is a command line interface (CLI) for disecting and troubleshooting iModels.
The name is an anagram of the word iModel.

It provides a fluent interactive interface that prompts the user with a series of options to guide them through the process.

It uses local directories referred to as workspaces to store the iModels and their metadata.
When called in an empty directory, it will create a new workspace.
When called in a directory that already contains a workspace, it will use that workspace.

## Installation

```bash
npm install -g @rschili/melodi-cli
```

## Usage

```bash
melodi
```

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
- [x] ESM2020 module
- [x] Show available iTwins and iModels
- [x] Download iModel seeds from Hub
- [ ] Download named versions from Hub
- [ ] Pull and merge Changesets
- [ ] Named Versions
- [ ] Sqlite queries
- [ ] Schema Management / Schema Import
- [ ] Troubleshooter / integrity checker
- [ ] Sync existing Briefcase with online iModels
- [ ] Insert/Update/Delete
- [ ] Transactions
- [ ] Snapshots
- [ ] Test and document how to use this with a local itwinjs-core/backend or imodeljs-native build
