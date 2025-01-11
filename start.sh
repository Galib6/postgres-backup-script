#!/bin/bash
# Start the web server in the background
node /app/web/server.js &

# Start the backup script
/backup.sh