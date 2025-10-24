/**
 * Logger Utility
 * Manages output channel logging
 */

import * as vscode from 'vscode';

class Logger {
    private static instance: Logger;
    private outputChannel: vscode.OutputChannel;
    private storyService: any; // Will be set from extension.ts

    constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Sora Video Director');
    }

    static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    /**
     * Set story service for resolving story IDs to names
     */
    setStoryService(storyService: any): void {
        this.storyService = storyService;
    }

    getOutputChannel(): vscode.OutputChannel {
        return this.outputChannel;
    }

  // Expose a log API compatible with ExplicitErrorLogger expectations
  logInfo(storyId: string, message: string): void {
    this.info(`${message} (Story: ${storyId})`);
  }
  logWarning(storyId: string, message: string, context?: Record<string, any>): void {
    this.warn(`${message} (Story: ${storyId})${context ? ` ${JSON.stringify(context)}` : ''}`);
  }
  logErrorMessage(storyId: string, message: string, context?: Record<string, any>): void {
    this.error(`${message} (Story: ${storyId})${context ? ` ${JSON.stringify(context)}` : ''}`);
  }

    /**
     * Replace story IDs with story names in log messages
     */
    private resolveStoryNames(message: string): string {
        if (!this.storyService) {
            return message;
        }

        // Match story_TIMESTAMP pattern
        const storyIdPattern = /story_\d+/g;
        return message.replace(storyIdPattern, (storyId) => {
            try {
                const story = this.storyService.getStory(storyId);
                return story ? `"${story.name}" (${storyId})` : storyId;
            } catch (error) {
                return storyId;
            }
        });
    }

    info(message: string, ...args: any[]): void {
        const formattedMessage = this.formatMessage('INFO', message, args);
        this.outputChannel.appendLine(formattedMessage);
        console.log(formattedMessage);
    }

    warn(message: string, ...args: any[]): void {
        const formattedMessage = this.formatMessage('WARN', message, args);
        this.outputChannel.appendLine(formattedMessage);
        console.warn(formattedMessage);
    }

    error(message: string, error?: any): void {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const formattedMessage = this.formatMessage('ERROR', message, error ? [errorMessage] : []);
        this.outputChannel.appendLine(formattedMessage);
        console.error(formattedMessage, error);
    }

    debug(message: string, ...args: any[]): void {
        if (process.env.NODE_ENV === 'development') {
            const formattedMessage = this.formatMessage('DEBUG', message, args);
            this.outputChannel.appendLine(formattedMessage);
            console.debug(formattedMessage);
        }
    }

    show(): void {
        this.outputChannel.show();
    }

    hide(): void {
        this.outputChannel.hide();
    }

    clear(): void {
        this.outputChannel.clear();
    }

    private formatMessage(level: string, message: string, args: any[]): string {
        const timestamp = new Date().toISOString();
        const resolvedMessage = this.resolveStoryNames(message);
        const argsString = args.length > 0 ? ` ${JSON.stringify(args)}` : '';
        return `[${timestamp}] [${level}] ${resolvedMessage}${argsString}`;
    }
}

export const logger = Logger.getInstance();










