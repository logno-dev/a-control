# Builds and releases

`.github/workflows/release.yml` creates installers on GitHub-hosted runners:

| Build | Output |
|---|---|
| Windows x64 | NSIS `.exe` installer |
| macOS Apple Silicon | arm64 `.dmg` and `.zip` |
| macOS Intel | x64 `.dmg` and `.zip` |

The Intel macOS build is cross-packaged on the macOS runner. jazz-midi ships native binaries for both macOS architectures; electron-builder unpacks them from ASAR. Native rebuild is disabled because these are prebuilt Node-API binaries.

## Continuous builds

Pushes and pull requests to `main` or `master` run `npm ci`, tests, TypeScript checks, production bundling, and installer packaging. **Actions → Desktop builds and releases → Run workflow** also runs this pipeline manually. Installer artifacts are retained for 14 days.

## Publish a version

After the project has been pushed to a GitHub repository:

1. Set `package.json` and `package-lock.json` to the desired version (for example, `npm version 0.1.1 --no-git-tag-version`).
2. Commit the version change.
3. Create and push a matching tag:

   ```sh
   git tag v0.1.1
   git push origin v0.1.1
   ```

The workflow rejects a tag that does not exactly match `v` plus the package version. After **all three installer builds succeed**, it creates a draft GitHub Release, uploads installers and `SHA256SUMS.txt`, and publishes it. Tags with a hyphen, such as `v0.2.0-beta.1`, are marked as prereleases. Re-running a tagged workflow replaces assets rather than creating another release.

Only the release job has `contents: write`; builds use read-only repository permissions. Publishing uses the built-in `GITHUB_TOKEN`; no personal access token is needed. Repository or organization policy must allow that job to write releases.

## Optional signing

No secrets are required for unsigned installers. Set these repository **Actions secrets** for signed distribution:

### macOS

- `MAC_CSC_LINK`: base64-encoded Developer ID Application `.p12` certificate.
- `MAC_CSC_KEY_PASSWORD`: certificate password.
- `APPLE_ID`: Apple developer account email.
- `APPLE_APP_SPECIFIC_PASSWORD`: app-specific password for notarization.
- `APPLE_TEAM_ID`: Apple developer team identifier.

electron-builder imports the supplied certificate and uses its standard notarization integration when the Apple credentials are present. Without them, the build is unsigned and unnotarized and macOS may require explicit approval to launch it.

### Windows

- `WIN_CSC_LINK`: base64-encoded code-signing `.pfx` / `.p12` certificate.
- `WIN_CSC_KEY_PASSWORD`: certificate password.

If your certificate provider requires a hardware token or cloud signing service, adapt the signing step to that provider rather than exporting a certificate. Unsigned installers may display a SmartScreen warning.

Signing secrets are unavailable to pull requests from forks; those builds still produce unsigned artifacts. Local certificate autodiscovery is disabled in CI so signing behavior is explicit.

## Local packaging

```sh
npm ci
npm run package
```

For Windows packaging on a Windows machine:

```sh
npm run package:win
```

Installers are named `MIDI Deck-<version>-<os>-<arch>.<extension>`. GitHub Actions performs platform-native packaging; no Wine or remote macOS signing setup is needed on your development machine. Automatic in-app updates are not enabled.
