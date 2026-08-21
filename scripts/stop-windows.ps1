# Stops what scripts/start-windows.bat started: the web app, the API,
# and Postgres. See scripts/README.md.
#
# Run via scripts/stop-windows.bat (double-click it in Explorer).

$ScriptDir = $PSScriptRoot
$RepoRoot  = Split-Path $ScriptDir -Parent
$RunDir    = Join-Path $ScriptDir ".run"

Write-Host ""
Write-Host "Web Design OS - stopping local development environment"
Write-Host ""

# Stops whatever is actually listening on $Port right now - not the pid
# recorded at start time. A dev server can be more than one process
# sharing the same listening socket (uvicorn --reload runs a reloader
# parent plus a worker child that both hold it; a .cmd-started `next dev`
# is its own small tree) - the process(es) actually holding the socket
# are the reliable handle regardless of what wraps or accompanies them.
# $MatchPattern guards against ever stopping a *different* program that
# happens to be using the port.
function Stop-Port {
    param($Name, [int]$Port, $MatchPattern, $PidFile)

    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $conns) {
        Write-Host "-> $Name : not running (nothing listening on port $Port)"
        Remove-Item $PidFile -ErrorAction SilentlyContinue
        return
    }

    $matched = $false
    foreach ($conn in $conns) {
        $procId = $conn.OwningProcess
        $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue).CommandLine
        if ($cmdLine -like "*$MatchPattern*") {
            taskkill /PID $procId /T /F *> $null
            $matched = $true
        }
    }

    if (-not $matched) {
        Write-Host "-> $Name : something is listening on port $Port, but it doesn't look like this app's process - leaving it alone"
        return
    }

    $stillUp = $false
    for ($i = 0; $i -lt 10; $i++) {
        Start-Sleep -Seconds 1
        if (-not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) {
            $stillUp = $false
            break
        }
        $stillUp = $true
    }
    if ($stillUp) {
        Write-Host "-> $Name : still running after 10s - forcing..."
        Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
            ForEach-Object { taskkill /PID $_.OwningProcess /T /F *> $null }
    }
    Remove-Item $PidFile -ErrorAction SilentlyContinue
    Write-Host "[OK] $Name stopped"
}

Stop-Port -Name "API" -Port 8000 -MatchPattern "app.main:app" -PidFile (Join-Path $RunDir "api.pid")
Stop-Port -Name "Web app" -Port 3000 -MatchPattern "next" -PidFile (Join-Path $RunDir "web.pid")

Write-Host "-> Stopping Postgres..."
Push-Location $RepoRoot
docker compose stop postgres *> $null
$rc = $LASTEXITCODE
Pop-Location
if ($rc -eq 0) {
    Write-Host "[OK] Postgres stopped"
} else {
    Write-Host "[WARN] Couldn't stop Postgres (Docker may not be running, or it was already stopped)"
}

Write-Host ""
Write-Host "[OK] Web Design OS stopped."
Write-Host ""
