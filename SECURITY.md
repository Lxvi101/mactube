# Security policy

## Supported versions

MacTube is pre-1.0. Security fixes are applied to the latest revision on the default branch. Older commits and unofficial builds are not supported.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability.

Use [GitHub's private vulnerability reporting](https://github.com/Lxvi101/mactube/security/advisories/new) and include:

- the affected version or commit;
- reproduction steps or a proof of concept;
- the expected impact;
- any suggested mitigation.

You should receive an acknowledgement within seven days. Please allow a reasonable period for investigation and a coordinated fix before public disclosure.

## Scope

Reports involving command execution, path traversal, unsafe deep links, exposure of browser credentials, untrusted media metadata, or insecure update/distribution behavior are especially useful. Vulnerabilities in yt-dlp, FFmpeg, Tauri, or another upstream dependency should also be reported to the upstream project when appropriate.
