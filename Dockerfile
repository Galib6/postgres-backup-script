FROM postgres:17-alpine

# Install necessary tools
RUN apk add --no-cache bash tzdata postgresql17-client dos2unix nodejs npm

# Set up directories
RUN mkdir -p /backups /var/log /app/web/public

# Copy web interface files
COPY web/public/index.html /app/web/public/
COPY web/server.js /app/web/

# Install Node.js dependencies
WORKDIR /app/web
RUN npm init -y && \
    npm install express

# Copy and set up the backup script
COPY backup.sh /backup.sh
COPY start.sh /start.sh

# Set proper permissions and format
RUN dos2unix /backup.sh /start.sh && \
    chmod +x /backup.sh /start.sh && \
    chown -R postgres:postgres /backups /var/log /app

USER postgres
VOLUME ["/backups", "/var/log"]

# Expose web interface port
EXPOSE 3000

# Change the entrypoint to use the start script
ENTRYPOINT ["/bin/bash", "/start.sh"]