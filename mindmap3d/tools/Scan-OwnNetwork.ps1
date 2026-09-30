<#
.SYNOPSIS
Startet nmap gegen EIGENE Geraete und schreibt eine XML-Datei fuer den 3D-Sandkasten (Button "Netzwerk").

.DESCRIPTION
Schutzgelaender, damit daraus kein Werkzeug fuer fremde Netze wird:
- nur IP-Adressen und Bereiche aus privaten Netzen (127/8, 10/8, 172.16/12, 192.168/16, 169.254/16), keine Hostnamen
- Bereiche nur bis /24 (hoechstens 256 Adressen)
- vorher ausdrueckliche Bestaetigung "JA", dass du Eigentuemer oder Administrator der Ziele bist
- nur Ports und Diensterkennung, keine Skripte, kein -A, kein Ausnutzen
nmap muss installiert sein (nmap.org).

.EXAMPLE
  pwsh -ExecutionPolicy Bypass -File .\Scan-OwnNetwork.ps1
  pwsh -ExecutionPolicy Bypass -File .\Scan-OwnNetwork.ps1 -Target 192.168.0.0/24 -ServiceVersions
#>
[CmdletBinding()]
param(
    [string]$Target = "127.0.0.1",
    [string]$Ports = "1-1024,3389,5900,8000-8100,11434",
    [switch]$ServiceVersions,
    [string]$OutDir = ""
)

$ErrorActionPreference = "Stop"

function Test-PrivateIPv4 {
    param([string]$Text)
    $ip = $null
    if (-not [System.Net.IPAddress]::TryParse($Text, [ref]$ip)) { return $false }
    if ($ip.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) { return $false }
    $b = $ip.GetAddressBytes()
    if ($b[0] -eq 127) { return $true }
    if ($b[0] -eq 10) { return $true }
    if ($b[0] -eq 172 -and $b[1] -ge 16 -and $b[1] -le 31) { return $true }
    if ($b[0] -eq 192 -and $b[1] -eq 168) { return $true }
    if ($b[0] -eq 169 -and $b[1] -eq 254) { return $true }
    return $false
}

$nmap = $null
$cmd = Get-Command nmap -ErrorAction SilentlyContinue
if ($cmd) { $nmap = $cmd.Source }
foreach ($p in @("C:\Program Files (x86)\Nmap\nmap.exe", "C:\Program Files\Nmap\nmap.exe")) {
    if (-not $nmap -and (Test-Path -LiteralPath $p)) { $nmap = $p }
}
if (-not $nmap) {
    Write-Host "[ERROR] nmap nicht gefunden. Installation: https://nmap.org/download" -ForegroundColor Red
    exit 1
}

$targets = @($Target -split "[,\s]+" | Where-Object { $_ })
if ($targets.Count -eq 0) { Write-Host "[ERROR] Kein Ziel angegeben." -ForegroundColor Red; exit 1 }
foreach ($t in $targets) {
    $ipPart = $t
    if ($t -match "^(.+)/(\d+)$") {
        $ipPart = $Matches[1]
        if ([int]$Matches[2] -lt 24) {
            Write-Host "[ERROR] Bereich $t ist zu gross (erlaubt: /24 bis /32)." -ForegroundColor Red
            exit 1
        }
    }
    if (-not (Test-PrivateIPv4 $ipPart)) {
        Write-Host "[ERROR] Ziel '$t' ist keine private IPv4-Adresse. Es werden nur eigene Geraete im lokalen Netz gescannt." -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "Ziele : $($targets -join ', ')" -ForegroundColor Cyan
Write-Host "Ports : $Ports" -ForegroundColor Cyan
Write-Host "Nur eigene Geraete scannen. Ein Scan fremder Geraete ohne Erlaubnis kann verboten sein." -ForegroundColor Yellow
$answer = Read-Host "Tippe JA, wenn du Eigentuemer oder Administrator dieser Ziele bist"
if ($answer -ne "JA") {
    Write-Host "Abgebrochen." -ForegroundColor Yellow
    exit 0
}

if ([string]::IsNullOrWhiteSpace($OutDir)) {
    $base = $PSScriptRoot
    if ([string]::IsNullOrWhiteSpace($base)) { $base = (Get-Location).Path }
    $OutDir = Join-Path $base "nmap-runs"
}
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
$xml = Join-Path $OutDir ("nmap_" + (Get-Date -Format "yyyyMMdd_HHmmss") + ".xml")

$nmapArgs = @("-T3", "--open", "-p", $Ports, "-oX", $xml)
if ($ServiceVersions) { $nmapArgs += "-sV" }
$nmapArgs += $targets

Write-Host ""
Write-Host "Starte: nmap $($nmapArgs -join ' ')" -ForegroundColor Cyan
& $nmap @nmapArgs
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] nmap endete mit Code $LASTEXITCODE." -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "[SUCCESS] Ergebnis: $xml" -ForegroundColor Green
Write-Host "Naechster Schritt: im 3D-Sandkasten 'Netzwerk' oeffnen und diese XML-Datei importieren." -ForegroundColor Cyan
