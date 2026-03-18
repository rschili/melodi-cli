# 1.7.0 (2026-03-18)
- Add SQLite query editor alongside ECSql in the DB editor
- Add Troubleshooter for diagnosing FK constraint violations and integrity issues in BriefcaseDb
- Add changeset operations: pull to latest, pull to specific changeset, show remote info
- Add schema import from local files or GitHub downloads
- Add "Pull by iModel ID" option for downloading iModels from Hub
- Extend UnifiedDb with SQLite statement wrapper to avoid bypassing the abstraction layer
- Fix async array formatting in query results (use Promise.all)
- Fix command history pruning (was growing unbounded)
- Fix spinner display during changeset downloads
- Remove dead code paths in DbEditor
- Update dependencies
- Remove redundant @typescript-eslint/eslint-plugin and @typescript-eslint/parser devDependencies

# 1.6.0 (2026-03-12)
- Made the MCP print results instead of returning them. Added ECSql guide.

# 1.5.0 (2026-03-11)
- Added MCP endpoint support.

# 1.4.1 (2026-03-11)
- Update to iTwin 5.7.1

# 1.4.0 (2025-08-31)
- Remove local workspace folders and use a global folder instead
- Streamline File opening, selecting a DB type is no longer needed

# 1.3.1 (2025-07-09)
- Adjust user config and cache directories on Windows

# 1.3.0 (2025-07-09)

- Add update checker
- Fix schemas menu not showing for ECDb
- Move user config into $HOME/.config/melodi/ and cache into $HOME/.cache/melodi/
- Do not exit app when trying to open a BriefcaseDb as StandaloneDb, just show an error

# 1.2.2 (2025-07-08)
- Print build date in the banner (yeah, very minor, but still)

# 1.2.1 (2025-07-08)

- Add some global error handling
- Print a warning is Node.js version is too old
- Fix a problem during workspace initialization where the process would just exit

# 1.2.0 (2025-07-08)

- Allow pulling from QA environment
- Remove DEV environment support (didn't work anyway)
- Hide some not implemented options from UI
- Update dependencies

# 1.1.0 (2025-07-07)

- Minor update to README to replace initial release

# 1.0.0 (2025-07-07)

- Initial release