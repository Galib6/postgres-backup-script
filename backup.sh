#!/bin/bash
set -eo pipefail

# Configuration
BACKUP_DIR="/backups"
LOG_FILE="/var/log/backup.log"
LOCK_FILE="/tmp/backup.lock"
MIN_SPACE_MB=5120

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

check_space() {
    local available_space=$(df -BM "$BACKUP_DIR" | awk 'NR==2 {print $4}' | tr -d 'M')
    if [ "$available_space" -lt "$MIN_SPACE_MB" ]; then
        log "ERROR: Insufficient space (${available_space}MB available, ${MIN_SPACE_MB}MB required)"
        return 1
    fi
}

cleanup_old() {
    log "Cleaning up old backups and log files"

    # Remove daily backups older than 7 days
    find "$BACKUP_DIR" -type f -name "pg_backup_*.dump" -mtime +"$CLEANUP_INTERVAL_DAYS" ! -name "*_week_*.dump" -print -delete | tee -a "$LOG_FILE"

    # Keep weekly backups for up to 30 days, then delete older ones
    find "$BACKUP_DIR" -type f -name "*_week_*.dump" -mtime +30 -print -delete | tee -a "$LOG_FILE"

    # Trim large log files (larger than 100MB)
    find /var/log/ -type f -size +104857600c -exec rm -f {} \; | tee -a "$LOG_FILE"
}


create_backup() {
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local day_of_week=$(date +%u)  # Day of the week (1=Monday, ..., 7=Sunday)
    local suffix=""
    
    if [ "$day_of_week" -eq 7 ]; then
        suffix="_week_$(date +%U)"  # Weekly backup, append week number
    fi

    local backup_file="${BACKUP_DIR}/pg_backup_${timestamp}${suffix}.dump"
    local temp_file="${backup_file}.tmp"

    log "Starting backup: ${backup_file}"
    
    if ! pg_isready -h "$POSTGRES_HOST" -U "$POSTGRES_USER"; then
        log "ERROR: Database is not accessible"
        return 1
    fi

    if PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
        -h "$POSTGRES_HOST" \
        -U "$POSTGRES_USER" \
        -d "$POSTGRES_DB" \
        -Fc \
        -Z 9 \
        -v \
        -f "$temp_file"; then
        mv "$temp_file" "$backup_file"
        log "Backup completed successfully: ${backup_file}"
    else
        rm -f "$temp_file"
        log "ERROR: Backup failed"
        return 1
    fi
}


backup_with_lock() {
    if [ -d "$LOCK_FILE" ]; then
        log "Another backup process is running. Removing stale lock file if process is dead."
        # Check if the process holding the lock is alive
        if ! fuser "$LOCK_FILE" >/dev/null 2>&1; then
            rm -rf "$LOCK_FILE"
            log "Removed stale lock file."
        else
            return 1
        fi
    fi

    if ! mkdir "$LOCK_FILE" 2>/dev/null; then
        log "Another backup process is running"
        return 1
    fi

    trap 'rm -rf "$LOCK_FILE"' EXIT

    check_space || return 1
    create_backup || return 1
    cleanup_old
}


# Main loop
while true; do
    backup_with_lock || log "Backup attempt failed, will retry next "$BACKUP_WILL_AFTER_SECONDS" seconds"
    sleep "$BACKUP_WILL_AFTER_SECONDS"
done