# Flutter Release Signing in GitHub Actions

## Android

The Android release build requires these GitHub Actions secrets:

| Secret | Represents and is used for |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Base64-encoded contents of the Android release keystore. CI decodes it for use by the Android release-signing configuration. |
| `KEY_PROPERTIES` | The signing-properties file contents consumed by the Android Gradle signing configuration. CI supplies these properties to the Android release build. |

These are signing credentials, not ordinary build configuration. Use the
release keystore and matching signing properties maintained by the authorized
release owners.

## iOS

No iOS release workflow was found under `.github/workflows`, so the available
configuration does not establish Apple signing-secret names to document. An
iOS release workflow must define those names before a signing guide can
describe its certificate, certificate password, provisioning profile, or
related values accurately. Do not substitute guessed secret names.

## Local builds and CI release artifacts

A local release build made without the CI release credentials is not the
CI-signed distribution artifact. It may be unsigned or signed with a local
development key and is intended for local validation, not publication as an
official release. GitHub Actions uses the configured release credentials to
produce signed Android release artifacts. iOS artifacts can be described as
CI-signed only after an iOS signing workflow and its required credentials are
configured.

## Add secrets safely

1. In the GitHub repository, open **Settings → Secrets and variables →
   Actions**. Add repository secrets there, or add them to the specific
   **Environment** used by the release workflow when environment protection
   and scoped access are required.
2. Store the keystore as the base64-encoded value for
   `ANDROID_KEYSTORE_BASE64`; store the signing properties in `KEY_PROPERTIES`.
3. Grant access only to trusted release workflows and maintainers. Do not put
   values in workflow YAML, command-line arguments, logs, artifacts, pull
   request comments, or documentation.
4. Never commit keystores, provisioning profiles, certificates, signing
   properties, passwords, or other signing credentials to the repository.
