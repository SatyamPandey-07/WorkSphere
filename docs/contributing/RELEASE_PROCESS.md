# WorkSphere Release Process

This guide explains how WorkSphere creates GitHub releases using its automated GitHub Actions workflow.

## 1. Release Workflow

The release automation is configured in `.github/workflows/release.yml`.

| Configuration       | Current behavior                 |
| ------------------- | -------------------------------- |
| Trigger             | Push of a Git tag matching `v*`  |
| Runner              | `ubuntu-latest`                  |
| Release action      | `softprops/action-gh-release@v3` |
| Draft release       | Enabled                          |
| Prerelease          | Disabled                         |
| Release notes       | Automatically generated          |
| Required permission | `contents: write`                |

The workflow creates a GitHub draft release. It does not automatically publish the release.

## 2. Creating a Release Tag

A maintainer must select the intended release commit and version.

The workflow accepts tags beginning with `v`.

Example commands:

```bash
git tag vX.Y.Z <commit-sha>
git push upstream vX.Y.Z
```

Replace the example version and commit SHA with the approved release values.

The tag must be pushed to the official WorkSphere repository for its release workflow to run. Contributors without permission to push to the upstream repository should coordinate with a maintainer.

## 3. Automated Draft Creation

When a matching tag is pushed:

1. GitHub Actions starts the `Create Release Draft` workflow.
2. The workflow checks out the repository.
3. The `softprops/action-gh-release` action creates a draft release.
4. GitHub automatically generates release notes.
5. The release remains unpublished for maintainer review.

The workflow uses the repository-provided `GITHUB_TOKEN`. No manually supplied token is required.

## 4. Reviewing and Publishing a Draft

Before publishing, an authorized maintainer should verify:

- **Tag:** The release references the intended tag.
- **Target commit:** The tag points to the correct commit.
- **Release title:** The title identifies the intended version.
- **Release notes:** The generated notes accurately describe the changes.
- **Prerelease status:** The release classification is appropriate.

After review, the maintainer can publish the draft through GitHub's release interface.

Creating a draft and publishing it are separate operations. The workflow performs draft creation; publication requires a subsequent manual action.

## 5. Troubleshooting

### The workflow did not start

Check that:

- The tag was pushed to the official repository.
- The tag name matches the `v*` pattern.
- The tag push appears in the repository's GitHub Actions history.

### The workflow failed

Open the failed run under the repository's Actions tab and inspect its logs. Check the workflow permissions and release action output.

### The draft release is missing

Confirm that the workflow completed successfully and check the repository's Releases page, including its draft releases.

## 6. Workflow Scope

The current workflow creates a GitHub draft release and generates release notes.

It does not define application deployment, build verification, test execution, binary packaging, or asset uploads. These operations should not be assumed to happen as part of release creation.
