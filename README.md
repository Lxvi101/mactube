# MacTube

A minimal, macOS-first video, playlist, and music downloader built with Tauri 2, React, Rust, and [yt-dlp](https://github.com/yt-dlp/yt-dlp).

## What it does

- Adds single videos or complete playlists from any site supported by yt-dlp.
- Opens playlists in a searchable preview with select-all, numeric ranges, and per-item video/audio quality.
- Downloads the best available version or a natural resolution preset; video and audio streams are selected and merged automatically.
- Extracts full-quality source audio to MP3, M4A, Opus, or lossless FLAC.
- Runs a low-memory queue with 1–4 simultaneous jobs, live speed/ETA, safe cancellation, pause/resume, retries, restart recovery, and playlist folders.
- Embeds metadata and thumbnails and can remove SponsorBlock segments.
- Accepts one-click jobs from the included Chrome extension through `mactube://` links.
- Can ask yt-dlp to use the local Chrome profile for videos the signed-in user can access; cookie values never enter the deep link.
- Keeps a local download history, skips duplicates, reveals saved files in Finder, and sends native completion/failure notifications.
- Distinguishes sign-in failures, DRM protection, and missing compatible non-DRM formats with tailored recovery actions.
- Lives quietly in the macOS menu bar; closing the window hides it while downloads continue.
- Shows live aggregate progress in the menu-bar title and per-download progress bars in its menu.
- Can launch hidden at login when the opt-in preference is enabled.
- Stores preferences locally and includes no analytics.

## macOS development

Install prerequisites:

```sh
xcode-select --install
brew install node rust yt-dlp ffmpeg
```

Then run:

```sh
npm install
npm run tauri dev
```

Build a signed-ready `.app` and `.dmg` with:

```sh
npm run tauri build
```

`yt-dlp` and `ffmpeg` are intentionally resolved from the system path in development. Set `MACTUBE_YTDLP` to an explicit binary path if desired. For distribution to people without Homebrew, place signed universal `yt-dlp` and `ffmpeg` sidecars in the app bundle and update `ytdlp_binary()` to resolve the bundled resource first.

## Chrome extension

1. Build and launch MacTube once so macOS registers the `mactube://` scheme.
2. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
3. Select the `extension` directory.
4. Pin MacTube. On a video page, click it and choose video or full-quality audio. The same actions are available from the page/link context menu.

Chrome may ask once whether it may open MacTube. The extension never reads browsing history; it only receives the active URL after an explicit click.

Enable **Use Chrome sign-in** in the extension popup for private, age-restricted, or member-accessible videos. MacTube passes `--cookies-from-browser chrome` to yt-dlp locally; the extension does not copy or transmit cookies. Chrome may need to be closed briefly if its cookie database is locked. DRM-protected media remains unsupported.

## Verification

```sh
npm test
npm run build
cd src-tauri
cargo test
cargo clippy --all-targets -- -D warnings
```

## Linux-side verification

The web interface can be previewed on Debian with `npm run dev`. Native window behavior, URL-scheme registration, signing, and DMG packaging must be validated on macOS.

### Menu-bar behavior

While work is active, the menu bar reads like `↓ 2 · 47%`. Opening it shows up to five current titles with compact ten-step progress bars. Double-click the icon or choose **Open MacTube** to restore the window. The normal window close button only hides MacTube; **Quit MacTube** in the menu exits it completely.
