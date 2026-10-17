@echo off
cd /d "%~dp0"
echo VoiceScope demarre sur http://localhost:8000  (Ctrl+C pour arreter)
start "" cmd /c "timeout /t 5 >nul & start http://localhost:8000"
python -m uvicorn server:app --port 8000
pause
