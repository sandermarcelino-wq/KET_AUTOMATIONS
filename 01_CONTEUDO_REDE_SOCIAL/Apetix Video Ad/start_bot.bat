@echo off
:: KET Admin Bot — inicia em segundo plano (sem janela de console)
:: Log em: Apetix Video Ad\bot.log

set SCRIPT_DIR=%~dp0

:: Verifica se já está rodando
tasklist /FI "IMAGENAME eq pythonw.exe" /FI "WINDOWTITLE eq KETAdminBot" 2>NUL | find /I "pythonw.exe" >NUL
if %ERRORLEVEL% == 0 (
    echo Bot ja esta rodando. Verifique bot.log.
    pause
    exit /B
)

echo Iniciando KET Admin Bot em segundo plano...
start "KETAdminBot" /B pythonw "%SCRIPT_DIR%admin_interface.py"

timeout /T 2 /NOBREAK >NUL
echo Bot iniciado. Log em: %SCRIPT_DIR%bot.log
echo Para parar: feche o processo pythonw.exe no Gerenciador de Tarefas.
pause
