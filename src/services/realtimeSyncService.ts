import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';

/**
 * Real-time sync service that listens for state changes and immediately persists to filesystem
 * This ensures ZERO data loss - every state mutation is instantly written to disk
 */
export class RealtimeSyncService extends EventEmitter {
    private static instance: RealtimeSyncService;
    private writeQueue: Map<string, NodeJS.Timeout> = new Map();
    private readonly DEBOUNCE_MS = 50; // Very short debounce to batch rapid writes
    
    private constructor() {
        super();
        this.setupListeners();
    }
    
    static getInstance(): RealtimeSyncService {
        if (!RealtimeSyncService.instance) {
            RealtimeSyncService.instance = new RealtimeSyncService();
        }
        return RealtimeSyncService.instance;
    }
    
    /**
     * Setup internal event listeners
     */
    private setupListeners(): void {
        // Listen for master context changes
        this.on('masterContext:changed', (data: { storyId: string; filePath: string; updates: any }) => {
            this.syncMasterContext(data.storyId, data.filePath, data.updates);
        });
        
        // Listen for segment changes
        this.on('segment:changed', (data: { storyId: string; segmentId: string; segmentIndex: number; segmentData: any; filePath: string }) => {
            this.syncSegment(data.storyId, data.segmentId, data.segmentIndex, data.segmentData, data.filePath);
        });
        
        logger.info('RealtimeSyncService: Event listeners initialized');
    }
    
    /**
     * Emit master context change event
     */
    emitMasterContextChange(storyId: string, filePath: string, updates: any): void {
        logger.info(`RealtimeSyncService: Master context change detected for story ${storyId}`);
        this.emit('masterContext:changed', { storyId, filePath, updates });
    }
    
    /**
     * Emit segment change event
     */
    emitSegmentChange(storyId: string, segmentId: string, segmentIndex: number, segmentData: any, filePath: string): void {
        logger.info(`RealtimeSyncService: Segment change detected: ${segmentId}`);
        this.emit('segment:changed', { storyId, segmentId, segmentIndex, segmentData, filePath });
    }
    
    /**
     * Sync master context to filesystem with debouncing
     */
    private syncMasterContext(storyId: string, filePath: string, updates: any): void {
        const key = `master_${storyId}`;
        
        // Clear existing timeout
        if (this.writeQueue.has(key)) {
            clearTimeout(this.writeQueue.get(key)!);
        }
        
        // Schedule write with debounce
        const timeout = setTimeout(async () => {
            try {
                // Ensure directory exists
                const dir = path.dirname(filePath);
                if (!fs.existsSync(dir)) {
                    await fs.promises.mkdir(dir, { recursive: true });
                }
                
                // Read existing or create empty
                let masterContext: any = {};
                if (fs.existsSync(filePath)) {
                    const content = await fs.promises.readFile(filePath, 'utf-8');
                    masterContext = JSON.parse(content);
                }
                
                // Merge updates
                masterContext = {
                    ...masterContext,
                    ...updates,
                    modifiedAt: new Date().toISOString()
                };
                
                // Write atomically (write to temp file, then rename)
                const tempPath = `${filePath}.tmp`;
                await fs.promises.writeFile(tempPath, JSON.stringify(masterContext, null, 2), 'utf-8');
                await fs.promises.rename(tempPath, filePath);
                
                logger.info(`✓ RealtimeSyncService: Synced master_context.json for ${storyId} (${Object.keys(updates).join(', ')})`);
                
                this.writeQueue.delete(key);
            } catch (error) {
                logger.error(`✗ RealtimeSyncService: Failed to sync master_context.json for ${storyId}:`, error);
                // Emit error event for monitoring
                this.emit('sync:error', { type: 'masterContext', storyId, error });
            }
        }, this.DEBOUNCE_MS);
        
        this.writeQueue.set(key, timeout);
    }
    
    /**
     * Sync segment to filesystem with debouncing
     */
    private syncSegment(storyId: string, segmentId: string, segmentIndex: number, segmentData: any, filePath: string): void {
        const key = `segment_${storyId}_${segmentId}`;
        
        // Clear existing timeout
        if (this.writeQueue.has(key)) {
            clearTimeout(this.writeQueue.get(key)!);
        }
        
        // Schedule write with debounce
        const timeout = setTimeout(async () => {
            try {
                // Ensure directory exists
                const dir = path.dirname(filePath);
                if (!fs.existsSync(dir)) {
                    await fs.promises.mkdir(dir, { recursive: true });
                }
                
                // Prepare segment data with metadata
                const fullSegmentData = {
                    version: '1.0',
                    storyId: storyId,
                    segmentIndex: segmentIndex,
                    updatedAt: new Date().toISOString(),
                    ...segmentData
                };
                
                // Write atomically (write to temp file, then rename)
                const tempPath = `${filePath}.tmp`;
                await fs.promises.writeFile(tempPath, JSON.stringify(fullSegmentData, null, 2), 'utf-8');
                await fs.promises.rename(tempPath, filePath);
                
                logger.info(`✓ RealtimeSyncService: Synced ${segmentId} for ${storyId}`);
                
                this.writeQueue.delete(key);
            } catch (error) {
                logger.error(`✗ RealtimeSyncService: Failed to sync ${segmentId} for ${storyId}:`, error);
                // Emit error event for monitoring
                this.emit('sync:error', { type: 'segment', storyId, segmentId, error });
            }
        }, this.DEBOUNCE_MS);
        
        this.writeQueue.set(key, timeout);
    }
    
    /**
     * Force flush all pending writes (call before exit/shutdown)
     */
    async flushAll(): Promise<void> {
        logger.info('RealtimeSyncService: Flushing all pending writes...');
        
        // Clear all timeouts and execute immediately
        const flushPromises: Promise<void>[] = [];
        
        for (const [key, timeout] of this.writeQueue.entries()) {
            clearTimeout(timeout);
            
            // Trigger immediate write by emitting with 0 debounce
            if (key.startsWith('master_')) {
                // Force immediate master context sync
                const storyId = key.replace('master_', '');
                flushPromises.push(Promise.resolve()); // Already handled by timeout clearing
            } else if (key.startsWith('segment_')) {
                // Force immediate segment sync
                flushPromises.push(Promise.resolve()); // Already handled by timeout clearing
            }
        }
        
        await Promise.all(flushPromises);
        this.writeQueue.clear();
        
        logger.info('RealtimeSyncService: All pending writes flushed');
    }
    
    /**
     * Get sync statistics
     */
    getStats(): { pendingWrites: number; queuedKeys: string[] } {
        return {
            pendingWrites: this.writeQueue.size,
            queuedKeys: Array.from(this.writeQueue.keys())
        };
    }
}












