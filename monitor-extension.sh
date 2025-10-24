#!/bin/bash

echo "🔍 Monitoring Sora Director Extension Activity..."
echo "================================================"

# Check if extension is installed
echo "📦 Extension Status:"
code --list-extensions | grep sora-director

echo ""
echo "📊 VS Code Process Info:"
ps aux | grep -i "code" | grep -v grep | head -3

echo ""
echo "📁 Extension Files:"
ls -la ~/.vscode/extensions/sora-director.sora-director-*/ 2>/dev/null || echo "Extension not found in expected location"

echo ""
echo "🔧 To see real-time logs:"
echo "1. Open VS Code"
echo "2. Press Cmd+Shift+P (Mac) or Ctrl+Shift+P (Windows/Linux)"
echo "3. Type: 'Developer: Toggle Developer Tools'"
echo "4. Go to Console tab"
echo "5. Look for 'Sora Director' messages"

echo ""
echo "📋 To see extension output:"
echo "1. In VS Code: View → Output"
echo "2. Select 'Sora Director' from dropdown"
echo "3. Watch for log messages"

echo ""
echo "🎬 Extension should show:"
echo "- 'Sora Video Director is ready!' message"
echo "- Sora Director icon in left sidebar"
echo "- '+' button in Sora Director panel"









