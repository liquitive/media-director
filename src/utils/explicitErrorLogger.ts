/**
 * Explicit Error Logger - Comprehensive error logging for VS Code
 * Handles generation errors, validation issues, and system diagnostics
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from './logger';

export interface GenerationError {
  id: string;
  timestamp: string;
  storyId: string;
  segmentId?: string;
  errorType: 'generation_failure' | 'validation_error' | 'asset_missing' | 'context_error' | 'api_error' | 'diagnostic';
  severity: 'critical' | 'warning' | 'info';
  message: string;
  context: Record<string, any>;
  stackTrace?: string;
  recoveryAction?: string;
}

export class ExplicitErrorLogger {
  private errors: GenerationError[] = [];
  private outputChannel: vscode.OutputChannel;
  private workspaceRoot: string;
  
  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    // Route all logs to the single shared channel used by the extension UI
    this.outputChannel = logger.getOutputChannel();
  }
  
  /**
   * Log an error with full context
   */
  logError(error: Omit<GenerationError, 'id' | 'timestamp'>): void {
    const fullError: GenerationError = {
      ...error,
      id: `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString()
    };
    
    this.errors.push(fullError);
    this.logToOutputChannel(fullError);
    this.logToFile(fullError);
  }
  
  /**
   * Log informational message
   */
  logInfo(storyId: string, message: string): void {
    this.logError({
      storyId,
      errorType: 'diagnostic',
      severity: 'info',
      message,
      context: {}
    });
  }
  
  /**
   * Log warning message
   */
  logWarning(storyId: string, message: string, context?: Record<string, any>): void {
    this.logError({
      storyId,
      errorType: 'generation_failure',
      severity: 'warning',
      message,
      context: context || {}
    });
  }
  
  /**
   * Log critical error
   */
  logCritical(storyId: string, message: string, context?: Record<string, any>): void {
    this.logError({
      storyId,
      errorType: 'generation_failure',
      severity: 'critical',
      message,
      context: context || {}
    });
  }
  
  /**
   * Log API error
   */
  logApiError(storyId: string, message: string, context?: Record<string, any>): void {
    this.logError({
      storyId,
      errorType: 'api_error',
      severity: 'critical',
      message,
      context: context || {}
    });
  }
  
  /**
   * Log validation error
   */
  logValidationError(storyId: string, segmentId: string, message: string, context?: Record<string, any>): void {
    this.logError({
      storyId,
      segmentId,
      errorType: 'validation_error',
      severity: 'warning',
      message,
      context: context || {}
    });
  }
  
  /**
   * Log asset-related error
   */
  logAssetError(storyId: string, message: string, context?: Record<string, any>): void {
    this.logError({
      storyId,
      errorType: 'asset_missing',
      severity: 'warning',
      message,
      context: context || {}
    });
  }
  
  /**
   * Log context building error
   */
  logContextError(storyId: string, message: string, context?: Record<string, any>): void {
    this.logError({
      storyId,
      errorType: 'context_error',
      severity: 'critical',
      message,
      context: context || {}
    });
  }
  
  /**
   * Log to VS Code output channel
   */
  private logToOutputChannel(error: GenerationError): void {
    const severityIcon = {
      'critical': '🚨',
      'warning': '⚠️',
      'info': 'ℹ️'
    }[error.severity];
    
    this.outputChannel.appendLine(`${severityIcon} [${error.severity.toUpperCase()}] ${error.message}`);
    this.outputChannel.appendLine(`Story: ${error.storyId}${error.segmentId ? ` | Segment: ${error.segmentId}` : ''}`);
    this.outputChannel.appendLine(`Type: ${error.errorType} | Time: ${error.timestamp}`);
    
    if (Object.keys(error.context).length > 0) {
      this.outputChannel.appendLine(`Context: ${JSON.stringify(error.context, null, 2)}`);
    }
    
    if (error.stackTrace) {
      this.outputChannel.appendLine(`Stack: ${error.stackTrace}`);
    }
    
    if (error.recoveryAction) {
      this.outputChannel.appendLine(`Recovery: ${error.recoveryAction}`);
    }
    
    this.outputChannel.appendLine('---');
    
    // Show output channel for critical errors
    if (error.severity === 'critical') {
      this.outputChannel.show();
    }
  }
  
  /**
   * Log to file system
   */
  private logToFile(error: GenerationError): void {
    try {
      const logDir = path.join(this.workspaceRoot, 'sora-output', 'logs');
      
      // Ensure log directory exists
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      
      const logFile = path.join(logDir, `generation_${error.storyId}.log`);
      const logEntry = `${error.timestamp} [${error.severity}] ${error.message}\n`;
      
      fs.appendFileSync(logFile, logEntry);
    } catch (fileError) {
      // Don't throw - logging failure shouldn't break the application
      console.error('Failed to write to log file:', fileError);
    }
  }
  
  /**
   * Export errors for a specific story
   */
  exportErrors(storyId: string): string {
    const errors = this.errors.filter(e => e.storyId === storyId);
    return JSON.stringify(errors, null, 2);
  }
  
  /**
   * Get error statistics
   */
  getErrorStatistics(storyId?: string): {
    total: number;
    bySeverity: Record<string, number>;
    byType: Record<string, number>;
  } {
    const filteredErrors = storyId 
      ? this.errors.filter(e => e.storyId === storyId)
      : this.errors;
    
    const bySeverity: Record<string, number> = {};
    const byType: Record<string, number> = {};
    
    for (const error of filteredErrors) {
      bySeverity[error.severity] = (bySeverity[error.severity] || 0) + 1;
      byType[error.errorType] = (byType[error.errorType] || 0) + 1;
    }
    
    return {
      total: filteredErrors.length,
      bySeverity,
      byType
    };
  }
  
  /**
   * Clear errors for a story
   */
  clearErrors(storyId: string): void {
    this.errors = this.errors.filter(e => e.storyId !== storyId);
  }
  
  /**
   * Get recent errors
   */
  getRecentErrors(count: number = 10): GenerationError[] {
    return this.errors
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, count);
  }
  
  /**
   * Show output channel
   */
  showOutputChannel(): void {
    this.outputChannel.show();
  }
  
  /**
   * Clear all errors
   */
  clearAllErrors(): void {
    this.errors = [];
  }
}













