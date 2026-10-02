@echo off
echo Installing dependencies (if any)...
call npm install
cd client
call npm install
cd ..
cd server
call npm install
cd ..

echo Starting development servers...
start "Travel Planner Servers" cmd /c "npm run dev"

echo Waiting for servers to start...
timeout /t 5 /nobreak >nul

echo Opening application in browser...
start http://localhost:5173
