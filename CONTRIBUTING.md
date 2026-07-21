# Contributing to MacTube

Thanks for helping make MacTube better. Small, focused changes are easiest to review and maintain.

## Before opening a change

- Search existing issues and pull requests before starting substantial work.
- Open a feature request before making a large product or architecture change.
- Use a private security advisory instead of a public issue for vulnerabilities.
- Keep changes within MacTube's local-first, macOS-focused scope.

## Development setup

Install the prerequisites from the [README](README.md#requirements), then:

```sh
git clone https://github.com/Lxvi101/mactube.git
cd mactube
pnpm install
pnpm tauri dev
```

The web interface can run with `pnpm dev`, but native window behavior, the menu bar, URL schemes, notifications, and download commands must be tested through Tauri on macOS.

## Pull requests

1. Create a branch from the latest default branch.
2. Keep commits and the pull request focused on one concern.
3. Add or update tests when behavior changes.
4. Run the checks below.
5. Complete the pull request template and include screenshots or a short recording for interface changes.

```sh
pnpm test
pnpm build
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

Do not commit downloaded media, rendered trailers, credentials, browser data, signing certificates, or generated build directories.

## Code guidelines

- Prefer straightforward TypeScript and Rust over new abstractions without a clear payoff.
- Preserve the native macOS interaction model and keyboard accessibility.
- Keep network and media operations in the Tauri backend; keep presentation state in React.
- Treat URLs, filenames, playlist names, and external process output as untrusted input.
- Avoid adding telemetry or cloud dependencies.

By contributing, you agree that your contribution is licensed under the repository's MIT License and that you will follow the [Code of Conduct](CODE_OF_CONDUCT.md).
