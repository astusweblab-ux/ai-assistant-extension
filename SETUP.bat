@echo off
echo.
echo ============================================
echo   AI Assistant Extension v2 - Setup
echo ============================================
echo.
echo This version uses built-in Gemini Nano.
echo No large downloads required!
echo.
echo Before loading the extension, make sure:
echo  1. Open chrome://flags
echo  2. Enable: #optimization-guide-on-device-model
echo  3. Enable: #prompt-api-for-gemini-nano-multimodal-input
echo  4. If your Chrome has old flag names, also enable: #prompt-api-for-gemini-nano
echo  5. Restart Chrome
echo.
echo Then load the extension:
echo  1. Open chrome://extensions/
echo  2. Enable Developer mode
echo  3. Click Load unpacked
echo  4. Select: %~dp0
echo.
pause
