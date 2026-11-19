@echo off
cd /d "D:\Antigravity_Projects\DarkChess"
start "" "http://localhost:8765"
python -m http.server 8765
