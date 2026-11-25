# Issue Claiming & Automation Guide

WorkSphere uses GitHub Actions to manage issue assignments through the `/claim` and `/unclaim` commands.

This guide explains the actual claiming workflow, contributor limits, assignment release, and pull request linking requirements.

## 1. Claiming an Issue

Find an open issue that has no assignees.

Comment on the issue with:

```text
/claim
```

The automation is implemented in `.github/workflows/claim.yml` and runs when a new issue comment is created.

The workflow:

1. Ignores bot comments and blocked contributors.
2. Checks whether the issue already has an assignee.
3. Checks the contributor's active assigned issue count.
4. Assigns the issue when the eligibility checks pass.
5. Posts an assignment confirmation comment.

An issue that already has an assignee cannot be claimed by another contributor through this workflow.

### 1.1 Maximum Assigned Issue Limit

Each contributor can have a maximum of **10 active assigned issues**.

The automation retrieves the contributor's open assigned items and excludes pull requests when calculating this limit.

A claim is rejected when the contributor already has 10 or more active assigned issues.

To claim another issue, first complete an existing assignment or release it using `/unclaim`.

## 2. Releasing an Assignment

When you cannot continue working on an assigned issue, release it promptly.

Comment:

```text
/unclaim
```

The automation removes your assignment and posts a confirmation.

### 2.1 Maintainer Unassignment

Repository maintainers have additional unassignment permissions.

A maintainer can specify a contributor:

```text
/unclaim @username
```

Maintainers can also release all current assignees from an issue using `/unclaim` when they are not personally assigned.

Regular contributors can only unassign themselves.

## 3. Six-Day Contribution Recommendation

After a successful claim, the automation posts a confirmation recommending that you open a pull request within **six days**.

This is a contribution recommendation, not an automatic assignment-expiration mechanism.

If additional time is required:

1. Post a progress update on the assigned issue.
2. Explain the work completed and any remaining blockers.
3. Continue coordinating with the maintainers.

The current claim workflow does not implement an automatic six-day unassignment timer or a scheduled day-four reminder.

## 4. Branch and Pull Request Workflow

Create a dedicated branch for each assigned issue.

Recommended branch format:

```bash
git fetch upstream
git switch -c docs/issue-description upstream/main
```

Use a descriptive branch name appropriate to the issue.

Before opening a pull request:

- Keep the changes limited to the assigned issue.
- Review the complete diff.
- Check that the documentation or implementation matches the repository source.
- Commit with a descriptive conventional commit message.

### 4.1 Linking the Pull Request to an Issue

Include a GitHub closing keyword in the PR description:

```text
Closes #123
```

Other supported GitHub closing keywords include `Fixes` and `Resolves`.

Including the reference in the PR title as well is useful for visibility.

A valid issue link helps GitHub associate the pull request with the issue and close it automatically when the PR is merged.

## 5. Pull Request Validation and Auto-Merge

WorkSphere has two separate workflows relevant to pull request linking.

### 5.1 PR Quality Check

The workflow `.github/workflows/pr-check.yml` checks whether a pull request description contains a supported issue-closing reference.

If the reference is missing, it normally emits a warning rather than failing the check.

The workflow also supports skipping this warning for titles containing `typo`, `chore`, or `[skip-issue]`.

### 5.2 Linked PR Auto-Merge

The workflow `.github/workflows/auto-merge.yml` performs additional validation.

It looks for associated issues through GitHub closing references, supported issue-link keywords, and certain branch-name patterns.

For regular contributors, the referenced issue must be assigned to the pull request author. Repository maintainers have an exception.

When a valid linked issue is found, the workflow proceeds with its approval, labeling, mergeability, and squash-merge process.

A PR-link warning and auto-merge eligibility are therefore separate checks.

## 6. Claim Commands on Pull Requests

The claim workflow also handles commands posted on pull requests.

- `/claim` assigns the commenting contributor to the pull request.
- `/unclaim` removes the commenting contributor's pull request assignment.

These operations affect the pull request's assignees, not the associated issue's assignees.

## 7. Troubleshooting

| Problem                                      | Explanation                                                                                                    | Recommended action                                  |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Claim rejected because the issue is assigned | The issue already has an assignee                                                                              | Select an unassigned issue                          |
| Claim rejected because of the limit          | The contributor already has 10 active assigned issues                                                          | Complete or unclaim an existing issue               |
| Assignment confirmation not received         | The workflow may not have processed the comment successfully                                                   | Check the repository Actions tab and issue activity |
| Cannot unclaim another contributor           | Regular contributors cannot release someone else's assignment                                                  | Ask a maintainer for assistance                     |
| PR reports a missing issue link              | The PR description lacks a supported closing reference                                                         | Add `Closes #123` using the actual issue number     |
| PR is not eligible for auto-merge            | The linked issue may not be assigned to the PR author, or other mergeability requirements may not be satisfied | Verify assignment, issue linkage, and PR status     |

## 8. Source References

The following repository files define the automation described in this guide:

- `.github/workflows/claim.yml` — Issue and pull request claiming and unclaiming.
- `.github/workflows/pr-check.yml` — Pull request issue-link warning.
- `.github/workflows/auto-merge.yml` — Linked issue validation and automated merging.
- `CONTRIBUTING.md` — General contributor workflow and submission guidance.

For changes to claiming behavior, always consult these workflow files as the authoritative implementation.
