@echo off
cd /d %~dp0
python -m PyInstaller --onefile --noconsole --name 会话管家 ^
  --icon "assets/icon_B_深色蓝.ico" ^
  --add-data "web;web" ^
  --add-data "assets/icon_B_深色蓝.ico;assets" ^
  app.py
echo 完成：dist\会话管家.exe
