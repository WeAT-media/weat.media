# Резервная копия PDS: согласованные снимки SQLite + restic в S3 своего контура
FROM alpine:3.21
RUN apk add --no-cache sqlite restic bash coreutils findutils
COPY pds-backup.sh /usr/local/bin/pds-backup
RUN chmod +x /usr/local/bin/pds-backup
ENTRYPOINT ["pds-backup"]
CMD ["loop"]
