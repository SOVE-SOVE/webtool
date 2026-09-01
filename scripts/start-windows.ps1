# Starts Web Design OS for local development on Windows: Postgres (via
# Docker), the API, and the web app - then opens the app in your
# default browser. See scripts/README.md.
#
# Run via scripts/start-windows.bat (double-click it in Explorer). Can
# also be run directly from PowerShell:
#   powershell -ExecutionPolicy Bypass -File scripts\start-windows.ps1
#
# Assumes the one-time setup in the repo README's "Local development"
# section has already been done (apps\api\.venv, apps\api\.env,
# apps\web\node_modules, apps\web\.env.local all exist) - this script
# starts services, it doesn't provision them.

$ScriptDir = $PSScriptRoot
$RepoRoot  = Split-Path $ScriptDir -Parent
$RunDir    = Join-Path $ScriptDir ".run"
$LogDir    = Join-Path $ScriptDir ".logs"
New-Item -ItemType Directory -Force -Path $RunDir, $LogDir | Out-Null

$ApiDir  = Join-Path $RepoRoot "apps\api"
$WebDir  = Join-Path $RepoRoot "apps\web"
$ApiPort = 8000
$WebPort = 3000
# 127.0.0.1, not localhost: on this class of Windows/Docker Desktop (WSL2)
# setup, "localhost" resolves ::1 first and nothing answers there (uvicorn
# and next dev only bind IPv4), so every health check burns its timeout on
# a doomed IPv6 attempt before ever trying IPv4 - verified directly (10/10
# 2s-timeout requests to "localhost" timed out; 127.0.0.1 requests did not).
$ApiUrl  = "http://127.0.0.1:$ApiPort"
$WebUrl  = "http://127.0.0.1:$WebPort"

$ApiPidFile = Join-Path $RunDir "api.pid"
$WebPidFile = Join-Path $RunDir "web.pid"
$ApiLog     = Join-Path $LogDir "api.log"
$WebLog     = Join-Path $LogDir "web.log"

function Write-Info { param($msg) Write-Host "-> $msg" }
function Write-Ok   { param($msg) Write-Host "[OK] $msg" }

function Invoke-Fail {
    param($msg, $logFile)
    Write-Host ""
    Write-Host "[FAILED] $msg" -ForegroundColor Red
    if ($logFile -and (Test-Path $logFile)) {
        Write-Host "   Last lines of $logFile :"
        Get-Content -Tail 20 $logFile | ForEach-Object { Write-Host "   $_" }
    }
    Write-Host ""
    exit 1
}

function Test-Url {
    param($Url, [int]$TimeoutSec = 2)
    try {
        Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Wait-Until {
    param([scriptblock]$Check, [int]$TimeoutSec)
    $waited = 0
    while (-not (& $Check)) {
        Start-Sleep -Seconds 1
        $waited++
        if ($waited -ge $TimeoutSec) { return $false }
    }
    return $true
}

function Test-PortListening {
    param([int]$Port)
    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

Write-Host ""
Write-Host "Web Design OS - starting local development environment"
Write-Host ""

# --- 1. Docker + Postgres -------------------------------------------------
Write-Info "Checking Docker..."
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Invoke-Fail "Docker isn't installed. Install Docker Desktop from https://www.docker.com/products/docker-desktop/ and run this again."
}

docker info *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Info "Docker Desktop isn't running - starting it..."
    $dockerExe = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    if (Test-Path $dockerExe) {
        Start-Process -FilePath $dockerExe | Out-Null
    } else {
        Invoke-Fail "Couldn't find Docker Desktop to start automatically. Start it yourself, wait for it to finish starting, then run this again."
    }
    $ready = Wait-Until -TimeoutSec 60 -Check {
        docker info *> $null
        $LASTEXITCODE -eq 0
    }
    if (-not $ready) {
        Invoke-Fail "Docker Desktop didn't finish starting within 60s. Open it manually, wait for it to settle, then run this again."
    }
}
Write-Ok "Docker is running"

Write-Info "Starting Postgres..."
Push-Location $RepoRoot
docker compose up -d postgres
$composeOk = ($LASTEXITCODE -eq 0)
Pop-Location
if (-not $composeOk) {
    Invoke-Fail "docker compose up -d postgres failed. See the output above."
}

$pgReady = Wait-Until -TimeoutSec 30 -Check {
    Push-Location $RepoRoot
    docker compose exec -T postgres pg_isready -U webdesignos -d webdesignos *> $null
    $rc = $LASTEXITCODE
    Pop-Location
    $rc -eq 0
}
if (-not $pgReady) {
    Invoke-Fail "Postgres didn't become ready within 30s."
}
Write-Ok "Postgres is ready"

# --- 2. API ----------------------------------------------------------------
if (Test-Url "$ApiUrl/health") {
    Write-Ok "API already running at $ApiUrl - leaving it as is"
} else {
    $venvPython = Join-Path $ApiDir ".venv\Scripts\python.exe"
    if (-not (Test-Path $venvPython)) {
        Invoke-Fail "apps\api isn't set up yet (no .venv). Follow the 'Local development' steps in the repo README first."
    }
    if (-not (Test-Path (Join-Path $ApiDir ".env"))) {
        Invoke-Fail "apps\api\.env is missing. Copy apps\api\.env.example to apps\api\.env and fill it in first - see the repo README."
    }
    if (Test-PortListening $ApiPort) {
        Invoke-Fail "Something else is already listening on port $ApiPort (and it didn't answer $ApiUrl/health, so it isn't this app's API). Stop it, or free the port, and try again."
    }

    Write-Info "Starting the API..."
    $proc = Start-Process -FilePath $venvPython `
        -ArgumentList @("-m", "uvicorn", "app.main:app", "--reload", "--port", "$ApiPort") `
        -WorkingDirectory $ApiDir `
        -WindowStyle Hidden `
        -RedirectStandardOutput $ApiLog `
        -RedirectStandardError "$ApiLog.err" `
        -PassThru
    $proc.Id | Out-File -Encoding ascii $ApiPidFile

    $apiReady = Wait-Until -TimeoutSec 30 -Check { Test-Url "$ApiUrl/health" }
    if (-not $apiReady) {
        Invoke-Fail "The API didn't respond at $ApiUrl/health within 30s." $ApiLog
    }
    Write-Ok "API is ready at $ApiUrl"
}

# --- 3. Web app --------------------------------------------------------------
if (Test-Url $WebUrl) {
    Write-Ok "Web app already running at $WebUrl - leaving it as is"
} else {
    $nextCmd = Join-Path $WebDir "node_modules\.bin\next.cmd"
    if (-not (Test-Path $nextCmd)) {
        Invoke-Fail "apps\web isn't set up yet (no node_modules). Run 'npm install' in apps\web first - see the repo README."
    }
    if (-not (Test-Path (Join-Path $WebDir ".env.local"))) {
        Invoke-Fail "apps\web\.env.local is missing. Copy apps\web\.env.local.example to apps\web\.env.local first - see the repo README."
    }
    if (Test-PortListening $WebPort) {
        Invoke-Fail "Something else is already listening on port $WebPort. Stop it, or free the port, and try again."
    }

    Write-Info "Starting the web app..."
    # cmd.exe /c wraps next.cmd: PowerShell's Start-Process needs a real
    # Win32 executable once output redirection is in play, not a .cmd
    # shim directly. Which PID ends up holding the port doesn't matter -
    # stop-windows.ps1 finds and stops whoever that turns out to be, not
    # this one. A single pre-built string (not an array) for -ArgumentList
    # is used verbatim by Start-Process, so the embedded quoting around
    # $nextCmd (needed in case the repo path contains a space) survives
    # exactly as written instead of depending on how an array would be
    # re-joined.
    $webArgs = "/c `"$nextCmd`" dev --port $WebPort"
    $proc = Start-Process -FilePath "cmd.exe" `
        -ArgumentList $webArgs `
        -WorkingDirectory $WebDir `
        -WindowStyle Hidden `
        -RedirectStandardOutput $WebLog `
        -RedirectStandardError "$WebLog.err" `
        -PassThru
    $proc.Id | Out-File -Encoding ascii $WebPidFile

    $webReady = Wait-Until -TimeoutSec 60 -Check { Test-Url $WebUrl }
    if (-not $webReady) {
        Invoke-Fail "The web app didn't respond at $WebUrl within 60s." $WebLog
    }
    Write-Ok "Web app is ready at $WebUrl"
}

# --- 4. Open the browser -------------------------------------------------------
Write-Info "Opening $WebUrl/login ..."
Start-Process "$WebUrl/login"

Write-Host ""
Write-Ok "Web Design OS is running."
Write-Host "   API: $ApiUrl   (log: $ApiLog)"
Write-Host "   Web: $WebUrl   (log: $WebLog)"
Write-Host "   Run scripts\stop-windows.bat to shut everything down."
Write-Host ""
