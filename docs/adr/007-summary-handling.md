# ADR-007: Summary Handling and Session Naming

## Status

Accepted

## Context

watch-claude-think displays session names in the session selector UI. Users need meaningful names to identify conversations, not just UUIDs or generic labels.

Claude Code auto-generates summaries (5-10 word titles) for conversations using the Claude API. These summaries are stored in `.jsonl` files as separate entries, not as part of the message chain.

### Claude Code's Summary System

**Storage format:**
```jsonl
{"type":"summary","summary":"Debugging React Performance Issue","leafUuid":"abc-123-def"}
```

**Key characteristics:**
- Generated at CLI startup for any leaf message missing a summary
- No `parentUuid` - summaries are metadata, not messages
- Linked to leaf messages via `leafUuid` field
- Multiple summaries per file (one per conversation branch)

### The Orphaned Summary Problem

**Scenario:** A summary's `leafUuid` doesn't match the first user message's `parentUuid`.

```jsonl
{"type":"summary","summary":"Python Web Scraper","leafUuid":"old-leaf-123"}
{"type":"user","uuid":"msg1","parentUuid":"different-leaf-456","content":"Help with TypeScript"}
```

**This happens when:**
1. **Resume cancelled** - User started resume (summary written), then cancelled (new conversation branch created)
2. **Branching** - User branched conversation, creating new leaf unrelated to existing summary
3. **File inconsistencies** - Summary references a leaf from a different conversation
4. **Hallucination bug** - Empty/tool-heavy conversations get unrelated summaries (see Notes)

**The problem:**
- Summary describes Branch A ("Python Web Scraper")
- Current conversation is Branch B ("Help with TypeScript")
- Using orphaned summary would mislead users

### Session Naming Requirements

We need to:
1. **Show meaningful names** - Not just UUIDs or "Session 1"
2. **Handle orphaned summaries** - Don't use misleading summaries
3. **Handle unnamed sessions** - New sessions with no user messages yet
4. **Update dynamically** - Session name can change as conversation evolves
5. **Support cross-file summaries** - Resumed sessions reference old file's summaries

## Decision

**Implement multi-tier session naming with orphaned summary detection.**

### Naming Priority

```typescript
if (hasUserMessage && summaryText && !summariesAreOrphaned) {
  // Priority 1: Valid summary
  sessionName = summaryText;
  summaryIdInUse = leafUuid;
} else if (firstUserMessageText) {
  // Priority 2: First user message (orphaned or no summary)
  sessionName = truncate(firstUserMessageText, 40);
  summaryIdInUse = null;
} else {
  // Priority 3: No content yet
  sessionName = "Unnamed session";
  summaryIdInUse = null;
}
```

### Orphaned Summary Detection

```typescript
// Summary is valid ONLY if user message's parentUuid matches a summary's leafUuid
const parentPointsToSummary = summaries.some(
  s => s.leafUuid === firstUserMessageParentUuid
);
const summariesAreOrphaned = hasSummary && hasUserMessage && !parentPointsToSummary;
```

**Logic:**
1. Get all summaries from file (can be multiple)
2. Get first user message's `parentUuid`
3. Check if any summary's `leafUuid` matches that `parentUuid`
4. If no match → orphaned → skip summaries, use first user message text

### Dynamic Session Name Updates

**Re-extract session info when:**

```typescript
// Condition 1: Was unnamed (no user message existed initially)
const wasUnnamed = sessionInfo.sessionName === 'Unnamed session';

// Condition 2: New user message points to different summary
const hasDifferentSummaryId = newBlocks.some(block =>
  block.type === 'user' &&
  block.parentUuid !== null &&
  block.parentUuid !== sessionInfo.summaryIdInUse
);

if (wasUnnamed || hasDifferentSummaryId) {
  // Re-extract and update session name
  const extracted = await extractSessionInfo(filePath);
  sessionInfo.sessionName = extracted.sessionName;
  sessionInfo.summaryIdInUse = extracted.summaryIdInUse;
}
```

**Why update:**
- "Unnamed session" → user adds first message → use that message text
- Summary linkage changes → user branches → update to correct branch name

### Cross-File Summary Handling

**For listConversations() (conversation list view):**

```typescript
// Build global summary map from ALL files
const globalSummaryMap = new Map<string, string>();
for (const result of fileResults) {
  for (const { leafUuid, summary } of result.summaries) {
    globalSummaryMap.set(leafUuid, summary);
  }
}

// Apply to conversations (may be in different files)
for (const branch of conversations) {
  const finalSummary = branch.summary || globalSummaryMap.get(branch.leafUuid);
  // Use cross-file summary if available
}
```

**Why needed:**
- When resuming (`--resume`), Claude creates NEW file with summaries from OLD file
- New file's conversations reference leafUuids from previous conversations
- Global map enables finding summaries across file boundaries

## Consequences

### Positive

1. **Accurate names**
   - Orphaned summaries detected and skipped
   - Users see names that match actual conversation content
   - No misleading "Python Web Scraper" for TypeScript discussions

2. **Graceful degradation**
   - Summary → First message → "Unnamed" fallback chain
   - Always has a displayable name
   - Never shows blank or error states

3. **Dynamic updates**
   - Names update as conversations evolve
   - "Unnamed" becomes real name when user adds first message
   - Branch changes update to correct branch name

4. **Cross-file support**
   - Handles resumed sessions correctly
   - Finds summaries from previous files
   - Maintains naming consistency across resume operations

5. **Simple detection**
   - Single check: `parentUuid` matches `leafUuid`?
   - No complex tree traversal
   - Fast O(n) scan of summaries

### Negative

1. **Multiple file reads for naming**
   - Must read file to extract session info
   - Must parse summaries AND messages
   - Performance cost: ~50-100ms per session during initial load
   - (Mitigated: only reads first ~20 lines, can cache)

2. **Name changes surprise users**
   - Session name can change mid-watch
   - User selected "Unnamed session", now shows different name
   - (But this is generally good - more informative)

3. **First message truncation**
   - Limited to 40 characters
   - Long prompts get cut off with "..."
   - Less informative than full AI-generated summaries
   - (But better than wrong summary)

4. **No validation of summary quality**
   - We trust Claude Code's summaries are good
   - But hallucination bug means bad summaries exist
   - We just detect orphaning, not hallucination
   - (See Notes - this is Claude Code's bug to fix)

5. **Global summary map memory**
   - For listConversations(), must load all files
   - Build map of all leafUuid → summary pairs
   - Memory scales with number of sessions
   - (Acceptable for typical projects with <100 sessions)

### Neutral

1. **Track summaryIdInUse**
   - Must remember which summary is being used (if any)
   - Extra state to manage
   - But enables smart re-extraction logic

2. **Different logic for sessions vs conversations**
   - `listSessions()` uses local summaries only
   - `listConversations()` uses global summary map
   - Clear separation but two code paths

## Alternatives Considered

### Alternative 1: Always Use Summary

**Description**: Trust Claude Code's summaries, never fallback.

```typescript
sessionName = summaryText || "Unnamed session";
```

**Why rejected**:
- **Orphaned summaries mislead users** - "Python Web Scraper" for TypeScript conversation
- **No fallback for new sessions** - Many sessions don't have summaries yet
- **Hallucination bug impact** - Bad summaries would be displayed without mitigation

### Alternative 2: Always Use First Message

**Description**: Ignore summaries entirely, use first user message text.

```typescript
sessionName = firstUserMessageText || "Unnamed session";
```

**Why rejected**:
- **Loses AI-generated context** - Summaries capture full conversation arc, first message doesn't
- **Less informative** - "Help with this code" vs "Debugging React Performance Issue"
- **Wastes Claude Code's work** - Summaries already generated, why not use them?

### Alternative 3: Validate Summary Content

**Description**: Check if summary text relates to conversation content.

```typescript
if (summaryIsRelevant(summaryText, conversationContent)) {
  sessionName = summaryText;
} else {
  sessionName = firstUserMessageText;
}
```

**Why rejected**:
- **Complex NLP required** - Would need semantic similarity check
- **Expensive** - Another AI call or local model required
- **False positives** - Might reject valid summaries
- **Not our problem** - Hallucination is Claude Code's bug
- **Structural check sufficient** - Orphan detection catches most issues

### Alternative 4: Generate Our Own Summaries

**Description**: Don't use Claude Code's summaries, generate fresh ones.

```typescript
const summary = await generateSummary(conversationMessages);
```

**Why rejected**:
- **Expensive** - API calls cost money and time
- **Duplicate work** - Claude Code already did this
- **Inconsistent** - Users would see different names in Claude vs watch-claude-think
- **Complex** - Need API key management, rate limiting, etc.

### Alternative 5: Never Update Session Names

**Description**: Name is set once at initial load, never changes.

**Why rejected**:
- **"Unnamed" stays unnamed** - Even after user adds messages
- **Wrong names persist** - If branch changes, old name shown
- **Poor UX** - Users don't see accurate current state
- **Simple to update** - File change events already trigger re-read

## References

- Implementation: `src/lib/parser.ts:extractSessionInfo()`
- Session list: `src/lib/file-system.ts:listSessions()`
- Conversation list: `src/lib/file-system.ts:listConversations()`
- Dynamic updates: `src/services/session-manager.ts:handleFileChange()`
- Types: `src/types/claude-message.ts:SummaryEntry`
- Related: [ADR-003: JSONL File Structure](./003-jsonl-structure.md)

## Notes

### The Hallucination Bug

**Claude Code has a bug** where empty or tool-heavy conversations get completely unrelated hallucinated summaries.

**Root causes:**
1. **Message formatting filters out non-text** - Tool calls, images, etc. removed
2. **No empty content validation** - Empty formatted string sent to API
3. **Prompt caching collisions** - Similar/empty prompts share cache keys
4. **LLM fills the void** - Generates plausible title from training data

**Examples:**
- Empty conversation → "Debugging Python Web Scraper with Selenium"
- Tool-heavy conversation → "React Component State Management"
- No text content → Any random programming topic

**Why we don't detect this:**
- Hallucinated summaries ARE correctly linked (not orphaned)
- No structural mismatch to detect
- Would require semantic analysis (expensive, complex)
- This is Claude Code's bug to fix, not ours

**User impact:**
- See misleading names in session list
- But selecting the session shows correct content
- Orphan detection handles SOME cases (when linkage breaks)

**Workaround:**
- If summary is hallucinated but correctly linked, we show it
- If summary is hallucinated AND orphaned, we skip it
- Users can work around by looking at actual messages

### Session Name Update Logic

**Update happens on file change:**

```typescript
// SessionManager.handleFileChange()
const isUnnamed = sessionInfo.sessionName === 'Unnamed session';
const hasDifferentSummaryId = newUserMessage.parentUuid !== sessionInfo.summaryIdInUse;

if (isUnnamed || hasDifferentSummaryId) {
  const extracted = await extractSessionInfo(filePath);
  sessionInfo.sessionName = extracted.sessionName;
}
```

**Why this works:**
- New message arrives → file changes → we re-check
- If was unnamed and now has content → name improves
- If summary link changed → branch switched → name updates
- If nothing changed → skip re-extraction (performance)

### Cross-File Summary Example

**Old file (`session-123.jsonl`):**
```jsonl
{"type":"user","uuid":"msg1","content":"Help with caching"}
{"type":"assistant","uuid":"msg2","content":"Here's a solution"}
{"type":"summary","summary":"Redis Caching Implementation","leafUuid":"msg2"}
```

**New file after resume (`session-456.jsonl`):**
```jsonl
{"type":"summary","summary":"Redis Caching Implementation","leafUuid":"msg2"}
{"type":"user","uuid":"msg3","parentUuid":"msg2","content":"Now add TTL"}
```

**Global summary map enables:**
- New file references `leafUuid: "msg2"` from OLD file
- Global map contains: `"msg2" → "Redis Caching Implementation"`
- Conversation in new file gets correct summary from old file

### Performance Characteristics

**Initial session load:**
- Read first 20 lines of each session file
- Parse JSONL to find summaries and first user message
- Check orphaning (O(n) where n = number of summaries, typically 1-3)
- Total: ~50-100ms per session

**Dynamic updates:**
- Triggered only on file change + (unnamed OR different summary)
- Typically 0-1 updates per minute during active use
- Negligible performance impact

**Conversation list:**
- Must read ALL sessions in project (not just recent)
- Build global summary map (all files)
- Match summaries to conversations
- Total: 100-500ms for typical project with 10-20 sessions

### Future Considerations

1. **Caching** - Could cache extracted session info in memory
2. **Incremental updates** - Track which files changed, only re-extract those
3. **Better hallucination detection** - Semantic check against first message (expensive)
4. **User corrections** - Allow users to rename sessions manually
5. **Summary regeneration** - Re-generate summaries on demand

But current approach handles 99% of cases well, so we keep it simple.
