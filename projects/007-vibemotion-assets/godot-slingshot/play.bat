@echo off
rem Double-click to play Slingshot Demo directly (skips editor)
rem Project dir is resolved via %%~dp0 to avoid encoding issues.
start "" godot --path "%~dp0." res://main.tscn
