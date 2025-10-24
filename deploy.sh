#!/bin/bash

# Sora Director Extension Deployment Script
# Uninstalls, packages, installs, and reloads the extension

set -e  # Exit on any error

EXTENSION_ID="sora-director"
EXTENSION_FILE="sora-director-0.1.0.vsix"
CURSOR_BIN="/Applications/Cursor.app/Contents/Resources/app/bin/cursor"

echo "🗑️  Uninstalling existing extension..."
$CURSOR_BIN --uninstall-extension $EXTENSION_ID 2>/dev/null || echo "   No existing extension found"

echo "📦 Packaging extension..."
npm run compile
vsce package --out $EXTENSION_FILE

echo "📥 Installing extension..."
$CURSOR_BIN --install-extension $EXTENSION_FILE --force

echo "🔄 Reloading Cursor window..."
osascript <<EOF
tell application "Cursor"
    activate
end tell

delay 0.5

tell application "System Events"
    keystroke "p" using {command down, shift down}
end tell

delay 0.3

tell application "System Events"
    keystroke "Reload Window"
end tell

delay 0.3

tell application "System Events"
    key code 36
end tell
EOF

echo "✅ Deployment complete!"

































