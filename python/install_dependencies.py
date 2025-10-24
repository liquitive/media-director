#!/usr/bin/env python3
"""
Install Python dependencies for Sora Director VS Code Extension
"""

import subprocess
import sys
import json
import os

def install_dependencies():
    """Install required Python packages"""
    requirements = [
        'librosa>=0.10.0',
        'numpy>=1.24.0',
        'scipy>=1.10.0',
        'soundfile>=0.12.0',
        'numba>=0.57.0'
    ]
    
    try:
        # Check if pip is available
        pip_check = subprocess.run(
            [sys.executable, '-m', 'pip', '--version'],
            capture_output=True,
            text=True
        )
        
        if pip_check.returncode != 0:
            raise Exception(f"pip is not available for Python {sys.version}. Please install pip first.")
        
        print(f"Using pip: {pip_check.stdout.strip()}", file=sys.stderr)
        
        # Upgrade pip first (capture errors)
        print("Upgrading pip...", file=sys.stderr)
        pip_upgrade = subprocess.run(
            [sys.executable, '-m', 'pip', 'install', '--upgrade', 'pip'],
            capture_output=True,
            text=True
        )
        
        if pip_upgrade.returncode != 0:
            print(f"Warning: pip upgrade failed: {pip_upgrade.stderr}", file=sys.stderr)
        
        # Install each requirement with better error handling
        for requirement in requirements:
            print(f"Installing {requirement}...", file=sys.stderr)
            
            # Try with --user flag first (safest)
            result = subprocess.run(
                [sys.executable, '-m', 'pip', 'install', requirement, '--user'],
                capture_output=True,
                text=True
            )
            
            if result.returncode != 0:
                # Try without --user flag
                print(f"Retrying {requirement} without --user flag...", file=sys.stderr)
                result = subprocess.run(
                    [sys.executable, '-m', 'pip', 'install', requirement],
                    capture_output=True,
                    text=True
                )
                
                if result.returncode != 0:
                    # If externally-managed-environment error, try with --break-system-packages
                    if 'externally-managed-environment' in result.stderr:
                        print(f"Using --break-system-packages for {requirement}...", file=sys.stderr)
                        result = subprocess.run(
                            [sys.executable, '-m', 'pip', 'install', requirement, '--break-system-packages'],
                            capture_output=True,
                            text=True
                        )
                        
                        if result.returncode != 0:
                            raise Exception(f"Failed to install {requirement}: {result.stderr}")
                    else:
                        raise Exception(f"Failed to install {requirement}: {result.stderr}")
            
            print(f"✅ {requirement} installed", file=sys.stderr)
        
        # Verify librosa installation
        import librosa
        print(json.dumps({
            "success": True,
            "message": f"Successfully installed all dependencies. librosa version: {librosa.__version__}"
        }))
        
    except ImportError as e:
        error_msg = f"Installation completed but failed to import librosa: {str(e)}"
        print(json.dumps({
            "success": False,
            "error": error_msg
        }))
        sys.exit(1)
        
    except subprocess.CalledProcessError as e:
        error_msg = f"Subprocess error: {e.stderr if hasattr(e, 'stderr') else str(e)}"
        print(json.dumps({
            "success": False,
            "error": error_msg
        }))
        sys.exit(1)
        
    except Exception as e:
        error_msg = f"{type(e).__name__}: {str(e)}"
        print(json.dumps({
            "success": False,
            "error": error_msg
        }))
        sys.exit(1)

if __name__ == '__main__':
    install_dependencies()




