# Local Docker Troubleshooting

## Port Conflicts
Use Get-NetTCPConnection -LocalPort 5432 and Stop-Process -Id <PID> -Force
