@echo off
setlocal
cd /d "%~dp0"

rem Harmonia - start the site without Node or npm.
rem
rem The app is already built (dist\index.html + dist\assets). All this does is
rem put the corpus where the built page expects it and serve the folder over
rem http, because the browser will not fetch data from a file:// page.

if not exist "public\data\index.json" (
  echo.
  echo   Cannot find public\data\index.json
  echo.
  echo   Unzip harmonia-data-pieces.zip and both harmonia-data-engraved zips
  echo   into this folder first, then run this again.
  echo.
  pause
  exit /b 1
)

if not exist "dist\index.html" (
  echo.
  echo   Cannot find dist\index.html - unzip harmonia-site.zip into this folder.
  echo.
  pause
  exit /b 1
)

rem /D copies only what is newer than the copy already there, so this is slow
rem once and instant afterwards. Without it a rebuilt index.json sat in
rem public\data and never reached the page being served.
echo   Checking the corpus in dist\data, one moment...
xcopy /E /I /Q /Y /D "public\data" "dist\data" >nul

set "PY="
where python >nul 2>&1
if not errorlevel 1 set "PY=python"
if not defined PY (
  where py >nul 2>&1
  if not errorlevel 1 set "PY=py"
)
if not defined PY (
  echo.
  echo   No Python found on PATH. Any static file server will do instead:
  echo   serve the dist folder and open the address it prints.
  echo.
  pause
  exit /b 1
)

start "" http://localhost:8000
cd dist

rem ..\serve.py rather than -m http.server: the built-in server sends no
rem Cache-Control, so a browser is free to decide for itself how long index.html
rem stays fresh -- and a stale index.html goes on naming the previous build's
rem JavaScript, which is still in dist\assets and still loads. The page then
rem shows an old build out of files that are every one of them correct.
if exist "..\serve.py" (
  %PY% ..\serve.py 8000
) else (
  echo.
  echo   serve.py is missing - falling back. If the page looks out of date,
  echo   reload with Ctrl+F5.
  echo.
  %PY% -m http.server 8000
)
