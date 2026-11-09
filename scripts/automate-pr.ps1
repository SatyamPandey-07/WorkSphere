<#
.SYNOPSIS
    WorkSphere PR Automation Script for PowerShell

.DESCRIPTION
    Automates issue claiming, branch creation, committing, pushing to origin,
    and opening Pull Requests against upstream (SatyamPandey-07/WorkSphere)
    with the exact format: `<type>: <short description> (closes #<issue_number>)`.

.EXAMPLE
    .\scripts\automate-pr.ps1 -List
    .\scripts\automate-pr.ps1 -Claim 4388
    .\scripts\automate-pr.ps1 -Branch 4388
    .\scripts\automate-pr.ps1 -PushPR 4388
    .\scripts\automate-pr.ps1 -Full 4388
#>

param(
    [switch]$List,
    [int]$Claim,
    [int]$Branch,
    [int]$PushPR,
    [int]$Full
)

$scriptPath = Join-Path $PSScriptRoot "automate-pr.mjs"

if ($List) {
    node $scriptPath list
} elseif ($Claim -gt 0) {
    node $scriptPath claim $Claim
} elseif ($Branch -gt 0) {
    node $scriptPath branch $Branch
} elseif ($PushPR -gt 0) {
    node $scriptPath push-pr $PushPR
} elseif ($Full -gt 0) {
    node $scriptPath full $Full
} else {
    node $scriptPath --help
}
