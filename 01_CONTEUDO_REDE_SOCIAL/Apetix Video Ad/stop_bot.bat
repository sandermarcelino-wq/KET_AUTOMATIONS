@echo off
:: KET Admin Bot — para o processo em segundo plano

taskkill /FI "WINDOWTITLE eq KETAdminBot" /F >NUL 2>&1
if %ERRORLEVEL% == 0 (
    echo Bot encerrado com sucesso.
) else (
    echo Bot nao encontrado ou ja estava parado.
)
pause
