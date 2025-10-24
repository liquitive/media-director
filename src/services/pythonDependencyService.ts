/**
 * Python Dependency Service
 * Manages Python dependencies for native audio analysis (librosa, numpy, scipy, soundfile, numba)
 * 
 * - Prefers Python 3.8-3.13 (skips 3.14+ due to compatibility issues)
 * - Checks if all required libraries are installed before prompting
 * - Only prompts user if Python is missing or libraries are not installed
 * - Handles externally-managed Python environments (PEP 668)
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { spawn } from 'child_process';
import { logger } from '../utils/logger';

export class PythonDependencyService {
    private static instance: PythonDependencyService;
    private extensionPath: string;
    private isInstalled: boolean = false;
    private isChecking: boolean = false;
    private foundPythonPath: string | null = null;
    
    private constructor(extensionPath: string) {
        this.extensionPath = extensionPath;
    }
    
    /**
     * Get the found Python path (if any)
     */
    public getFoundPythonPath(): string | null {
        return this.foundPythonPath;
    }
    
    public static getInstance(extensionPath?: string): PythonDependencyService {
        if (!PythonDependencyService.instance) {
            if (!extensionPath) {
                throw new Error('Extension path required for first initialization');
            }
            PythonDependencyService.instance = new PythonDependencyService(extensionPath);
        }
        return PythonDependencyService.instance;
    }
    
    /**
     * Check if Python and all required audio libraries are available
     */
    public async checkDependencies(): Promise<boolean> {
        if (this.isChecking) {
            return this.isInstalled;
        }
        
        this.isChecking = true;
        
        try {
            const pythonPath = await this.getPythonPath();
            if (!pythonPath) {
                logger.warn('No compatible Python version found (requires 3.8-3.13)');
                this.isChecking = false;
                this.foundPythonPath = null;
                return false;
            }
            
            // Store the found Python path
            this.foundPythonPath = pythonPath;
            
            // Check all required libraries and their versions
            const checkScript = `
import sys
import json

required = {
    'librosa': '0.10.0',
    'numpy': '1.24.0',
    'scipy': '1.10.0',
    'soundfile': '0.12.0',
    'numba': '0.57.0'
}

results = {
    "success": True,
    "installed": {},
    "missing": [],
    "python_version": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
}

for package, min_version in required.items():
    try:
        module = __import__(package)
        version = getattr(module, '__version__', 'unknown')
        results["installed"][package] = version
    except ImportError:
        results["success"] = False
        results["missing"].append(package)

print(json.dumps(results))
`;
            
            const result = await this.runPythonScript(pythonPath, checkScript);
            const data = JSON.parse(result);
            
            this.isInstalled = data.success;
            
            if (this.isInstalled) {
                const packages = Object.entries(data.installed)
                    .map(([pkg, ver]) => `${pkg} ${ver}`)
                    .join(', ');
                logger.info(`✅ Python ${data.python_version} with audio libraries: ${packages}`);
            } else {
                logger.warn(`⚠️  Missing Python libraries: ${data.missing.join(', ')}`);
            }
            
            this.isChecking = false;
            return this.isInstalled;
            
        } catch (error) {
            logger.error('Failed to check Python dependencies:', error);
            this.isChecking = false;
            return false;
        }
    }
    
    /**
     * Install Python dependencies
     */
    public async installDependencies(showProgress: boolean = true): Promise<boolean> {
        try {
            const pythonPath = await this.getPythonPath();
            if (!pythonPath) {
                throw new Error('Python not found. Please install Python 3.8 or higher.');
            }
            
            const installScriptPath = path.join(this.extensionPath, 'python', 'install_dependencies.py');
            
            if (showProgress) {
                return await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: 'Installing Python audio analysis dependencies...',
                    cancellable: false
                }, async (progress) => {
                    progress.report({ message: 'Installing librosa and dependencies...' });
                    
                    try {
                        const result = await this.runPythonFile(pythonPath, installScriptPath);
                        
                        // Handle empty result
                        if (!result || result.trim() === '') {
                            throw new Error('Installation script produced no output. Check logs for details.');
                        }
                        
                        const data = JSON.parse(result);
                        
                        if (data.success) {
                            logger.info(`✅ ${data.message}`);
                            this.isInstalled = true;
                            vscode.window.showInformationMessage('✅ Python audio analysis dependencies installed successfully!');
                            return true;
                        } else {
                            throw new Error(data.error || 'Unknown installation error');
                        }
                    } catch (parseError: any) {
                        if (parseError.message.includes('JSON')) {
                            logger.error('Failed to parse installation result:', parseError);
                            throw new Error('Installation script failed to return valid status. Check logs for details.');
                        }
                        throw parseError;
                    }
                });
            } else {
                const result = await this.runPythonFile(pythonPath, installScriptPath);
                
                // Handle empty result
                if (!result || result.trim() === '') {
                    throw new Error('Installation script produced no output');
                }
                
                const data = JSON.parse(result);
                
                if (data.success) {
                    logger.info(`✅ ${data.message}`);
                    this.isInstalled = true;
                    return true;
                } else {
                    throw new Error(data.error || 'Unknown installation error');
                }
            }
            
        } catch (error: any) {
            const errorMsg = error.message || String(error);
            logger.error('Failed to install Python dependencies:', errorMsg);
            
            // Provide helpful error message based on the error type
            let userMessage = 'Failed to install Python dependencies';
            if (errorMsg.includes('pip is not available')) {
                userMessage = 'Python pip is not available. Please ensure pip is installed for your Python version.';
            } else if (errorMsg.includes('Permission denied')) {
                userMessage = 'Permission denied. Try running VS Code with appropriate permissions.';
            } else if (errorMsg.includes('No module named pip')) {
                userMessage = 'pip module not found. Please install pip for your Python version.';
            }
            
            vscode.window.showErrorMessage(
                `${userMessage}: ${errorMsg}`,
                'View Logs',
                'Try Again'
            ).then(action => {
                if (action === 'View Logs') {
                    logger.show();
                } else if (action === 'Try Again') {
                    this.installDependencies(showProgress);
                }
            });
            return false;
        }
    }
    
    /**
     * Prompt user to install dependencies only if needed
     */
    public async promptInstallIfNeeded(): Promise<boolean> {
        const isAvailable = await this.checkDependencies();
        
        if (isAvailable) {
            // Everything is already installed, no need to prompt
            return true;
        }
        
        // Check what's missing
        const pythonPath = await this.getPythonPath();
        if (!pythonPath) {
            const action = await vscode.window.showWarningMessage(
                'Python 3.8-3.13 not found. Audio analysis requires a compatible Python version.',
                'Learn More'
            );
            if (action === 'Learn More') {
                vscode.env.openExternal(vscode.Uri.parse('https://www.python.org/downloads/'));
            }
            return false;
        }
        
        // Python exists but libraries are missing
        const action = await vscode.window.showWarningMessage(
            '🎵 Python audio analysis libraries not found. Install now for enhanced beat detection?',
            'Install Now',
            'Skip'
        );
        
        if (action === 'Install Now') {
            return await this.installDependencies(true);
        }
        
        return false;
    }
    
    /**
     * Get Python executable path
     * Prefers stable Python 3.8-3.13 versions over newer experimental versions
     */
    private async getPythonPath(): Promise<string | null> {
        // Try specific stable Python versions first (3.8-3.13 are well-supported)
        const preferredVersions = [
            'python3.13',
            'python3.12', 
            'python3.11',
            'python3.10',
            'python3.9',
            'python3.8'
        ];
        
        // Check preferred versions first
        for (const cmd of preferredVersions) {
            try {
                const version = await this.runCommand(cmd, ['--version']);
                if (version.includes('Python 3')) {
                    logger.info(`Found Python: ${cmd} (${version.trim()})`);
                    return cmd;
                }
            } catch (error) {
                // Try next version
            }
        }
        
        // Fall back to generic python3/python commands, but filter out 3.14+
        const genericCommands = ['python3', 'python', 'py'];
        
        for (const cmd of genericCommands) {
            try {
                const version = await this.runCommand(cmd, ['--version']);
                if (version.includes('Python 3')) {
                    // Extract version number
                    const versionMatch = version.match(/Python 3\.(\d+)/);
                    if (versionMatch) {
                        const minorVersion = parseInt(versionMatch[1]);
                        // Skip Python 3.14+ (too new, likely unstable with pip/libraries)
                        if (minorVersion >= 14) {
                            logger.warn(`Skipping ${version.trim()} - too new, may have compatibility issues`);
                            continue;
                        }
                    }
                    
                    logger.info(`Found Python: ${cmd} (${version.trim()})`);
                    return cmd;
                }
            } catch (error) {
                // Try next command
            }
        }
        
        logger.error('No suitable Python version found. Please install Python 3.8-3.13.');
        return null;
    }
    
    /**
     * Run a Python script inline
     */
    private runPythonScript(pythonPath: string, script: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const proc = spawn(pythonPath, ['-c', script]);
            
            let stdout = '';
            let stderr = '';
            
            proc.stdout.on('data', (data) => {
                stdout += data.toString();
            });
            
            proc.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            
            proc.on('close', (code) => {
                if (code === 0) {
                    resolve(stdout.trim());
                } else {
                    reject(new Error(`Python script failed: ${stderr}`));
                }
            });
            
            proc.on('error', (error) => {
                reject(error);
            });
        });
    }
    
    /**
     * Run a Python file
     */
    private runPythonFile(pythonPath: string, filePath: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const proc = spawn(pythonPath, [filePath]);
            
            let stdout = '';
            let stderr = '';
            
            proc.stdout.on('data', (data) => {
                stdout += data.toString();
            });
            
            proc.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            
            proc.on('close', (code) => {
                if (code === 0) {
                    resolve(stdout.trim());
                } else {
                    reject(new Error(`Python installation failed: ${stderr}`));
                }
            });
            
            proc.on('error', (error) => {
                reject(error);
            });
        });
    }
    
    /**
     * Run a system command
     */
    private runCommand(command: string, args: string[]): Promise<string> {
        return new Promise((resolve, reject) => {
            const proc = spawn(command, args);
            
            let stdout = '';
            
            proc.stdout.on('data', (data) => {
                stdout += data.toString();
            });
            
            proc.on('close', (code) => {
                if (code === 0) {
                    resolve(stdout);
                } else {
                    reject(new Error(`Command failed with code ${code}`));
                }
            });
            
            proc.on('error', (error) => {
                reject(error);
            });
        });
    }
    
    /**
     * Check if dependencies are installed (cached)
     */
    public isLibrosaInstalled(): boolean {
        return this.isInstalled;
    }
}




