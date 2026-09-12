<#
  Lucify iz jedne mape, jednim dvoklikom.

  Ovo je jedina datoteka koja smije pretpostaviti da na računalu nema ničega.
  Sve ostalo u projektu računa na to da Node već stoji; ovdje se to tek slaže.
  Zato je PowerShell, a ne Node: PowerShell na Windowsima stoji uvijek, a Node
  je upravo ono što se ovdje dohvaća.

  Redom: nađi Node (ili ga dohvati u `alati/node`), povuci ovisnosti, dohvati
  yt-dlp, složi program, pokreni instalaciju.

  Sve što se dohvaća ide u `alati/`, koja je u `.gitignore`: tuđi su to
  programi i nemaju što stajati u povijesti Lucifyja.

  Pokreće se kroz `pokreni.cmd`, a ne izravno, jer bi dvoklik na `.ps1` pao na
  pravilima izvođenja.

    pokreni.cmd                 dohvati što treba, složi program, instaliraj
    pokreni.cmd --samo-gradi    stani nakon `izdanje/`, bez instaliranja
    pokreni.cmd --osvjezi       dohvati Node i yt-dlp iznova, pa i ako stoje
#>
[CmdletBinding()]
param(
  [switch]$SamoGradi,
  [switch]$Osvjezi
)

$ErrorActionPreference = "Stop"
# Bez ovoga `Invoke-WebRequest` crta traku napretka i na tome izgubi više
# vremena nego na samom preuzimanju: tridesetak megabajta Nodea zna tako
# potrajati minutama umjesto sekundama.
$ProgressPreference = "SilentlyContinue"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

# Vite 6 i electron-builder traže 18 ili noviji; uzet je 20, jer je 18 izašao
# iz održavanja, pa se na njemu greške više ne popravljaju.
$NAJMANJI_NODE = 20
$GRANA_NODE = "https://nodejs.org/dist/latest-v22.x/"

$korijen = Split-Path -Parent $PSScriptRoot
$alati = Join-Path $korijen "alati"

function Korak([string]$t) { Write-Host ""; Write-Host "== $t" -ForegroundColor Cyan }
function Uredu([string]$t) { Write-Host "   $t" -ForegroundColor Green }
function Rijec([string]$t) { Write-Host "   $t" -ForegroundColor DarkGray }
function Stani([string]$t) {
  Write-Host ""
  Write-Host "!! $t" -ForegroundColor Red
  exit 1
}

# ---------------------------------------------------------------- Node

<# Glavni broj inačice, ili `$null` ako se program ne da pokrenuti. #>
function InacicaNodea([string]$exe) {
  try { $v = & $exe --version 2>$null } catch { return $null }
  if ($LASTEXITCODE -ne 0) { return $null }
  if ("$v" -match '^v(\d+)\.') { return [int]$Matches[1] }
  return $null
}

<# Mapa s `node.exe` i `npm.cmd`, ili `$null` ako Nodea nema. #>
function NadiNode {
  $vlastiti = Join-Path $alati "node\node.exe"
  if ((Test-Path $vlastiti) -and -not $Osvjezi) {
    $v = InacicaNodea $vlastiti
    if ($v -ge $NAJMANJI_NODE) {
      Uredu "Node $v stoji u alati\node"
      return (Split-Path -Parent $vlastiti)
    }
    Rijec "Node u alati\node ne valja, dohvaca se iznova."
  }

  if (-not $Osvjezi) {
    $sustavski = Get-Command node -ErrorAction SilentlyContinue
    if ($sustavski) {
      $v = InacicaNodea $sustavski.Source
      if ($v -ge $NAJMANJI_NODE) {
        Uredu "Node $v vec stoji na racunalu"
        return (Split-Path -Parent $sustavski.Source)
      }
      Rijec "Node $v je prestar, treba $NAJMANJI_NODE ili noviji."
    }
  }
  return $null
}

<# Prijenosni Node u `alati/node`. Vraća mapu u kojoj je završio. #>
function DohvatiNode {
  $arh = "x64"
  if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { $arh = "arm64" }

  # Iz `SHASUMS256.txt` dolaze i ime i kontrolni zbroj, pa se točna inačica ne
  # mora nigdje upisivati: ondje uvijek piše zadnja u grani.
  Rijec "Pitam nodejs.org koja je zadnja u grani..."
  try {
    $sume = (Invoke-WebRequest -UseBasicParsing -Uri ($GRANA_NODE + "SHASUMS256.txt")).Content
  } catch {
    Stani "Ne mogu do nodejs.org. Za ovaj jedan korak treba mreza. ($($_.Exception.Message))"
  }

  $redak = $sume -split "`n" | Where-Object { $_ -match "node-v[\d.]+-win-$arh\.zip\s*$" } | Select-Object -First 1
  if (-not $redak) { Stani "U popisu nema izdanja za win-$arh." }

  $dijelovi = $redak.Trim() -split '\s+'
  $suma = $dijelovi[0]
  $ime = $dijelovi[1]

  $privremeno = Join-Path ([System.IO.Path]::GetTempPath()) $ime
  Rijec "Dohvacam $ime"
  try {
    Invoke-WebRequest -UseBasicParsing -Uri ($GRANA_NODE + $ime) -OutFile $privremeno
  } catch {
    Stani "Preuzimanje Nodea nije uspjelo. ($($_.Exception.Message))"
  }

  # Provjera prije raspakiravanja: krnje preuzimanje ovdje puca naglas, a ne
  # poslije, na `npm install`, daleko od mjesta na kojem je nastalo.
  $nas = (Get-FileHash -Path $privremeno -Algorithm SHA256).Hash
  if ($nas -ne $suma.ToUpper()) {
    Remove-Item $privremeno -Force
    Stani "Kontrolni zbroj se ne slaze. Preuzeto je nesto drugo, pa se ne pokrece."
  }
  Rijec "Kontrolni zbroj se slaze."

  $raspakirano = Join-Path ([System.IO.Path]::GetTempPath()) ("lucify-node-" + [guid]::NewGuid().ToString("N"))
  Expand-Archive -Path $privremeno -DestinationPath $raspakirano -Force
  Remove-Item $privremeno -Force

  # U arhivi je jedna mapa, `node-v22...-win-x64`, pa se njezin sadržaj seli
  # pod stalno ime: ostalo u projektu ne smije ovisiti o broju inačice.
  $unutra = Get-ChildItem -Path $raspakirano -Directory | Select-Object -First 1
  $cilj = Join-Path $alati "node"
  if (Test-Path $cilj) { Remove-Item $cilj -Recurse -Force }
  New-Item -ItemType Directory -Path $alati -Force | Out-Null
  Move-Item -Path $unutra.FullName -Destination $cilj
  Remove-Item $raspakirano -Recurse -Force

  $v = InacicaNodea (Join-Path $cilj "node.exe")
  if (-not $v) { Stani "Node je raspakiran, ali se ne pokrece." }
  Uredu "Node $v stoji u alati\node"
  return $cilj
}

# ---------------------------------------------------------------- npm

<# Pokrene `npm <...>` i stane ako padne. #>
function Npm([string[]]$dijelovi, [string]$sto) {
  & "npm.cmd" @dijelovi
  if ($LASTEXITCODE -ne 0) { Stani "$sto nije uspjelo (npm $($dijelovi -join ' ') => $LASTEXITCODE)." }
}

<#
  Graditelj na Windowsima bez „Developer Mode” ne uspije raspakirati vlastiti
  alat za potpisivanje: u njemu stoje macOS simboličke veze, a za njih treba
  pravo koje običan račun nema. Isti je lijek opisan u README-u — raspakirati
  ga jednom ručno, bez `-snld`, pa graditelj poslije nađe gotovo.

  Vraća `$true` ako je nešto popravljeno, pa se gradnja isplati ponoviti.
#>
function PopraviWinCodeSign {
  $cache = Join-Path $env:LOCALAPPDATA "electron-builder\Cache\winCodeSign"
  if (-not (Test-Path $cache)) { return $false }

  $arhiva = Get-ChildItem -Path $cache -Filter "winCodeSign-*.7z" -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $arhiva) { return $false }

  $cilj = Join-Path $cache $arhiva.BaseName
  if (Test-Path $cilj) { return $false }

  $za = Join-Path $korijen "node_modules\7zip-bin\win\x64\7za.exe"
  if (-not (Test-Path $za)) { return $false }

  Rijec "Raspakiravam winCodeSign rucno..."
  # Dvije greške o `.dylib` vezama ostaju i ovdje, i to je u redu: one su za
  # macOS, a ovdje se gradi za Windows. Zato se gleda je li mapa nastala, a ne
  # je li 7za izašao bez greške.
  & $za x -bd -y $arhiva.FullName "-o$cilj" 2>&1 | Out-Null
  return (Test-Path $cilj)
}

# ---------------------------------------------------------------- posao

Write-Host ""
Write-Host "  Lucify" -ForegroundColor White
Write-Host "  vlastita zbirka glazbe i svirac uz nju" -ForegroundColor DarkGray
Write-Host ""
Rijec "Mapa: $korijen"

Set-Location $korijen

Korak "Node"
$nodeDir = NadiNode
if (-not $nodeDir) {
  Rijec "Nodea nema, pa dolazi vlastiti - ostaje u alati\node i ne dira sustav."
  $nodeDir = DohvatiNode
}
# Na početak putanje, da `npm` i sve što on pokrene vide baš ovaj Node.
$env:PATH = "$nodeDir;$env:PATH"

Korak "Ovisnosti"
Npm @("install") "Povlacenje ovisnosti"
Uredu "Ovisnosti stoje, uz njih i ffmpeg."

Korak "yt-dlp"
if ($Osvjezi) { Npm @("run", "alati", "--", "--osvjezi") "Dohvacanje yt-dlpa" }
else { Npm @("run", "alati") "Dohvacanje yt-dlpa" }

if ($SamoGradi) { Korak "Gradnja (bez instaliranja)" } else { Korak "Gradnja" }
& "npm.cmd" "run" "pakiraj"
if ($LASTEXITCODE -ne 0) {
  Rijec "Gradnja je pala; gledam je li posrijedi winCodeSign."
  if (PopraviWinCodeSign) {
    Rijec "Popravljeno, gradim iznova."
    Npm @("run", "pakiraj") "Gradnja"
  } else {
    Stani "Gradnja nije uspjela, a winCodeSign nije kriv. Poruka je gore."
  }
}

$izdanje = Join-Path $korijen "izdanje"
$instalacija = Get-ChildItem -Path $izdanje -Filter "*instalacija.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
$prijenosni = Get-ChildItem -Path $izdanje -Filter "*prijenosni.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $instalacija) { Stani "Gradnja je prosla, ali u izdanje\ nema instalacije." }

Korak "Gotovo"
Uredu $instalacija.Name
if ($prijenosni) { Uredu $prijenosni.Name }
Rijec "Obje stoje u: $izdanje"

if ($SamoGradi) {
  Write-Host ""
  Rijec "Instalacija se ne pokrece, jer je zadano --samo-gradi."
  exit 0
}

Write-Host ""
Write-Host "   Pokrecem instalaciju." -ForegroundColor White
Rijec "Zbirka poslije stoji u Glazba\Lucify\ u korisnikovoj mapi, pa prezivi nadogradnju."
Start-Process -FilePath $instalacija.FullName
