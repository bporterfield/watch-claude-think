# Debugging Guide

## Debugging Decision Tree

When you encounter an issue, follow this decision tree:

1. **Can you write a test for it?**
   → Write failing test first, then fix the code
   - Clarifies expected behavior
   - Prevents regression
   - Often reveals the real problem

2. **Is it a type/compile error?**
   → Run `npm run typecheck`, fix types
   - Read the error message carefully
   - Check import paths and exports
   - Verify TypeScript version matches project

3. **Is it runtime behavior?**
   → Use breakpoint debugger MCP Server (NOT console.log)
   - See "Breakpoint Debugger" section below
   - Inspect actual values at runtime
   - Step through execution flow

   ** NOTE: If necessary, write a quick script in scratch/ that imports the problematic code and steps through it **

4. **Is it in a complex flow?**
   → Set multiple breakpoints along the path
   - Trace data transformations
   - Identify where expectations diverge from reality
   - Use "Runtime Debugging" workflow below

5. **Still stuck after 3 attempts?**
   → Document and reassess approach
   - See "When Stuck" section in CLAUDE.md
   - Question fundamental approach
   - Research alternatives

## Breakpoint Debugger MCP

**CRITICAL**: Prefer breakpoint debugging over console.log statements.

You have access to a Node.js debugger through the Breakpoint MCP server. Use it proactively when:

- Investigating runtime issues or unexpected behavior
- Understanding execution flow through complex code
- Verifying variable values at specific points
- Debugging errors that only occur at runtime

### Best Practices

1. **Always check if files are loaded first**
   - Use `runtime_list_scripts` before setting breakpoints
   - Verify the exact file path in the loaded scripts list

2. **For early startup debugging**
   - Use `session_start({ pauseOnStart: true })` to pause before any code runs
   - Useful for debugging initialization code

3. **Hot-reload when possible**
   - Use `hot_reload_set_source` for code changes instead of restarting
   - Much faster iteration cycle
   - Preserves breakpoints and session state

4. **Clean up after debugging**
   - Use `breakpoints_delete` to remove breakpoints when done
   - Use `session_stop` to end debug session
   - Don't leave debug sessions running

5. **Set multiple breakpoints strategically**
   - Capture the full execution path leading to errors
   - Set breakpoints before, during, and after problematic code
   - Trace data transformations through the flow

## Scripts for Quick Testing

Prefer creating quick Typescript files in `scratch/` over inline tsx files or complicated bash.

### Critical Rules

**Before running ANY script**:

1. **Check your current working directory**: Run `pwd` - ensure you're at repo root
2. **ALWAYS use `--tsconfig tsconfig.json`**
3. **NEVER guess import paths or export names**:
   - Use Glob to find the file path: `glob "**/filename.ts"`
   - Use Read or Grep to verify exports: `grep "export.*functionName" path/to/file.ts`
4. **ALWAYS ensure typechecks work before execution**

## Bash Command Guidelines

### Available Tools

- ✅ python3 (use `python3 -m json.tool` for JSON parsing)
- ❌ jq (NOT installed - do not use)
- ❌ Complex bash loops (prone to parse errors in single-line mode)

#### Rules

1. **File operations**: Use Read/Grep/Glob tools, NOT cat/head/tail/find
2. **JSON parsing**: Use python3, NOT jq
3. **Multiple files**: Make parallel Read calls, NOT bash loops
4. **Complex operations**: Break into simple commands OR use Read + process in response

#### Examples

**❌ DON'T:**

```bash
for file in *; do head -1 $file | jq '.type'; done

✅ DO:
# Read files in parallel with Read tool, or:
head -1 file.jsonl | python3 -m json.tool | grep '"type"'


## When to Use Each Debugging Approach

| Issue Type         | Approach                          | Why                            |
| ------------------ | --------------------------------- | ------------------------------ |
| Type errors        | `npm run typecheck`               | Fast feedback, precise errors  |
| Compile errors     | Check imports/exports             | Usually import path issues     |
| Runtime crashes    | Breakpoint MCP debugger           | See exact state at crash       |
| Wrong values       | Breakpoint MCP debugger           | Inspect variables at each step |
| Complex flow       | Multiple breakpoints, scrach file | Trace data through system      |
| Test failures      | Write simpler test first          | Isolate the problem            |
| Integration issues | Database tests + breakpoints      | See real interactions          |
| Quick validation   | bash script                       | Test hypotheses rapidly        |

Remember: **Prefer breakpoint debugging over console.log**. It's faster, clearer, and doesn't pollute your code.
```
