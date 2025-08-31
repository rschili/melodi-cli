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