/**
 * One-Shot Progress Tracker - Tracks progress through 6 phases of Script genration
 * Provides detailed progress updates for VS Code UI
 */

import * as vscode from 'vscode';
import { ProgressManager } from './progressManager';

export interface OneShotProgressPhase {
  id: string;
  name: string;
  description: string;
  progress: number; // 0-100
  status: 'pending' | 'running' | 'completed' | 'failed';
  startTime?: string;
  endTime?: string;
  error?: string;
  details?: string;
}

export class OneShotProgressTracker {
  private mainTaskId: string;
  private phases: OneShotProgressPhase[] = [];
  private progressManager: ProgressManager;
  
  constructor(storyId: string, totalSegments: number) {
    this.mainTaskId = `one_shot_${storyId}_${Date.now()}`;
    this.progressManager = ProgressManager.getInstance();
    this.initializePhases(totalSegments);
    this.progressManager.startTask(this.mainTaskId, `🚀 Script genration: ${storyId}`);
  }
  
  /**
   * Initialize the 6 phases of Script genration
   */
  private initializePhases(totalSegments: number): void {
    this.phases = [
      {
        id: 'context_building',
        name: 'Building Master Context',
        description: 'Compressing assets, parsing research, building timing map',
        progress: 0,
        status: 'pending'
      },
      {
        id: 'file_upload',
        name: 'Uploading Context File',
        description: 'Uploading master context to OpenAI Assistants API',
        progress: 0,
        status: 'pending'
      },
      {
        id: 'one_shot_generation',
        name: 'Generating All Segments',
        description: `Generating ${totalSegments} segments with file attachment`,
        progress: 0,
        status: 'pending'
      },
      {
        id: 'validation',
        name: 'Validating All Segments',
        description: 'Bulk validation for consistency and quality',
        progress: 0,
        status: 'pending'
      },
      {
        id: 'file_writing',
        name: 'Writing Segment Files',
        description: `Writing ${totalSegments} individual segment files`,
        progress: 0,
        status: 'pending'
      },
      {
        id: 'cleanup',
        name: 'Cleanup',
        description: 'Removing temporary files and API resources',
        progress: 0,
        status: 'pending'
      }
    ];
  }
  
  /**
   * Start a phase
   */
  startPhase(phaseId: string): void {
    const phase = this.phases.find(p => p.id === phaseId);
    if (phase) {
      phase.status = 'running';
      phase.startTime = new Date().toISOString();
      this.updateProgress();
    }
  }
  
  /**
   * Update progress for a specific phase
   */
  updatePhaseProgress(phaseId: string, progress: number, details?: string): void {
    const phase = this.phases.find(p => p.id === phaseId);
    if (phase) {
      phase.progress = Math.min(100, Math.max(0, progress));
      if (details) phase.details = details;
      this.updateProgress();
    }
  }
  
  /**
   * Complete a phase
   */
  completePhase(phaseId: string, description?: string): void {
    const phase = this.phases.find(p => p.id === phaseId);
    if (phase) {
      phase.status = 'completed';
      phase.progress = 100;
      phase.endTime = new Date().toISOString();
      if (description) phase.description = description;
      this.updateProgress();
    }
  }
  
  /**
   * Fail a phase
   */
  failPhase(phaseId: string, error: string): void {
    const phase = this.phases.find(p => p.id === phaseId);
    if (phase) {
      phase.status = 'failed';
      phase.error = error;
      phase.endTime = new Date().toISOString();
      this.updateProgress();
    }
  }
  
  /**
   * Update overall progress
   */
  private updateProgress(): void {
    const overallProgress = this.calculateOverallProgress();
    const currentPhase = this.phases.find(p => p.status === 'running');
    
    const taskDescription = currentPhase 
      ? `${currentPhase.name} (${currentPhase.progress}%)${currentPhase.details ? ` - ${currentPhase.details}` : ''}`
      : 'Processing...';
    
    this.progressManager.updateTask(this.mainTaskId, 'running', taskDescription);
  }
  
  /**
   * Calculate overall progress across all phases
   */
  private calculateOverallProgress(): number {
    const totalWeight = this.phases.length * 100;
    const completedWeight = this.phases.reduce((sum, phase) => {
      if (phase.status === 'completed') return sum + 100;
      if (phase.status === 'running') return sum + phase.progress;
      return sum;
    }, 0);
    
    return Math.round((completedWeight / totalWeight) * 100);
  }
  
  /**
   * Get current phase status
   */
  getCurrentPhase(): OneShotProgressPhase | undefined {
    return this.phases.find(p => p.status === 'running');
  }
  
  /**
   * Get all phases
   */
  getAllPhases(): OneShotProgressPhase[] {
    return [...this.phases];
  }
  
  /**
   * Get completed phases count
   */
  getCompletedPhases(): number {
    return this.phases.filter(p => p.status === 'completed').length;
  }
  
  /**
   * Get failed phases count
   */
  getFailedPhases(): number {
    return this.phases.filter(p => p.status === 'failed').length;
  }
  
  /**
   * Check if all phases are completed
   */
  isComplete(): boolean {
    return this.phases.every(p => p.status === 'completed' || p.status === 'failed');
  }
  
  /**
   * Check if any phase failed
   */
  hasFailures(): boolean {
    return this.phases.some(p => p.status === 'failed');
  }
  
  /**
   * Get phase by ID
   */
  getPhase(phaseId: string): OneShotProgressPhase | undefined {
    return this.phases.find(p => p.id === phaseId);
  }
  
  /**
   * Get progress summary
   */
  getProgressSummary(): {
    overallProgress: number;
    currentPhase: string;
    completedPhases: number;
    totalPhases: number;
    hasFailures: boolean;
  } {
    const overallProgress = this.calculateOverallProgress();
    const currentPhase = this.getCurrentPhase();
    const completedPhases = this.getCompletedPhases();
    const hasFailures = this.hasFailures();
    
    return {
      overallProgress,
      currentPhase: currentPhase?.name || 'Completed',
      completedPhases,
      totalPhases: this.phases.length,
      hasFailures
    };
  }
  
  /**
   * Complete the entire task
   */
  completeTask(): void {
    this.progressManager.completeTask(this.mainTaskId, 'Script genration completed');
  }
  
  /**
   * Fail the entire task
   */
  failTask(error: string): void {
    this.progressManager.failTask(this.mainTaskId, `Script genration failed: ${error}`);
  }
}
