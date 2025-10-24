/**
 * File Management Utilities
 * Handles copying source files, saving transcriptions, and managing script JSON files
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export class FileManager {
    /**
     * Copy original file to source directory
     */
    static copySourceFile(sourcePath: string, storyDir: string, originalFilename: string): string {
        try {
            const sourceDir = path.join(storyDir, 'source');
            const fileName = path.basename(originalFilename);
            const destPath = path.join(sourceDir, `original${path.extname(fileName)}`);
            
            // Ensure source directory exists
            if (!fs.existsSync(sourceDir)) {
                fs.mkdirSync(sourceDir, { recursive: true });
            }
            
            // Copy file
            fs.copyFileSync(sourcePath, destPath);
            return destPath;
        } catch (error) {
            console.error('Error copying source file:', error);
            throw error;
        }
    }


    /**
     * Read script JSON from filesystem
     * @deprecated script.json is no longer used; individual segment files are the source of truth
     */
    static readScriptJSON(scriptPath: string): any {
        console.warn('readScriptJSON is deprecated - use individual segment files instead');
        try {
            if (!fs.existsSync(scriptPath)) {
                return null;
            }
            
            const content = fs.readFileSync(scriptPath, 'utf8');
            return JSON.parse(content);
        } catch (error) {
            console.error('Error reading script JSON:', error);
            return null;
        }
    }

    /**
     * Write script JSON to filesystem
     * @deprecated script.json is no longer used; use storyService.saveSegment() for real-time persistence
     */
    static writeScriptJSON(scriptData: any, scriptPath: string): void {
        console.warn('writeScriptJSON is deprecated - use storyService.saveSegment() instead');
        try {
            // Ensure directory exists
            const dir = path.dirname(scriptPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            
            fs.writeFileSync(scriptPath, JSON.stringify(scriptData, null, 2), 'utf8');
        } catch (error) {
            console.error('Error writing script JSON:', error);
            throw error;
        }
    }

    /**
     * Create versioned script backup
     * @deprecated script.json is no longer used; individual segment files are auto-persisted
     */
    static createScriptBackup(scriptPath: string): string {
        console.warn('createScriptBackup is deprecated - segments are auto-persisted to individual files');
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupPath = scriptPath.replace('script.json', `script-v${timestamp}.json`);
            
            if (fs.existsSync(scriptPath)) {
                fs.copyFileSync(scriptPath, backupPath);
            }
            
            return backupPath;
        } catch (error) {
            console.error('Error creating script backup:', error);
            throw error;
        }
    }

    /**
     * Get all script versions
     * @deprecated script.json is no longer used; individual segment files are versioned through git
     */
    static getScriptVersions(scriptsDir: string): string[] {
        console.warn('getScriptVersions is deprecated - use version control for segment files');
        try {
            if (!fs.existsSync(scriptsDir)) {
                return [];
            }
            
            const files = fs.readdirSync(scriptsDir);
            return files
                .filter(file => file.startsWith('script-v') && file.endsWith('.json'))
                .sort()
                .reverse(); // Most recent first
        } catch (error) {
            console.error('Error getting script versions:', error);
            return [];
        }
    }
}









