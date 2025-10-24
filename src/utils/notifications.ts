/**
 * Notifications Utility
 * Manages VS Code notifications
 */

import * as vscode from 'vscode';
import { logger } from './logger';

export class Notifications {
    /**
     * Log message to output channel (console)
     * Now uses the shared logger's output channel
     */
    static log(message: string, show: boolean = false): void {
        // Use logger which has the shared output channel
        logger.info(message);
        
        if (show) {
            logger.show();
        }
    }

    /**
     * Show info notification
     */
    static info(message: string, ...actions: string[]): Thenable<string | undefined> {
        logger.info(message);
        return vscode.window.showInformationMessage(message, ...actions);
    }

    /**
     * Show warning notification
     */
    static warn(message: string, ...actions: string[]): Thenable<string | undefined> {
        logger.warn(message);
        return vscode.window.showWarningMessage(message, ...actions);
    }

    /**
     * Show error notification
     */
    static error(message: string, error?: any, ...actions: string[]): Thenable<string | undefined> {
        logger.error(message, error);
        const errorMessage = error instanceof Error ? `${message}: ${error.message}` : message;
        return vscode.window.showErrorMessage(errorMessage, ...actions);
    }

    /**
     * Show progress notification
     */
    static async withProgress<T>(
        title: string,
        task: (progress: vscode.Progress<{ message?: string; increment?: number }>) => Promise<T>
    ): Promise<T> {
        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title,
                cancellable: false
            },
            task
        );
    }

    /**
     * Show progress notification with cancellation
     */
    static async withCancellableProgress<T>(
        title: string,
        task: (
            progress: vscode.Progress<{ message?: string; increment?: number }>,
            token: vscode.CancellationToken
        ) => Promise<T>
    ): Promise<T> {
        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title,
                cancellable: true
            },
            task
        );
    }

    /**
     * Show status bar message
     */
    static statusBar(message: string, hideAfterTimeout?: number): vscode.Disposable {
        if (hideAfterTimeout !== undefined) {
            return vscode.window.setStatusBarMessage(message, hideAfterTimeout);
        }
        return vscode.window.setStatusBarMessage(message);
    }

    /**
     * Ask for confirmation
     */
    static async confirm(message: string, confirmLabel: string = 'Yes', cancelLabel: string = 'No'): Promise<boolean> {
        const result = await vscode.window.showWarningMessage(
            message,
            { modal: true },
            confirmLabel
        );
        return result === confirmLabel;
    }

    /**
     * Show input box
     */
    static async input(
        prompt: string,
        placeholder?: string,
        value?: string,
        validator?: (value: string) => string | undefined
    ): Promise<string | undefined> {
        return vscode.window.showInputBox({
            prompt,
            placeHolder: placeholder,
            value,
            validateInput: validator
        });
    }

    /**
     * Show quick pick
     */
    static async quickPick<T extends vscode.QuickPickItem>(
        items: T[],
        placeholder?: string
    ): Promise<T | undefined> {
        return vscode.window.showQuickPick(items, {
            placeHolder: placeholder
        });
    }

    /**
     * Show file open dialog
     */
    static async openFile(
        title: string,
        filters?: { [name: string]: string[] }
    ): Promise<vscode.Uri | undefined> {
        const result = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            title,
            filters
        });

        return result?.[0];
    }

    /**
     * Show save dialog
     */
    static async saveFile(
        defaultUri?: vscode.Uri,
        filters?: { [name: string]: string[] }
    ): Promise<vscode.Uri | undefined> {
        return vscode.window.showSaveDialog({
            defaultUri,
            filters
        });
    }
}

