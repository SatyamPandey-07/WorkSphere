# WSL2 Development Guide

## 1. Node Version Management
Use nvm to manage Node.js inside WSL2 Ubuntu.

## 2. Docker Desktop
Enable WSL2 backend integration in Docker Desktop settings.

## 3. File Performance
Use native Linux home (~/work) instead of /mnt/c/ for faster I/O.

## 4. Git Line Endings
Run git config --global core.autocrlf input to manage CRLF vs LF.

## 5. VS Code
Install the Remote-WSL extension and run code . from your WSL terminal.