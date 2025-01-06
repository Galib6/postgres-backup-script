FROM postgres:17-alpine

# Install necessary tools
RUN apk add --no-cache bash tzdata postgresql17-client

# Set up directories and permissions
RUN mkdir -p /backups /var/log && \
    chown postgres:postgres /backups /var/log


RUN apk add --no-cache bash tzdata
RUN mkdir -p /backups /var/log

COPY backup.sh /backup.sh
RUN chmod +x /backup.sh && \
    chown postgres:postgres /backup.sh && \
    chown postgres:postgres /backups /var/log

USER postgres
VOLUME ["/backups", "/var/log"]
CMD ["/backup.sh"]