## What changed

<!-- Describe the problem and the solution. -->

## Verification

- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] `cargo fmt --check --manifest-path src-tauri/Cargo.toml`
- [ ] `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml --locked`

## Interface changes

<!-- Add screenshots or a recording when the UI changes. Delete this section otherwise. -->

## Checklist

- [ ] The change is focused and documented where needed.
- [ ] Tests cover new or changed behavior.
- [ ] No credentials, cookies, private URLs, downloaded media, or generated build artifacts are included.
