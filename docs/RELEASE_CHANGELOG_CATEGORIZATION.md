# Automated Release Changelog Categorization

GitHub's **Generate release notes** feature uses `.github/release.yml` to
exclude selected pull requests and group the remaining merged pull requests
under release-note headings. The configuration is:

```yaml
changelog:
  exclude:
    labels:
      - dependencies
      - chore
      - maintenance
      - ci
      - build
      - automated
      - duplicate
      - invalid
      - wontfix
      - skip-changelog
    authors:
      - dependabot[bot]
      - renovate[bot]
      - github-actions[bot]

  categories:
    - title: Breaking Changes
      labels:
        - breaking
        - breaking-change
    - title: Features
      labels:
        - feature
        - enhancement
        - feat
    - title: Bug Fixes & Security
      labels:
        - bug
        - fix
        - security
        - resilience
    - title: Documentation
      labels:
        - documentation
        - docs
    - title: Other Changes
      labels:
        - "*"
```

## Category headings and labels

| Generated heading | Matching PR labels |
| --- | --- |
| **Breaking Changes** | `breaking`, `breaking-change` |
| **Features** | `feature`, `enhancement`, `feat` |
| **Bug Fixes & Security** | `bug`, `fix`, `security`, `resilience` |
| **Documentation** | `documentation`, `docs` |
| **Other Changes** | `*` (GitHub's catch-all for PRs that did not match an earlier category) |

Labels determine which category a merged pull request qualifies for. A PR
with no label matching the explicit categories is included under **Other
Changes** by the final `*` catch-all, unless the PR is excluded by label or
author.

The configuration lists categories in order, and GitHub documents `*` as a
catch-all for pull requests that did not match any previous category. This
repository configuration does not define a separate priority rule for a PR
whose labels match more than one explicit category. Such an overlap should not
be documented as a unique winning category based on this YAML alone.

## Exclusions

Any PR with one or more of these excluded labels is omitted from the generated
release notes:

`dependencies`, `chore`, `maintenance`, `ci`, `build`, `automated`,
`duplicate`, `invalid`, `wontfix`, `skip-changelog`.

PRs authored by `dependabot[bot]`, `renovate[bot]`, or `github-actions[bot]`
are also excluded, regardless of category labels.

## Example generated excerpt

The following illustrative merged PRs use labels present in the configuration:

```markdown
## Breaking Changes
- Rename the venue availability response field (label: `breaking-change`)

## Features
- Add clustered venue markers to discovery (label: `feature`)

## Bug Fixes & Security
- Preserve booking dates across DST changes (label: `bug`)
- Validate signed telemetry requests (label: `security`)

## Documentation
- Explain device-event reconciliation (label: `documentation`)

## Other Changes
- Refresh settings-page copy (no matching category label)
```

The example is illustrative; the actual generated entries and titles come
from merged pull requests for the selected release range.

For GitHub's configuration behavior, see [Automatically generated release
notes](https://docs.github.com/en/repositories/releasing-projects-on-github/automatically-generated-release-notes#configuration-options).
