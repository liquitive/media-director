# Pre-Flight Sanity Checks - Host-Controlled Continuity System

## Overview

Before running large-scale tests (100+ segments), perform these quick functional validations to ensure the system is operating correctly.

---

## ✅ Quick Validation Checks

### 1. Assistant Persistence

**Objective:** Confirm Assistant is created once and reused across all batches.

**Steps:**
1. Run script generation for any story
2. Check VS Code global state:
   ```bash
   # MacOS
   cat ~/Library/Application\ Support/Code/User/globalStorage/liquitive.sora-director/state.vscdb
   
   # Or check logs for:
   grep "assistant" ~/.sora/logs/generation_system.log
   ```
3. **Expected:** Same `assistantId` logged for all batches
4. **Expected:** `Created new assistant` logged only once per policy version

**Pass Criteria:**
- ✅ Single Assistant ID reused across story
- ✅ No duplicate Assistant creation within same policy version

---

### 2. Thread Reuse

**Objective:** Ensure `createStoryThread()` is called once per story, thread reused across batches.

**Steps:**
1. Run script generation
2. Check logs for thread creation:
   ```bash
   grep "Thread created" ~/.sora/logs/generation_*.log
   ```
3. Count thread IDs — should be 1 per story

**Pass Criteria:**
- ✅ `Thread created: thread_xxx` logged once at story start
- ✅ Same thread ID used for all batches
- ✅ Thread deleted at end: `Cleanup completed`

---

### 3. Continuity JSON Persistence

**Objective:** Verify continuity state saves and updates after each batch.

**Steps:**
1. Run script generation (multi-batch story, 20+ segments)
2. After batch 1 completes, open:
   ```
   sora-output/stories/{storyId}/{storyId}.continuity.json
   ```
3. Verify structure:
   ```json
   {
     "lastSeenCharacter": {
       "John": { "segmentId": "segment_17", "index": 16, "storylineId": "main" }
     },
     "lastSeenLocation": {
       "Desert Camp": { "segmentId": "segment_15", "index": 14 }
     },
     "recentPrompts": [ "...", "..." ],
     "usedCameraMoves": [ "dolly left", "crane up" ],
     "updatedAt": "2025-10-25T..."
   }
   ```
4. After batch 2, check file updated with new `lastSeen` entries

**Pass Criteria:**
- ✅ File created after batch 1
- ✅ `lastSeenCharacter` populated with all characters from batch 1
- ✅ `lastSeenLocation` populated
- ✅ `recentPrompts` contains 8 most recent prompts
- ✅ File updates after each subsequent batch

---

### 4. Critic Tool Activation

**Objective:** Verify critic pass runs and flags violations (10-20% rewrite ratio expected).

**Steps:**
1. Run script generation
2. Check logs for:
   ```
   Critic pass complete
   Metrics: ...% clean, ... drift X, critic Y
   ```
3. Expected: `drift` and `critic` counts > 0 for some batches

**Pass Criteria:**
- ✅ `runCriticPass()` logged for each batch
- ✅ `critic` count in metrics (10-20% of segments flagged)
- ✅ No crashes or timeouts

**Note:** Initially, critic only flags (doesn't rewrite). Future: auto-rewrite integration.

---

### 5. Compression Trigger

**Objective:** Confirm prompts >80 words are compressed ~30%, maintain coherence.

**Steps:**
1. Run script generation
2. Check logs for:
   ```
   🗜️  Compressed segment segment_X: 95w → 67w
   ```
3. Open compressed segment JSON, verify `finalPrompt` is coherent

**Pass Criteria:**
- ✅ Compression triggers on long prompts
- ✅ Word count reduced by 20-40%
- ✅ Compressed prompts remain coherent (spot-check 3-5)
- ✅ `compressed: true` field in segment JSON

---

## ⚙️ Runtime & Cost Guardrails

| Variable | Recommended | Reason |
|----------|-------------|--------|
| `max_completion_tokens` | 12,000–16,000 | Avoid long tail latency |
| `batch_size` | 20 | Keeps output < 1 MB JSON per run |
| `temperature` | 0.3 | Repeatability |
| `frequency_penalty` | 0.2 | Subtle repetition damping |
| `presence_penalty` | 0 | Neutral narrative continuity |
| `critic_pass_probability` | 1.0 | Always run for now; tune later |

**Current Implementation:**
- ✅ `model: 'gpt-4.1'` (better tool adherence than 4-1106-preview)
- ✅ `BATCH_SIZE = 20` (line 759 in `assistantsAPIOneShotGenerator.ts`)
- ✅ `max_completion_tokens: 16384` (line 833)
- ✅ `temperature: 0.3` (in `ASSISTANT_CORE_INSTRUCTIONS`)
- ⚠️  `frequency_penalty` and `presence_penalty` not yet set (optional)

---

## 🧠 Test Scenarios

### Scenario 1: 10-Segment Micro Story

**Setup:**
- 1 character (John)
- 1 location (Desert Camp)
- Sequential narrative

**Expected Outcomes:**
- Clean rate: 100% (no drift, no repetition)
- Critic rewrites: 0-1
- All segments reference `segment_1` for continuity
- No `firstAppearance` after segment 1

**Steps:**
1. Create story with 10 segments, single character/location
2. Generate script
3. Verify all continuity refs point to `segment_1`

---

### Scenario 2: 20-Segment Multi-Cast Story

**Setup:**
- 3-4 characters cycling in/out of focus
- 2 locations alternating
- Mixed storylines

**Expected Outcomes:**
- `continuityRefsByCharacter` populated correctly
- When character disappears for N segments, continuity points to last active segment
- Location continuity switches properly

**Steps:**
1. Create story with varying character sets per segment
2. Generate script
3. Check `continuityRefsByCharacter` in segment JSONs
4. Verify gaps handled correctly (e.g., John in segment 1, 5, 10)

---

### Scenario 3: 100-Segment Full Story (5 Batches)

**Setup:**
- 5+ characters
- 3+ locations
- Multiple storylines

**Expected Outcomes:**
- Clean rate: ≥ 90%
- Avg n-gram overlap: < 0.25
- Compression triggered: 10-30% of segments
- Critic rewrites: 10-20% of segments
- Assistant reused: single Assistant ID across all batches

**Steps:**
1. Generate 100-segment story
2. Monitor logs for each batch
3. Verify metrics stay consistent batch-to-batch
4. Check final continuity.json has all characters/locations tracked

---

## 📊 QA Metrics to Monitor

### Per-Batch Metrics (logged automatically)

```
📊 Metrics: 95.0% clean, overlap 0.015, 3 compressed, drift 1, critic 2
   Scores: redundancy 0.18, novelty 0.65, continuity 0.92
```

**Key Indicators:**
- **Clean rate**: ≥ 90% (no drift or critic flags)
- **Overlap**: < 0.25 (n-gram similarity to recent prompts)
- **Compressed count**: 10-30% (prompts >80 words)
- **Drift count**: 0-5 per batch (trait re-descriptions caught)
- **Critic count**: 10-20% (filler phrases or violations flagged)
- **Redundancy score**: < 0.3 (AI self-assessment)
- **Novelty score**: 0.4-0.8 (AI self-assessment)
- **Continuity confidence**: > 0.7 (AI self-assessment)

---

## 🧩 Future Optimizations (Post-Testing)

- [ ] Swap to `gpt-4.1` once verified stable (better tool adherence)
- [ ] Batch memo compression: Summarize prior batch into 10-line digest
- [ ] Multi-thread render queue: Auto-trigger video generation per batch
- [ ] Auto-resume checkpoint: Re-load from `continuity.json` if run fails mid-batch
- [ ] CSV/NDJSON export: Per-story QA metrics for analytics
- [ ] Full CRITIC_TOOL integration: Auto-rewrite flagged segments (currently only flags)

---

## 🚨 Red Flags (Failure Indicators)

| Issue | Symptom | Fix |
|-------|---------|-----|
| **Duplicate Assistants** | Multiple `assistantId` values in logs | Check policy version caching logic |
| **Thread not reused** | `Thread created` logged multiple times per story | Fix `createStoryThread()` call placement |
| **Continuity file not saving** | File missing after batch 1 | Check write permissions, path validity |
| **No compression** | 0 compressed segments despite long prompts | Verify `compressPrompt()` threshold (80 words) |
| **High drift rate** | Drift count > 5 per batch | Check `ContinuityLinter` forbidden traits list |
| **Low clean rate** | < 80% clean | Investigate drift/critic flags, tune Assistant instructions |
| **High n-gram overlap** | > 0.3 avg | Lower batch size, tune repetition guard |

---

## ✅ Pre-Flight Checklist Summary

Before large-scale testing:

- [ ] **Assistant persistence**: Single ID reused across story
- [ ] **Thread reuse**: One thread per story, reused across batches
- [ ] **Continuity JSON**: Saves after batch 1, updates after each batch
- [ ] **Critic activation**: Flags 10-20% of segments
- [ ] **Compression**: Triggers on prompts >80 words, reduces 20-40%
- [ ] **Runtime guardrails**: Verify batch size, token limits, temperature
- [ ] **Test scenario 1**: 10-segment micro story (single character/location)
- [ ] **Test scenario 2**: 20-segment multi-cast story (verify continuity gaps)
- [ ] **Logs readable**: Emoji indicators visible: 🚀 📊 ✓ ⏳ 📦 🗜️
- [ ] **Metrics consistent**: Clean rate ≥ 90%, overlap < 0.25 across batches

---

## 📌 Next Steps

Once all pre-flight checks pass:

1. **Run test harness**: `npx ts-node tests/continuitySystemHarness.ts`
2. **Generate 10-segment story** via extension UI
3. **Generate 100-segment story** and monitor batch metrics
4. **Compare old vs new** prompts (length, repetition, consistency)
5. **Iterate on Assistant instructions** if metrics don't meet targets

---

**Status:** 🧪 Ready for testing
**Last Updated:** 2025-10-25

