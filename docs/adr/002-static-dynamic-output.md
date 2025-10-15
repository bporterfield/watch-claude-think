# ADR-002: Static vs Dynamic Output Separation

## Status

Accepted

## Context

After deciding to use custom terminal rendering (see [ADR-001](./001-custom-terminal-rendering.md)), we needed to design how content would be rendered efficiently. The application displays two types of content:

1. **Messages** (thinking blocks and user messages)
   - Streamed continuously from session files
   - Once displayed, they never change
   - Can accumulate to thousands of entries
   - Should persist in terminal scrollback

2. **Footer** (keyboard shortcuts and status)
   - Shows current state ("ESC: Back | Ctrl+C: Exit | Project: foo")
   - Changes occasionally (session name updates, new shortcuts)
   - Should always be visible at bottom of terminal
   - Should NOT clutter scrollback when user scrolls up

These have fundamentally different characteristics and update patterns. The question is: **How should we handle these two types of content in our custom renderer?**

### Key Requirements

- Messages accumulate over time (append-only)
- Footer updates occasionally (replace-only)
- Terminal resize must reflow both at new width
- Messages should persist in scrollback buffer
- Footer should not pollute scrollback buffer
- Performance must scale to thousands of messages

### Terminal Scrollback Context

Terminal emulators maintain two regions:
1. **Scrollback buffer**: Historical content you can scroll up to see
2. **Viewport**: Currently visible content

When we write to stdout:
- Content goes into viewport
- Old viewport content moves to scrollback buffer
- Users can scroll up to see history

This is exactly what we want for messages, but NOT for the footer (footer should disappear when user scrolls up, not leave copies in history).

## Decision

**Separate output into two distinct types with different rendering and terminal treatment:**

1. **Static Output**: Accumulated message content
   - Stored as concatenated string in `CustomRenderLogger`
   - Appended to, never modified
   - Written to terminal with `scrollback: true`
   - Persists in terminal scrollback buffer

2. **Dynamic Output**: Footer content
   - Rendered fresh each time (not accumulated)
   - Replaces previous footer
   - Written to terminal with `scrollback: false`
   - Does NOT persist in scrollback buffer

### Implementation

```typescript
interface RenderFrame {
  staticOutput: string;   // NEW static content to append (not full history)
  dynamicOutput: string;  // FRESH dynamic content (full footer)
  columns: number;
  rows: number;
}

class CustomRenderLogger {
  private fullStaticOutput: string = '';  // Accumulated history
  private previousDynamicOutput: string = '';  // Last footer (for clearing)

  render(frame: RenderFrame): TerminalOperation[] {
    // Accumulate new static content
    if (frame.staticOutput) {
      this.fullStaticOutput += '\n' + frame.staticOutput;
    }

    const ops: TerminalOperation[] = [];

    // Clear previous footer (if any)
    if (this.previousDynamicOutput) {
      const linesToClear = countTerminalLines(
        this.previousDynamicOutput,
        this.prevFrame.columns
      );
      ops.push({ type: 'clear', count: linesToClear });
    }

    // Write new static content (if any)
    if (frame.staticOutput) {
      ops.push({
        type: 'stdout',
        content: frame.staticOutput,
        scrollback: true  // Goes into scrollback buffer
      });
    }

    // Write fresh dynamic content
    ops.push({
      type: 'stdout',
      content: frame.dynamicOutput,
      scrollback: false  // Does NOT go into scrollback buffer
    });

    this.previousDynamicOutput = frame.dynamicOutput;
    return ops;
  }
}
```

### Scrollback Control

The `scrollback` flag in terminal operations controls whether content persists:

```typescript
interface TerminalOperation {
  type: 'stdout';
  content: string;
  scrollback: boolean;  // true = persist in scrollback, false = ephemeral
}
```

Implementation:
```typescript
function executeTerminalOperations(terminal: Terminal, ops: TerminalOperation[]) {
  for (const op of ops) {
    if (op.type === 'stdout') {
      if (op.scrollback) {
        // Normal write - goes into scrollback buffer
        terminal.stdout.write(op.content);
      } else {
        // Ephemeral write - use alternate screen or cursor positioning
        // to write content that won't persist when user scrolls
        terminal.stdout.write('\x1b[?25l');  // Hide cursor
        terminal.stdout.write(op.content);
        terminal.stdout.write('\x1b[?25h');  // Show cursor
      }
    }
  }
}
```

## Consequences

### Positive

1. **Optimal scrollback behavior**
   - Users can scroll up through message history
   - Footer disappears when scrolling up (as expected)
   - No duplicate footers cluttering history
   - Terminal feels natural and responsive

2. **Memory efficiency**
   - Static content: single accumulated string
   - Dynamic content: only current footer in memory
   - No need to store footer history

3. **Fast updates**
   - New messages: append string + clear/rewrite footer
   - Footer updates: just clear + rewrite footer
   - No recalculation of old content

4. **Clean resize handling**
   - Static: rewrite accumulated string at new width
   - Dynamic: render fresh footer at new width
   - Both benefit from separation

5. **Clear mental model**
   - Static = persistent, append-only, goes into history
   - Dynamic = ephemeral, replace-only, doesn't clutter history
   - Easy to reason about what persists

### Negative

1. **More complex state management**
   - Must track both `fullStaticOutput` and `previousDynamicOutput`
   - Must calculate line counts for clearing
   - Must handle edge cases (terminal too small, footer doesn't fit)

2. **Requires line counting**
   - To clear footer, must know how many lines it takes
   - Must account for line wrapping based on terminal width
   - Line counting logic is non-trivial

3. **Terminal-specific behavior**
   - Different terminals may handle ephemeral output differently
   - Must test across terminal emulators
   - Edge cases with alternate screen buffer

4. **Cannot easily "edit" messages**
   - Once in static output, messages are immutable
   - Cannot update a message after it's displayed
   - Would require full redraw to change past messages
   - (This is acceptable given our use case - messages don't change)

### Neutral

1. **Two distinct code paths**
   - Static output operations vs dynamic output operations
   - Different terminal write modes
   - Clear in code which is which

2. **Footer must render efficiently**
   - Since it re-renders frequently, must be fast
   - Cannot do expensive computations in footer render
   - Must memoize or cache footer calculations

## Alternatives Considered

### Alternative 1: Single Unified Output Stream

**Description**: Treat everything as a single stream of output. Re-render everything (messages + footer) on each update.

```typescript
// What we would do:
render(frame: RenderFrame): TerminalOperation[] {
  return [
    { type: 'clearTerminal' },
    { type: 'stdout', content: this.fullStaticOutput },
    { type: 'stdout', content: frame.dynamicOutput },
  ];
}
```

**Pros**:
- Simpler state management (no separate tracking)
- Easier to implement
- No line counting needed

**Cons**:
- **Full redraw on every footer update** (expensive)
- **Flicker** when clearing and rewriting
- **Poor scrollback experience** (footer copies in history)
- Wastes CPU writing same content repeatedly

**Why rejected**: Performance and user experience are both unacceptable. Footer updates would cause noticeable flicker and CPU usage.

### Alternative 2: Alternate Screen Buffer

**Description**: Use terminal's alternate screen buffer for the entire UI. Nothing persists in scrollback.

```typescript
// Enter alternate screen
process.stdout.write('\x1b[?1049h');

// All rendering happens in alternate screen

// Exit returns to main screen
process.stdout.write('\x1b[?1049l');
```

**Pros**:
- Full control over display
- Can update any part of screen
- No scrollback pollution

**Cons**:
- **Lose all message history** when user scrolls
- **No built-in scrollback** - would need to implement custom scrolling
- **Breaks terminal conventions** (users expect scrollback to work)
- Must implement our own paging/scrolling system
- Alternate screen is cleared when app exits

**Why rejected**: Losing terminal scrollback is a deal-breaker. Users expect to scroll up through messages using their terminal's native scrollback, especially for long sessions. Implementing custom scrolling is complex and non-standard.

### Alternative 3: Status Line at Top

**Description**: Put footer at top of output instead of bottom. Let it scroll away naturally.

```typescript
// Render order:
1. Footer (at top)
2. Messages (below, pushing footer up)
```

**Pros**:
- No need to clear/rewrite footer
- Simpler terminal operations
- Footer naturally scrolls into history

**Cons**:
- **Footer not always visible** (scrolls away)
- **Awkward UX** (status at top is unusual)
- **Footer in scrollback history** (clutters)
- Have to scroll down to see current status

**Why rejected**: Standard conventions put status/chrome at bottom of terminal UIs (like bash prompt, vim status line, tmux status bar). Having it scroll away defeats the purpose of showing current status.

### Alternative 4: Only Static Output, No Footer

**Description**: Just show messages, no footer with status/shortcuts.

**Pros**:
- Simplest possible implementation
- No dynamic content to manage
- No clearing/rewriting needed

**Cons**:
- **Poor UX** - users don't know what keys to press
- No visual feedback about state
- No indication that app is running vs frozen
- Harder to debug (no status info)

**Why rejected**: Footer provides critical UX value. Users need to know:
- How to exit (Ctrl+C)
- How to go back (ESC)
- What they're currently watching
- That the app is still running

## References

- Implementation: `src/lib/custom-logger.ts`
- Terminal operations: `src/lib/terminal-ops.ts` (scrollback flag)
- Footer rendering: `src/lib/footer-renderer.ts`
- Related: [ADR-001: Custom Terminal Rendering Pipeline](./001-custom-terminal-rendering.md)
- Related: [ADR-003: Synchronized Terminal Updates](./003-synchronized-updates.md)

## Notes

### Terminal Scrollback Details

The `scrollback: false` flag is implemented by:
1. Writing content normally (it appears in viewport)
2. Using cursor positioning to "lock" it at bottom
3. When new static content arrives, overwriting the footer location
4. The terminal's scrollback buffer doesn't capture the footer writes

This is a subtle but important detail - we're not using alternate screen buffer, just careful cursor management to make the footer "ephemeral" while keeping scrollback working for messages.

### Design Insight

The key insight is that **messages and footer have different lifecycles**:
- Messages: write-once, read-many, permanent
- Footer: write-many, read-current, temporary

Treating them differently in the rendering pipeline matches their semantic differences and yields better performance and UX.

### Future Considerations

Could extend this pattern to support:
- Multiple dynamic regions (header + footer)
- Dynamic content with longer lifetimes (temporary notifications)
- Transition effects when dynamic content changes

But for now, the simple static/dynamic split is sufficient and optimal for our use case.
