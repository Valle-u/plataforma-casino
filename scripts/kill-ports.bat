@echo off
echo ========================================
echo   Liberando puertos 3000 y 3001...
echo ========================================
echo.

for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000') do (
    echo Matando proceso en puerto 3000 - PID: %%a
    taskkill /PID %%a /F
)

for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3001') do (
    echo Matando proceso en puerto 3001 - PID: %%a
    taskkill /PID %%a /F
)

echo.
echo ========================================
echo   Puertos liberados
echo ========================================
pause
