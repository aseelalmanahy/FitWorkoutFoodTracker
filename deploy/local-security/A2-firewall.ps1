<#
A2 (SEC-02): disable the broad inbound firewall rules that let any Node.js program on this PC accept connections from
any network ("Node.js JavaScript Runtime", TCP and UDP, Public profile, any port, any address).

  .\A2-firewall.ps1                      Check, read only: the inbound rules for node.exe, and what listens beyond loopback
  .\A2-firewall.ps1 -Apply -WhatIf       What -Apply would do, changing nothing
  .\A2-firewall.ps1 -Apply  -Approval A2 Elevated, with the owner's A2 approval: exports the whole firewall policy to the
                                         backups folder, disables exactly those rules, and records their names
  .\A2-firewall.ps1 -Rollback -Approval A2 -State <file>   Elevated: re-enables exactly the rules -Apply disabled

Tailscale (E1) is unaffected: `tailscale serve` forwards to 127.0.0.1. If Windows later asks to allow Node.js, choose
Cancel. Verify from a phone on the same Wi-Fi that http://<this PC's LAN address>:3000 no longer loads.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [switch]$Apply,
  [switch]$Rollback,
  [string]$Approval,
  [string]$State,
  [string]$BackupDir
)
$ErrorActionPreference = "Stop"
# Windows PowerShell 5.1 doesn't set $PSScriptRoot in parameter defaults.
if (-not $BackupDir) { $BackupDir = Join-Path $PSScriptRoot "..\..\..\FitWorkoutFoodTracker-backups" }

function Get-NodeInboundRules {
  Get-NetFirewallApplicationFilter |
    Where-Object { $_.Program -match '\\nodejs\\node\.exe$' } |
    Get-NetFirewallRule |
    Where-Object { $_.Direction -eq 'Inbound' }
}
function Show-State {
  $rules = @(Get-NodeInboundRules)
  "Inbound firewall rules for node.exe: $($rules.Count)"
  foreach ($r in $rules) { "  $($r.DisplayName) | $(($r | Get-NetFirewallPortFilter).Protocol) | profile $($r.Profile) | $($r.Action) | enabled $($r.Enabled)" }
  $wide = @(Get-NetTCPConnection -State Listen | Where-Object { $_.LocalAddress -notin @('127.0.0.1', '::1') } |
    ForEach-Object { $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue; if ($p.ProcessName -eq 'node') { "  node (pid $($_.OwningProcess)) on $($_.LocalAddress):$($_.LocalPort)" } } | Sort-Object -Unique)
  "Node.js servers listening beyond loopback: $($wide.Count)"
  $wide
  $allowed = @($rules | Where-Object { $_.Enabled -eq 'True' -and $_.Action -eq 'Allow' })
  if ($allowed.Count -eq 0) { "RESULT: no enabled inbound Allow rule for node.exe." } else { "RESULT: $($allowed.Count) enabled inbound Allow rule(s) for node.exe." }
}
function Assert-Elevated {
  $id = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  if (-not $id.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw "REFUSED (nothing was changed): run this from an elevated PowerShell." }
}

if (-not $Apply -and -not $Rollback) { Show-State; return }
if ($Apply -and $Rollback) { throw "REFUSED (nothing was changed): choose -Apply or -Rollback." }

if ($Apply) {
  $targets = @(Get-NodeInboundRules | Where-Object { $_.Enabled -eq 'True' -and $_.Action -eq 'Allow' })
  "Rules to disable: $($targets.Count)"
  foreach ($r in $targets) { "  $($r.DisplayName) [$($r.Name)]" }
  if ($WhatIfPreference) { foreach ($r in $targets) { $r | Disable-NetFirewallRule -WhatIf }; "WHATIF: nothing was changed."; return }
  if ($Approval -ne 'A2') { throw "REFUSED (nothing was changed): -Apply needs -Approval A2, the owner's recorded approval." }
  Assert-Elevated
  if (-not (Test-Path $BackupDir)) { throw "REFUSED (nothing was changed): the backups folder $BackupDir doesn't exist." }
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $export = Join-Path $BackupDir "firewall-before-A2-$stamp.wfw"
  netsh advfirewall export "$export" | Out-Null
  if (-not (Test-Path $export)) { throw "STOPPED (nothing was changed): the firewall export failed." }
  $stateFile = Join-Path $BackupDir "firewall-A2-$stamp.json"
  @{ disabled = @($targets | ForEach-Object { $_.Name }); export = $export } | ConvertTo-Json | Set-Content -Path $stateFile -Encoding utf8
  foreach ($r in $targets) { $r | Disable-NetFirewallRule }
  $left = @(Get-NodeInboundRules | Where-Object { $_.Enabled -eq 'True' -and $_.Action -eq 'Allow' })
  if ($left.Count) { throw "STOPPED: $($left.Count) rule(s) still enabled. Roll back with -Rollback -Approval A2 -State `"$stateFile`"." }
  "A2 APPLIED AND VERIFIED: no enabled inbound Allow rule for node.exe. Policy export: $export. State: $stateFile"
  return
}

if ($Rollback) {
  if (-not $State -or -not (Test-Path $State)) { throw "REFUSED (nothing was changed): -Rollback needs -State <the file -Apply wrote>." }
  $names = @((Get-Content $State -Raw | ConvertFrom-Json).disabled)
  "Rules to re-enable: $($names.Count)"
  if ($WhatIfPreference) { foreach ($n in $names) { Enable-NetFirewallRule -Name $n -WhatIf }; "WHATIF: nothing was changed."; return }
  if ($Approval -ne 'A2') { throw "REFUSED (nothing was changed): -Rollback needs -Approval A2." }
  Assert-Elevated
  foreach ($n in $names) { Enable-NetFirewallRule -Name $n }
  "A2 ROLLED BACK: $($names.Count) rule(s) enabled again. (The full policy export also restores with: netsh advfirewall import <file>.)"
}
