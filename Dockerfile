FROM postgres:17-alpine

# Install necessary tools
RUN apk add --no-cache bash tzdata postgresql17-client dos2unix

# Set up directories
RUN mkdir -p /backups /var/log

# Copy and set up the backup script - with proper formatting
COPY backup.sh /backup.sh
RUN dos2unix /backup.sh && \
    chmod +x /backup.sh && \
    chown postgres:postgres /backup.sh && \
    chown -R postgres:postgres /backups /var/log

USER postgres
VOLUME ["/backups", "/var/log"]

# Change the entrypoint to explicitly use bash
ENTRYPOINT ["/bin/bash", "/backup.sh"]