# ADR-001: Custom Terminal Rendering Pipeline

## Status

Accepted

## Context

watch-claude-think displays thousands of thinking blocks and user messages streaming from Claude Code session files. The app is built with React via Ink, but we needed a rendering solution that could handle:

1. **Performance**: Efficiently render and update 1000s+ messages
2. **Terminal resize**: Handle width/height changes without visual artifacts
3. **Dynamic content**: Support ephemeral UI elements (like footer) that can be updated in place
4. **Extensibility**: Enable future capabilities like inline progress indicators or status updates

### The Ghost Lines Problem

Ink's `<Static>` component renders permanent output above the rest of the UI. However, it has a critical flaw with terminal resize:

**When terminal width shrinks**, content reflows to occupy more lines:

- Example: "This is a very long message..." at width 200 = 1 line
- At width 100, same message wraps to 2 lines

**Static doesn't track what it previously rendered**, so it can't clean up the old rendering:

- Old rendering (1 line at width 200) stays in terminal
- New rendering (2 lines at width 100) appears
- Result: You see BOTH = "ghost lines" / duplicate content

We tried several hacks:

- Render keys to force Static re-renders
- Writing to stdout then drawing Static component
- Putting everything in Static
- Tracking line counts and trying to remove ghosts manually

None reliably eliminated ghost lines across resize scenarios.

### Dynamic Content Requirements

Beyond static messages, we need:

- **Footer** with keyboard shortcuts that updates without cluttering scrollback
- **Future**: Potential for inline status updates, progress indicators, or other ephemeral UI within the message stream (capability that Claude Code uses)

Static component makes all content permanent, which doesn't work for dynamic/ephemeral content.

## Decision

**Implement a custom terminal rendering pipeline that bypasses Ink's rendering for message display.**

We adopted the same pattern that Claude Code uses: `CustomRenderLogger`.

### Architecture

```typescript
class CustomRenderLogger {
  private fullStaticOutput: string = ''; // Accumulated message history as STRING
  private previousDynamicOutput: string = ''; // Last footer (for clearing)

  render(frame: RenderFrame): TerminalOperation[] {
    // Detect resize
    if (frame.columns !== prevFrame.columns || frame.rows !== prevFrame.rows) {
      // FULL REDRAW - solves ghost lines!
      return [
        { type: 'synchronizedUpdateStart' },
        { type: 'clearTerminal' },
        { type: 'stdout', content: this.fullStaticOutput, scrollback: true },
        { type: 'stdout', content: frame.dynamicOutput, scrollback: true },
        { type: 'synchronizedUpdateEnd' },
      ];
    }

    // Normal update: append new message, update footer
    return [
      { type: 'synchronizedUpdateStart' },
      { type: 'clear', count: footerLineCount }, // Clear old footer
      { type: 'stdout', content: frame.staticOutput, scrollback: true }, // New message
      { type: 'stdout', content: frame.dynamicOutput, scrollback: false }, // New footer
      { type: 'synchronizedUpdateEnd' },
    ];
  }
}
```

### Key Insights

1. **Messages as String**: Accumulate rendered messages as a plain string (`fullStaticOutput`), NOT React components
2. **Resize = Full Redraw**: Clear terminal and rewrite entire string - no ghosts possible
3. **Static vs Dynamic**: Separate permanent content (messages) from ephemeral content (footer, future status updates)
4. **Direct Terminal Operations**: Write ANSI sequences directly via `stdout.write()`, bypassing Ink's reconciliation

### What We Still Use Ink For

- React hooks for lifecycle management (`useEffect`, `useState`, etc.)
- Keyboard input handling (return `<Box />` to keep Ink's stdin handling)
- ProjectSelector and SessionSelector (interactive components with manageable item counts)
- Structure and organization

## Consequences

### Positive

1. **Ghost lines eliminated**: Full redraw on resize guarantees clean output
2. **Performance at scale**: Handles 10,000+ messages without lag
   - Resize is instant (rewrite string vs reconcile 10k React components)
   - New messages append instantly (string concatenation vs React render)
3. **Dynamic content capability**: Can insert/update ephemeral UI anywhere
   - Footer updates without polluting scrollback
   - Future: Inline progress bars, status messages, etc. (like Claude Code does)
4. **Full control**: Can optimize ANSI sequences, line wrapping, cursor positioning
5. **Memory efficient**: Single accumulated string vs large React component tree

### Negative

1. **Cannot use Ink components for messages**
   - Must manually render to strings with ANSI codes
   - Lose Ink's automatic layout (`<Box>`, `<Text>` flex/alignment)
   - Need custom text wrapping logic

2. **More complex code**
   - Must understand ANSI escape sequences
   - Must track terminal state (dimensions, line counts)
   - Must calculate line wrapping manually

3. **Testing complexity**
   - Cannot use Ink's render testing utilities for message display
   - Must test terminal operations directly
   - Need to mock stdout/stderr

4. **Diverges from Ink idioms**
   - Less familiar to Ink developers
   - Custom pattern to learn/maintain
   - Documentation burden

### Neutral

1. **Hybrid rendering model**
   - Ink for: selectors, keyboard handling
   - Custom for: message stream display
   - Clear boundary at `StreamView` component

2. **Terminal state management**
   - Must track what's currently displayed
   - Handle edge cases (terminal too small, etc.)
   - More manual than declarative React

## Alternatives Considered

### Alternative 1: Pure Ink with Static Component

**Description**: Render all messages as `<Static items={messages}>` and let Ink handle everything.

**Why rejected**:

- **Ghost lines on resize** (deal-breaker - tried multiple hacks, none worked reliably)
- **Performance degrades** with 1000s of items in Static
- **No dynamic content** - everything in Static is permanent

### Alternative 2: Virtual Scrolling

**Description**: Only render visible messages, virtualize the rest (like react-window).

**Why rejected**:

- **Breaks terminal scrollback** - users expect native terminal scrollback to work
- **Complex scrolling logic** - no native terminal scrolling API
- **Still has React overhead** for visible items
- **Non-standard UX** - violates terminal conventions

### Alternative 3: Track and Remove Ghost Lines

**Description**: Keep using Static, but manually calculate and remove ghost lines after resize.

**Why rejected**:

- **Already tried** - unreliable across different scenarios
- **Fragile** - depends on accurate line counting across all terminal emulators
- **Race conditions** - resize events can overlap with new content
- **Why fight Static when we can own the rendering?**

## References

- Implementation: `src/lib/custom-logger.ts`
- Terminal operations: `src/lib/terminal-ops.ts`
- Render hook: `src/hooks/useCustomRenderer.ts`
- String rendering: `src/lib/block-renderer.ts`
- Inspiration: Claude Code's CustomRenderLogger (same pattern)
- Related: [ADR-002: Static vs Dynamic Output Separation](./002-static-dynamic-output.md)

## Notes

### Claude Code's Implementation

Claude Code uses the same CustomRenderLogger pattern for the same reasons. They additionally use dynamic content injection for:

- Inline status updates during long operations
- Progress indicators within the message stream
- Temporary notifications that appear and disappear

We don't use these capabilities yet, but the architecture enables them if needed.

### The Breakthrough Insight

**Messages are immutable once displayed.** We don't need React reconciliation to "update" them - they never change!

We just need to:

- Append new messages to a string (O(1))
- Reprint entire string on resize (O(n), but rare and fast for strings)

This is fundamentally different from React's strength (dynamic UIs with changing state).

### Performance Numbers

Informal testing showed:

- Pure Ink with 1000 Static items: ~2s resize lag
- CustomRenderLogger with 10,000 messages: ~100ms resize (instant feel)
- Memory: String accumulation uses ~1KB per message vs ~5KB per React component

### Future Extensibility

The separation of static/dynamic rendering enables:

- Multiple dynamic regions (header + footer)
- Inline dynamic content (progress bars within message stream)
- Transition effects when dynamic content changes
- Custom rendering modes (compact view, filtered view, etc.)

Currently we only use it for the footer, but the capability is there.
