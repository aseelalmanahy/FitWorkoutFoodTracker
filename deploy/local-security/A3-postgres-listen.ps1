<#
A3 (SEC-03): PostgreSQL listens on this PC only (listen_addresses = 'localhost'), instead of every address ('*').
Today pg_hba.conf already refuses remote connections; this removes the listener itself, as defence in depth.

  .\A3-postgres-listen.ps1                         Check, read only: the setting, the listeners, any remote connections
  .\A3-postgres-listen.ps1 -Apply -WhatIf          What -Apply would change, changing nothing
  .\A3-postgres-listen.ps1 -Apply -Approval A3     Elevated, with the owner's A3 approval: copies postgresql.conf to the
                                                   backups folder, changes that one line, restarts the service, verifies
  .\A3-postgres-listen.ps1 -Rollback -Approval A3 -Backup <file>   Elevated: puts the copy back and restarts
For a rehearsal on a copy: -ConfPath <copy> -NoRestart (no elevation needed; the service isn't touched).

Downtime: the restart takes about 5 to 10 s; requests in flight on 3000 to 3003 fail, and Prisma reconnects.
Dependencies checked first: no established connection to 5432 from another machine. Anything that reaches PostgreSQL
through a non-loopback address (for example a Docker container through host.docker.internal) stops working; none is
in use here, and the G1 rehearsal uses its own throwaway database container instead.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [switch]$Apply,
  [switch]$Rollback,
  [string]$Approval,
  [string]$Backup,
  [string]$ConfPath = "C:\Program Files\PostgreSQL\18\data\postgresql.conf",
  [string]$Service = "postgresql-x64-18",
  [string]$BackupDir,
  [switch]$NoRestart
)
$ErrorActionPreference = "Stop"
# Windows PowerShell 5.1 doesn't set $PSScriptRoot in parameter defaults.
if (-not $BackupDir) { $BackupDir = Join-Path $PSScriptRoot "..\..\..\FitWorkoutFoodTracker-backups" }
$pattern = '^\s*listen_addresses\s*=\s*(''[^'']*'')'

function Get-ListenLines([string[]]$lines) { @($lines | Select-String -Pattern $pattern) }
function Show-State {
  $lines = Get-Content -LiteralPath $ConfPath
  $active = Get-ListenLines $lines
  "postgresql.conf: $($active.Count) active listen_addresses line(s): $(($active | ForEach-Object { $_.Line.Trim() }) -join ' | ')"
  $listen = @(Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $_.LocalAddress } | Sort-Object -Unique)
  "Listening on 5432: $($listen -join ', ')"
  $remote = @(Get-NetTCPConnection -LocalPort 5432 -State Established -ErrorAction SilentlyContinue | Where-Object { $_.RemoteAddress -notin @('127.0.0.1', '::1') })
  "Established connections from other addresses: $($remote.Count)"
  foreach ($c in $remote) { "  from $($c.RemoteAddress)" }
  if ($listen | Where-Object { $_ -notin @('127.0.0.1', '::1') }) { "RESULT: PostgreSQL listens beyond loopback." } else { "RESULT: loopback only." }
}
function Assert-Elevated {
  $id = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  if (-not $id.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw "REFUSED (nothing was changed): run this from an elevated PowerShell." }
}
function Restart-AndVerify([string]$expect) {
  if ($NoRestart) { "Not restarted (-NoRestart)."; return }
  Restart-Service -Name $Service
  $deadline = (Get-Date).AddSeconds(30)
  do { Start-Sleep -Milliseconds 500; $l = @(Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue) } until ($l.Count -or (Get-Date) -gt $deadline)
  $addrs = @($l | ForEach-Object { $_.LocalAddress } | Sort-Object -Unique)
  "Listening on 5432 after the restart: $($addrs -join ', ')"
  if ($expect -eq 'loopback' -and ($addrs | Where-Object { $_ -notin @('127.0.0.1', '::1') })) { throw "STOPPED: still listening beyond loopback. Roll back with -Rollback -Approval A3 -Backup <the copy>." }
  if (-not $addrs.Count) { throw "STOPPED: PostgreSQL isn't listening. Roll back with -Rollback -Approval A3 -Backup <the copy>." }
}

if (-not (Test-Path -LiteralPath $ConfPath)) { throw "REFUSED (nothing was changed): $ConfPath doesn't exist." }
if (-not $Apply -and -not $Rollback) { Show-State; return }
if ($Apply -and $Rollback) { throw "REFUSED (nothing was changed): choose -Apply or -Rollback." }
$rehearsal = $NoRestart -and ($ConfPath -ne "C:\Program Files\PostgreSQL\18\data\postgresql.conf")

if ($Apply) {
  $raw = [IO.File]::ReadAllText($ConfPath)
  $nl = if ($raw.Contains("`r`n")) { "`r`n" } else { "`n" }
  # Every line, the same in Windows PowerShell 5.1 and PowerShell 7: in PowerShell 7, `-split ..., -1` returns the
  # whole file as one piece, so the line would never be found and -Apply would refuse.
  $lines = [regex]::Split($raw, "\r?\n")
  $active = Get-ListenLines $lines
  if ($active.Count -ne 1) { throw "REFUSED (nothing was changed): expected exactly one active listen_addresses line, found $($active.Count)." }
  $old = $active[0].Line
  $new = $old -replace $pattern, "listen_addresses = 'localhost'"
  "Change, line $($active[0].LineNumber): $($old.Trim())  ->  $($new.Trim())"
  if ($old -eq $new) { "Already loopback only: nothing to change."; return }
  $remote = @(Get-NetTCPConnection -LocalPort 5432 -State Established -ErrorAction SilentlyContinue | Where-Object { $_.RemoteAddress -notin @('127.0.0.1', '::1') })
  if ($remote.Count) { throw "REFUSED (nothing was changed): $($remote.Count) connection(s) to PostgreSQL from another address would be cut: $(($remote | ForEach-Object RemoteAddress) -join ', ')." }
  if ($WhatIfPreference) { "WHATIF: nothing was changed."; return }
  if ($Approval -ne 'A3' -and -not $rehearsal) { throw "REFUSED (nothing was changed): -Apply needs -Approval A3, the owner's recorded approval." }
  if (-not $rehearsal) { Assert-Elevated }
  if (-not (Test-Path $BackupDir)) { throw "REFUSED (nothing was changed): the backups folder $BackupDir doesn't exist." }
  $copy = Join-Path $BackupDir ("postgresql.conf.before-A3-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
  Copy-Item -LiteralPath $ConfPath -Destination $copy
  if ((Get-FileHash $copy).Hash -ne (Get-FileHash -LiteralPath $ConfPath).Hash) { throw "STOPPED (nothing was changed): the backup copy doesn't match." }
  $lines[$active[0].LineNumber - 1] = $new
  [IO.File]::WriteAllText($ConfPath, ($lines -join $nl))
  $after = Get-ListenLines (Get-Content -LiteralPath $ConfPath)
  if ($after.Count -ne 1 -or $after[0].Line -ne $new) { Copy-Item -LiteralPath $copy -Destination $ConfPath -Force; throw "STOPPED: the edit didn't read back; the copy was put back." }
  "Backup: $copy"
  Restart-AndVerify 'loopback'
  "A3 APPLIED$(if ($NoRestart) { ' (file only)' } else { ' AND VERIFIED: PostgreSQL listens on loopback only' })."
  return
}

if ($Rollback) {
  if (-not $Backup -or -not (Test-Path -LiteralPath $Backup)) { throw "REFUSED (nothing was changed): -Rollback needs -Backup <the copy -Apply made>." }
  if ($WhatIfPreference) { "WHATIF: would copy $Backup over $ConfPath and restart $Service."; return }
  if ($Approval -ne 'A3' -and -not $rehearsal) { throw "REFUSED (nothing was changed): -Rollback needs -Approval A3." }
  if (-not $rehearsal) { Assert-Elevated }
  Copy-Item -LiteralPath $Backup -Destination $ConfPath -Force
  Restart-AndVerify 'any'
  "A3 ROLLED BACK: the previous postgresql.conf is back."
}
