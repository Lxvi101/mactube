# Architecture

MacTube is a Tauri 2 desktop application with a React interface and a Rust backend. It deliberately keeps all user data and media processing local.

## Runtime flow

1. `src/App.tsx` owns the interface, queue state, settings views, and Tauri event subscriptions.
2. `src/queue.ts` contains pure queue helpers covered by `src/queue.test.ts`.
3. The frontend invokes commands exposed by `src-tauri/src/lib.rs`.
4. Rust validates requests, resolves yt-dlp and FFmpeg, and starts external processes without a shell.
5. Structured progress events flow back to React while history and settings are persisted in the app configuration directory.
6. Tray-menu and deep-link handlers keep the queue reachable when the main window is hidden.

## Repository map

| Path         | Purpose                                                             |
| ------------ | ------------------------------------------------------------------- |
| `src/`       | React interface, styles, types, and queue tests                     |
| `src-tauri/` | Rust commands, native lifecycle, capabilities, packaging, and icons |
| `extension/` | Unpacked Chrome extension for explicit URL handoff                  |
| `assets/`    | Source brand artwork                                                |
| `remotion/`  | Reproducible launch trailer composition                             |
| `scripts/`   | Development and media-generation utilities                          |

## Trust boundaries

- URLs, filenames, playlist metadata, deep links, and child-process output are untrusted.
- The Rust backend passes arguments directly to child processes; do not introduce shell interpolation.
- Chrome cookies are read locally by yt-dlp only when the user opts in.
- Frontend Tauri capabilities should remain as narrow as the feature set allows.
- Persistent paths must remain inside user-selected output directories or the app configuration directory.

## Data storage

MacTube stores `settings.json` and `history.json` beneath Tauri's app configuration directory. Downloaded files go to the user-selected output directory. There is no server-side component or analytics pipeline.
