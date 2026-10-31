@echo off
rem Stops the CareChain chain (8546), backend (4001) and UI (5180). Leaves other projects alone.
powershell -NoProfile -Command "foreach ($p in 8546,4001,5180) { Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue; Write-Host ('stopped port ' + $p) } }"
