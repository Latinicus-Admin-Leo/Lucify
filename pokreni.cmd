@echo off
rem  Lucify iz jedne mape, jednim dvoklikom.
rem
rem  Ovdje nema posla osim jednoga: pozvati PowerShell. Dvoklik na `.ps1` pao
rem  bi na pravilima izvodenja, a `.cmd` se otvara uvijek i svugdje. Sav pravi
rem  posao stoji u `scripts\pokreni.ps1`.
rem
rem    pokreni.cmd                 dohvati sto treba, slozi program, instaliraj
rem    pokreni.cmd --samo-gradi    stani nakon `izdanje\`, bez instaliranja
rem    pokreni.cmd --osvjezi       dohvati Node i yt-dlp iznova, pa i ako stoje

setlocal
set ZASTAVICE=

:citaj
if "%~1"=="" goto kreni
if /i "%~1"=="--samo-gradi" goto uzmi-samo-gradi
if /i "%~1"=="--osvjezi"    goto uzmi-osvjezi
rem  Nepoznata zastavica ne smije proci u tisini: zatipak u `--samo-gradi`
rem  inace znaci da se instalacija svejedno pokrene, a to je upravo ono sto
rem  je covjek htio izbjeci.
echo Ne znam za zastavicu "%~1".
echo Postoje samo --samo-gradi i --osvjezi.
pause
endlocal & exit /b 2

:uzmi-samo-gradi
set ZASTAVICE=%ZASTAVICE% -SamoGradi
shift
goto citaj

:uzmi-osvjezi
set ZASTAVICE=%ZASTAVICE% -Osvjezi
shift
goto citaj

:kreni
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\pokreni.ps1"%ZASTAVICE%
set IZLAZ=%ERRORLEVEL%

echo.
if not "%IZLAZ%"=="0" echo Nesto je poslo po zlu. Poruka je gore.
rem  Prozor ostaje otvoren: ovo se otvara dvoklikom, pa bi inace nestao
rem  zajedno sa svime sto je ispisao.
pause
endlocal & exit /b %IZLAZ%
