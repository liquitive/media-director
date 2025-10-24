/**
 * Multi-Step Input Utility
 * Provides reusable multi-step QuickPick functionality for VS Code extensions
 */

import * as vscode from 'vscode';
import { logger } from './logger';

export interface StepResult<T = any> {
    value: T;
    step: number;
    canGoBack: boolean;
    canGoForward: boolean;
}

export interface StepConfig<T = any> {
    title: string;
    placeholder: string;
    items?: vscode.QuickPickItem[];
    inputBox?: {
        prompt: string;
        placeholder?: string;
        value?: string;
        validateInput?: (value: string) => string | undefined;
    };
    onDidChangeValue?: (value: string) => void;
    onDidAccept?: (value: string) => boolean; // Return true to proceed, false to stay
}

export class MultiStepInput {
    private quickPick: vscode.QuickPick<vscode.QuickPickItem>;
    private currentStep: number = 0;
    private steps: StepConfig[] = [];
    private results: any[] = [];
    private isActive: boolean = false;

    constructor() {
        this.quickPick = vscode.window.createQuickPick<vscode.QuickPickItem>();
        this.setupEventHandlers();
    }

    private setupEventHandlers(): void {
        this.quickPick.onDidAccept(() => {
            this.handleAccept();
        });

        this.quickPick.onDidChangeValue((value) => {
            const currentStepConfig = this.steps[this.currentStep];
            if (currentStepConfig.onDidChangeValue) {
                currentStepConfig.onDidChangeValue(value);
            }
        });

        this.quickPick.onDidHide(() => {
            this.isActive = false;
        });
    }

    /**
     * Configure the multi-step input with steps
     */
    configure(steps: StepConfig[]): void {
        this.steps = steps;
        this.currentStep = 0;
        this.results = [];
        this.isActive = true;
    }

    /**
     * Start the multi-step input process
     */
    async start(): Promise<StepResult[] | undefined> {
        if (this.steps.length === 0) {
            throw new Error('No steps configured');
        }

        this.isActive = true;
        this.currentStep = 0;
        this.results = [];

        return new Promise<StepResult[] | undefined>((resolve) => {
            this.quickPick.onDidHide(() => {
                if (this.isActive) {
                    this.isActive = false;
                    resolve(undefined); // User cancelled
                }
            });

            this.showCurrentStep();
        });
    }

    private showCurrentStep(): void {
        const stepConfig = this.steps[this.currentStep];
        
        this.quickPick.title = stepConfig.title;
        this.quickPick.placeholder = stepConfig.placeholder;
        this.quickPick.value = '';

        if (stepConfig.items) {
            this.quickPick.items = stepConfig.items;
            this.quickPick.canSelectMany = false;
        } else {
            this.quickPick.items = [];
            this.quickPick.canSelectMany = false;
        }

        // Show back/forward buttons
        this.updateButtons();
        
        this.quickPick.show();
    }

    private updateButtons(): void {
        const canGoBack = this.currentStep > 0;
        const canGoForward = this.currentStep < this.steps.length - 1;

        this.quickPick.buttons = [
            ...(canGoBack ? [{
                iconPath: new vscode.ThemeIcon('arrow-left'),
                tooltip: 'Back'
            }] : []),
            ...(canGoForward ? [{
                iconPath: new vscode.ThemeIcon('arrow-right'),
                tooltip: 'Next'
            }] : []),
            {
                iconPath: new vscode.ThemeIcon('close'),
                tooltip: 'Cancel'
            }
        ];
    }

    private handleAccept(): void {
        const stepConfig = this.steps[this.currentStep];
        const value = this.quickPick.value;

        // Validate input if needed
        if (stepConfig.inputBox?.validateInput) {
            const validation = stepConfig.inputBox.validateInput(value);
            if (validation) {
                vscode.window.showErrorMessage(validation);
                return;
            }
        }

        // Check if step has custom accept handler
        if (stepConfig.onDidAccept) {
            const shouldProceed = stepConfig.onDidAccept(value);
            if (!shouldProceed) {
                return;
            }
        }

        // Store result
        this.results[this.currentStep] = {
            value: value,
            step: this.currentStep,
            canGoBack: this.currentStep > 0,
            canGoForward: this.currentStep < this.steps.length - 1
        };

        // Move to next step or finish
        if (this.currentStep < this.steps.length - 1) {
            this.currentStep++;
            this.showCurrentStep();
        } else {
            this.finish();
        }
    }

    private finish(): void {
        this.isActive = false;
        this.quickPick.hide();
        
        // Return results
        const promise = new Promise<StepResult[]>((resolve) => {
            setTimeout(() => resolve(this.results), 100);
        });
    }

    /**
     * Go back to previous step
     */
    goBack(): void {
        if (this.currentStep > 0) {
            this.currentStep--;
            this.showCurrentStep();
        }
    }

    /**
     * Go forward to next step
     */
    goForward(): void {
        if (this.currentStep < this.steps.length - 1) {
            this.currentStep++;
            this.showCurrentStep();
        }
    }

    /**
     * Cancel the multi-step input
     */
    cancel(): void {
        this.isActive = false;
        this.quickPick.hide();
    }

    /**
     * Dispose of the multi-step input
     */
    dispose(): void {
        this.quickPick.dispose();
    }
}

/**
 * Helper function to create a simple multi-step input
 */
export async function createMultiStepInput(
    steps: StepConfig[],
    onResult?: (results: StepResult[]) => void
): Promise<StepResult[] | undefined> {
    const multiStep = new MultiStepInput();
    
    try {
        multiStep.configure(steps);
        const results = await multiStep.start();
        
        if (results && onResult) {
            onResult(results);
        }
        
        return results;
    } finally {
        multiStep.dispose();
    }
}









