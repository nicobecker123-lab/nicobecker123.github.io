<#
.SYNOPSIS
SystemOS / Ornith: rekursiver Konzeptordner-Crawler (ein Skript, kein Einfuegen in die Konsole noetig).

.DESCRIPTION
Durchlaeuft den Zielordner bis zur letzten Datei und schreibt in einen Lauf-Ordner:
  konzeptordner_wct_manifest.json   Inventar aller Dateien (Pfad, Groesse, SHA-256)
  konzeptordner_mindmap.json        Baum fuer den 3D-Sandkasten (Button "Ordner-Scan anhaengen")
  crawl.log                         Protokoll

Aufruf (Datei speichern, dann im Ordner der Datei):
  powershell -ExecutionPolicy Bypass -File .\Start-OrnithKonzeptCrawler.ps1
  powershell -ExecutionPolicy Bypass -File .\Start-OrnithKonzeptCrawler.ps1 -TargetFolder "C:\Users\Nico Becke\Desktop\Konzeptordner"
  ... -BatchLimit 500     nur die ersten 500 Dateien (Probelauf)
  ... -NoHash             ohne SHA-256 (viel schneller)

.PARAMETER TargetFolder
Zu scannender Ordner. Leer = Desktop\Konzeptordner, sonst der Ordner ueber diesem Skript.
.PARAMETER OutputRoot
Ausgabe-Wurzel. Leer = .\systemos-runs neben dem Skript.
.PARAMETER BatchLimit
0 = alle Dateien, sonst Abbruch nach N Dateien.
.PARAMETER MaxHashMB
Dateien ueber dieser Groesse werden nicht gehasht (Vermerk SKIPPED_LARGE).
.PARAMETER NoHash
Keine SHA-256-Summen berechnen.
#>
[CmdletBinding()]
param(
    [string]$TargetFolder = "",
    [string]$OutputRoot = "",
    [int]$BatchLimit = 0,
    [int]$MaxHashMB = 50,
    [switch]$NoHash
)

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------- Hilfsfunktionen
function Write-OrnithLog {
    param(
        [Parameter(Mandatory = $true, Position = 0)][string]$Message,
        [Parameter(Position = 1)][ValidateSet("INFO", "WARN", "ERROR", "SUCCESS")][string]$Level = "INFO"
    )
    $color = switch ($Level) {
        "INFO"    { "Cyan" }
        "WARN"    { "Yellow" }
        "ERROR"   { "Red" }
        "SUCCESS" { "Green" }
    }
    $line = "{0} [{1}] {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Level, $Message
    Write-Host $line -ForegroundColor $color
    if ($script:LogPath) {
        Add-Content -LiteralPath $script:LogPath -Value $line -Encoding UTF8
    }
}

function Format-Size {
    param([double]$Bytes)
    $inv = [System.Globalization.CultureInfo]::InvariantCulture
    foreach ($unit in @("B", "KB", "MB", "GB", "TB")) {
        if ($Bytes -lt 1024 -or $unit -eq "TB") {
            if ($unit -eq "B") { return ("{0} B" -f [int]$Bytes) }
            return ("{0} {1}" -f $Bytes.ToString("0.0", $inv), $unit)
        }
        $Bytes = $Bytes / 1024
    }
}

function Save-Json {
    param($Object, [string]$Path)
    $json = ConvertTo-Json -InputObject $Object -Depth 100 -Compress
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $json, $utf8NoBom)
}

function Get-FileHashHex {
    param([string]$Path)
    $stream = $null
    try {
        $stream = [System.IO.File]::OpenRead($Path)
        $bytes = $script:Sha.ComputeHash($stream)
        return ([System.BitConverter]::ToString($bytes)).Replace("-", "").ToLower()
    }
    catch {
        return "READ_ERROR"
    }
    finally {
        if ($null -ne $stream) { $stream.Dispose() }
    }
}

function Scan-Directory {
    param(
        [System.IO.DirectoryInfo]$Dir,
        [string]$Rel
    )

    $node = [ordered]@{ n = $Dir.Name; s = "ordner"; p = $Rel }
    $kids = New-Object System.Collections.Generic.List[object]
    $fileCount = 0
    $byteSum = [int64]0

    $entries = @(Get-ChildItem -LiteralPath $Dir.FullName -Force -ErrorAction SilentlyContinue)
    $subDirs = @($entries | Where-Object { $_.PSIsContainer } | Sort-Object Name)
    $files = @($entries | Where-Object { -not $_.PSIsContainer } | Sort-Object Name)

    foreach ($d in $subDirs) {
        if ($script:Stop) { break }
        if ($script:ExcludeDirs -contains $d.Name) { continue }
        if ($d.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { continue }
        $sub = Scan-Directory -Dir $d -Rel ($Rel + "/" + $d.Name)
        $kids.Add($sub.Node)
        $fileCount += $sub.Files
        $byteSum += $sub.Bytes
    }

    foreach ($f in $files) {
        if ($script:Stop) { break }
        $script:Count++

        if ($NoHash) {
            $hash = "NOT_COMPUTED"
        }
        elseif ($f.Length -gt ($MaxHashMB * 1MB)) {
            $hash = "SKIPPED_LARGE"
        }
        else {
            $hash = Get-FileHashHex -Path $f.FullName
        }

        $relFile = $Rel + "/" + $f.Name
        $script:Inventory.Add([pscustomobject]@{
                path   = $relFile
                name   = $f.Name
                bytes  = $f.Length
                sha256 = $hash
            })
        $kids.Add([ordered]@{ n = $f.Name; s = "datei"; m = (Format-Size $f.Length); p = $relFile })
        $fileCount++
        $byteSum += $f.Length

        if (($script:Count % 500) -eq 0) {
            Write-Progress -Activity "Ornith Traversierung" -Status ("{0} Dateien erfasst" -f $script:Count) -CurrentOperation $Rel
        }
        if ($BatchLimit -gt 0 -and $script:Count -ge $BatchLimit) {
            $script:Stop = $true
        }
    }

    $node["m"] = "{0} Dateien - {1}" -f $fileCount, (Format-Size $byteSum)
    if ($kids.Count -gt 0) { $node["c"] = $kids }

    return [pscustomobject]@{ Node = $node; Files = $fileCount; Bytes = $byteSum }
}

# ---------------------------------------------------------------- Pfade bestimmen
$scriptDir = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($scriptDir)) {
    $scriptDir = (Get-Location).Path
    Write-Host "[WARN] Skript wurde nicht als Datei gestartet, nehme aktuellen Ordner: $scriptDir" -ForegroundColor Yellow
}

if ([string]::IsNullOrWhiteSpace($TargetFolder)) {
    $desktopDefault = Join-Path ([Environment]::GetFolderPath("Desktop")) "Konzeptordner"
    if (Test-Path -LiteralPath $desktopDefault -PathType Container) {
        $TargetFolder = $desktopDefault
    }
    else {
        $TargetFolder = (Get-Item -LiteralPath $scriptDir).Parent.FullName
    }
}
if (-not (Test-Path -LiteralPath $TargetFolder -PathType Container)) {
    Write-Host "[ERROR] Zielordner nicht gefunden: '$TargetFolder'" -ForegroundColor Red
    exit 1
}
$rootFull = (Get-Item -LiteralPath $TargetFolder).FullName.TrimEnd("\", "/")
if ([string]::IsNullOrEmpty($rootFull)) { $rootFull = (Get-Item -LiteralPath $TargetFolder).FullName }

if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $OutputRoot = Join-Path $scriptDir "systemos-runs"
}
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$runDir = Join-Path ([System.IO.Path]::GetFullPath($OutputRoot)) ("ornith_crawl_" + $timestamp)
New-Item -ItemType Directory -Path $runDir -Force | Out-Null

$manifestPath = Join-Path $runDir "konzeptordner_wct_manifest.json"
$mindmapPath = Join-Path $runDir "konzeptordner_mindmap.json"
$script:LogPath = Join-Path $runDir "crawl.log"

# ---------------------------------------------------------------- Scan
$script:ExcludeDirs = @("node_modules", ".git", ".venv", "__pycache__", "systemos-runs", "dist", "build")
$script:Inventory = New-Object System.Collections.Generic.List[object]
$script:Count = 0
$script:Stop = $false
$script:Sha = [System.Security.Cryptography.SHA256]::Create()

Write-Host ""
Write-Host "    ORNITH-CHARON // STARTE AUTARKE TRAVERSIERUNG" -ForegroundColor Green
Write-Host ""
Write-OrnithLog "Zielverzeichnis: $rootFull"
Write-OrnithLog "Ausgabe: $runDir"
if ($NoHash) { Write-OrnithLog "SHA-256 deaktiviert (-NoHash)" "WARN" }
if ($BatchLimit -gt 0) { Write-OrnithLog "Probelauf: maximal $BatchLimit Dateien" "WARN" }

$clock = [System.Diagnostics.Stopwatch]::StartNew()
try {
    $rootName = Split-Path -Path $rootFull -Leaf
    if ([string]::IsNullOrEmpty($rootName)) { $rootName = $rootFull }
    $result = Scan-Directory -Dir (Get-Item -LiteralPath $rootFull) -Rel $rootName
}
finally {
    $script:Sha.Dispose()
    Write-Progress -Activity "Ornith Traversierung" -Completed
}
$clock.Stop()
$elapsedSec = [math]::Round($clock.Elapsed.TotalSeconds, 1)
Write-OrnithLog "Traversierung erfolgreich in $elapsedSec s beendet." "SUCCESS"

# ---------------------------------------------------------------- Ausgabe
$manifest = [ordered]@{
    engine      = "ORNITH-CHARON-99-TRAVERSER"
    root        = $rootFull
    timestamp   = (Get-Date).ToString("o")
    total_files = $script:Inventory.Count
    total_bytes = $result.Bytes
    truncated   = [bool]$script:Stop
    files       = $script:Inventory
}
Save-Json -Object $manifest -Path $manifestPath
Save-Json -Object $result.Node -Path $mindmapPath

Write-OrnithLog ("{0} Dateien erfasst ({1})." -f $script:Count, (Format-Size $result.Bytes)) "SUCCESS"
Write-OrnithLog "Manifest versiegelt: $manifestPath" "SUCCESS"
Write-OrnithLog "Mindmap-Baum: $mindmapPath" "SUCCESS"
Write-Host ""
Write-Host "    ORNITH TRAVERSAL: ARTEFAKTE GESICHERT" -ForegroundColor Green
Write-Host ""
Write-Host "Naechster Schritt: im 3D-Sandkasten Zielknoten waehlen, 'Ordner-Scan anhaengen' klicken und" -ForegroundColor Cyan
Write-Host "die Datei konzeptordner_mindmap.json auswaehlen." -ForegroundColor Cyan
