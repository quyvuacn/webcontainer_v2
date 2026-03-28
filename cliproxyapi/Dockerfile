# Build stage - download and extract binary
FROM alpine:3.19 AS downloader

RUN apk add --no-cache curl tar ca-certificates

WORKDIR /tmp
RUN curl -L -o CLIProxyAPIPlus.tar.gz \
    https://github.com/router-for-me/CLIProxyAPIPlus/releases/download/v6.8.9-0/CLIProxyAPIPlus_6.8.9-0_linux_amd64.tar.gz && \
    tar -xzf CLIProxyAPIPlus.tar.gz && \
    find . -type f -executable -name "*proxy*" -exec mv {} /tmp/cli-proxy-api \; && \
    chmod +x /tmp/cli-proxy-api

# Final stage - scratch for minimal size
FROM scratch

WORKDIR /app

# Copy ca-certificates for HTTPS
COPY --from=downloader /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/

# Copy binary from build stage
COPY --from=downloader /tmp/cli-proxy-api /app/cli-proxy-api

# Copy config files
COPY config.yaml /app/config.yaml

# Expose port
EXPOSE 8317

# Run service as non-root user (default in distroless:nonroot)
CMD ["/app/cli-proxy-api"]
