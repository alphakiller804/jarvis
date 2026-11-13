@echo off
title JARVIS Windows Local Agent
color 0b
echo ===================================================
echo     STARTING JARVIS WINDOWS LOCAL AGENT (v2.0)
echo ===================================================
echo Checking Python environment...
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python is not installed or not in PATH.
    echo Please install Python 3.10+ and add it to PATH.
    pause
    exit /b 1
)

echo Starting Local Agent on port 3001...
python jarvis_engine\server.py
pause

