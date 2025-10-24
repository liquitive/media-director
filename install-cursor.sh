#!/bin/bash

# Installation script for Sora Director extension in Cursor
EXT_DIR="$HOME/.cursor/extensions/sora-director.sora-director-0.1.0"
VSIX_FILE="/Users/vdarevsk/Work/sora/sora-director-vscode/sora-director-0.1.0.vsix"

echo "🗑️  Removing old extension..."
rm -rf "$EXT_DIR"

echo "📦 Extracting VSIX..."
mkdir -p "$EXT_DIR"
cd "$EXT_DIR"
unzip -q "$VSIX_FILE"

echo "📁 Moving files to correct location..."
if [ -d "extension" ]; then
    cp -r extension/* .
    rm -rf extension
fi

# Verify installation
if [ -f "package.json" ] && [ -f "out/extension.js" ]; then
    echo "✅ Extension installed successfully!"
    echo ""
    echo "📋 Installed files:"
    ls -1 | head -10
else
    echo "❌ Installation failed - missing required files"
    exit 1
fi




