#!/bin/bash
# Docker Update Script for CLIProxyAPI

set -e

REPO="router-for-me/CLIProxyAPIPlus"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}=== CLIProxyAPI Docker Update Script ===${NC}\n"

# Get latest version
echo -e "${YELLOW}Checking for latest version...${NC}"
LATEST_VERSION=$(curl -s "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')

if [ -z "$LATEST_VERSION" ]; then
    echo -e "${RED}✗ Failed to get latest version${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Latest version: ${LATEST_VERSION}${NC}"

# Update Dockerfile
echo -e "\n${YELLOW}Updating Dockerfile...${NC}"
VERSION_NO_V=${LATEST_VERSION#v}
sed -i "s|download/v[0-9.]*-[0-9]*/CLIProxyAPIPlus_[0-9.]*-[0-9]*_linux|download/${LATEST_VERSION}/CLIProxyAPIPlus_${VERSION_NO_V}_linux|g" "$SCRIPT_DIR/Dockerfile"
echo -e "${GREEN}✓ Dockerfile updated${NC}"

# Rebuild image
echo -e "\n${YELLOW}Rebuilding Docker image...${NC}"
cd "$SCRIPT_DIR"
docker-compose build --no-cache

if [ $? -ne 0 ]; then
    echo -e "${RED}✗ Build failed${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Build complete${NC}"

# Restart containers
echo -e "\n${YELLOW}Restarting containers...${NC}"
docker-compose down
docker-compose up -d

if [ $? -ne 0 ]; then
    echo -e "${RED}✗ Failed to start containers${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Containers restarted${NC}"

# Wait and check
sleep 5
echo -e "\n${CYAN}=== Container Status ===${NC}"
docker-compose ps

echo -e "\n${GREEN}✓ Update completed to ${LATEST_VERSION}${NC}"
echo -e "${CYAN}WebUI: http://localhost:8317/management.html${NC}"
echo -e "${YELLOW}Check logs: docker-compose logs -f${NC}"
