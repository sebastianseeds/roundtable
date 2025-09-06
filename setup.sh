#!/bin/bash

echo "========================================="
echo "Round Table D&D Platform Setup"
echo "========================================="

OS_TYPE="$(uname -s)"
NODE_MIN_VERSION="14.0.0"
NPM_MIN_VERSION="6.0.0"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

check_command() {
    if ! command -v $1 &> /dev/null; then
        return 1
    fi
    return 0
}

version_compare() {
    if [[ $1 == $2 ]]; then
        return 0
    fi
    local IFS=.
    local i ver1=($1) ver2=($2)
    for ((i=${#ver1[@]}; i<${#ver2[@]}; i++)); do
        ver1[i]=0
    done
    for ((i=0; i<${#ver1[@]}; i++)); do
        if [[ -z ${ver2[i]} ]]; then
            ver2[i]=0
        fi
        if ((10#${ver1[i]} > 10#${ver2[i]})); then
            return 1
        fi
        if ((10#${ver1[i]} < 10#${ver2[i]})); then
            return 2
        fi
    done
    return 0
}

echo -e "${YELLOW}Checking system requirements...${NC}"

if ! check_command node; then
    echo -e "${RED}Error: Node.js is not installed${NC}"
    echo "Please install Node.js from https://nodejs.org/"
    
    if [[ "$OS_TYPE" == "Darwin" ]]; then
        echo "On macOS, you can use Homebrew: brew install node"
    elif [[ "$OS_TYPE" == "Linux" ]]; then
        echo "On Linux, you can use: sudo apt-get install nodejs npm"
    fi
    exit 1
else
    NODE_VERSION=$(node -v | cut -d 'v' -f 2)
    version_compare $NODE_VERSION $NODE_MIN_VERSION
    if [[ $? -eq 2 ]]; then
        echo -e "${RED}Error: Node.js version $NODE_VERSION is too old${NC}"
        echo "Minimum required version: $NODE_MIN_VERSION"
        echo "Please update Node.js from https://nodejs.org/"
        exit 1
    fi
    echo -e "${GREEN}✓ Node.js $NODE_VERSION found${NC}"
fi

if ! check_command npm; then
    echo -e "${RED}Error: npm is not installed${NC}"
    echo "npm should come with Node.js. Please reinstall Node.js from https://nodejs.org/"
    exit 1
else
    NPM_VERSION=$(npm -v)
    version_compare $NPM_VERSION $NPM_MIN_VERSION
    if [[ $? -eq 2 ]]; then
        echo -e "${RED}Error: npm version $NPM_VERSION is too old${NC}"
        echo "Minimum required version: $NPM_MIN_VERSION"
        echo "Please update npm: npm install -g npm@latest"
        exit 1
    fi
    echo -e "${GREEN}✓ npm $NPM_VERSION found${NC}"
fi

echo -e "\n${YELLOW}Installing dependencies...${NC}"
npm install

if [ $? -ne 0 ]; then
    echo -e "${RED}Error: Failed to install dependencies${NC}"
    echo "Please check the error messages above and try again"
    exit 1
fi

if [ ! -f .env ] && [ -f .env.example ]; then
    echo -e "\n${YELLOW}Creating .env file from .env.example...${NC}"
    cp .env.example .env
    echo -e "${GREEN}✓ .env file created${NC}"
    echo -e "${YELLOW}Please edit .env to configure your settings${NC}"
fi

echo -e "\n${GREEN}=========================================${NC}"
echo -e "${GREEN}Setup completed successfully!${NC}"
echo -e "${GREEN}=========================================${NC}"
echo ""
echo "To start the server:"
echo "  npm start        - Run in production mode"
echo "  npm run dev      - Run in development mode (with auto-reload)"
echo ""
echo "Then open your browser to:"
echo "  http://localhost:3000"
echo ""
echo "Multiple users can join the same room by entering the same Room ID"
echo ""

if [[ "$OS_TYPE" == "Darwin" ]]; then
    echo "On macOS, you may need to allow incoming connections in System Preferences > Security & Privacy > Firewall"
elif [[ "$OS_TYPE" == "Linux" ]]; then
    echo "On Linux, ensure port 3000 is open in your firewall:"
    echo "  sudo ufw allow 3000/tcp"
fi