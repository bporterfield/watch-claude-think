# Core Development Guidelines

## Philosophy

### Core Beliefs

- **Incremental progress over big bangs** - Small changes that compile and pass tests
- **Learning from existing code** - Study and plan before implementing
- **Pragmatic over dogmatic** - Adapt to project reality
- **Clear intent over clever code** - Be boring and obvious

### Simplicity Means

**Single responsibility per function/class**

- ❌ `getUserDataAndSendEmail()`
- ✅ `getUserData()` + `sendEmail()`

**Avoid premature abstractions**

- Don't create abstractions until you have 3+ similar cases
- Remove abstraction if it's harder to understand than duplicated code

**No clever tricks - choose the boring solution**

- ❌ Bitwise operators for flags
- ✅ Explicit boolean properties
- ❌ Complex one-liner with optional chaining and nullish coalescing
- ✅ Simple if/else that reads like English

**If you need to explain it, it's too complex**

- Code should read like documentation
- Variable/function names should make comments unnecessary

## Process

### 1. Planning & Staging

Document complex work in 3-5 stages in `docs/IMPLEMENTATION_PLAN.md`:

```markdown
## Stage 1: Add User Profile Endpoint

**Goal**: Create GET /users/:id endpoint that returns user profile
**Criteria**:

- Returns 200 with user data for valid ID
- Returns 404 for non-existent user
- Includes user's email threads count
  **Tests**:
- test/api/users.test.ts - happy path, 404 case, includes thread count
  **Status**: Complete

## Stage 2: Add Profile Edit Endpoint

**Goal**: Create PUT /users/:id endpoint for profile updates
**Criteria**:

- Updates allowed fields only
- Returns 403 if user doesn't own profile
- Validates input with Zod schema
  **Tests**:
- test/api/users.test.ts - update success, auth check, validation
  **Status**: In Progress
```

**Important**:

- Update status as you progress
- Remove file when all stages are done
- Keep stages small enough to complete in one session

### 2. Implementation Flow

1. **Understand** - Study existing patterns in codebase
   - Find 3 similar features/components
   - Identify common patterns and conventions
   - Note libraries and utilities already in use

2. **Test** - Write failing test
   - Test should fail for the right reason
   - One assertion per test when possible
   - Clear test name describing scenario

3. **Implement** - Minimal code to pass
   - Write only enough code to make test pass
   - No extra features or optimizations yet

4. **Refactor** - Clean up with tests passing
   - Extract duplicated code
   - Improve naming
   - Simplify complex logic

5. **Commit** - Clear message linking to plan
   - Reference stage number from implementation plan
   - Explain "why" not just "what"

### 3. When Stuck

**CRITICAL**: Maximum 3 attempts per issue, then STOP.

**An attempt = One distinct approach to solving the problem**

Examples of attempts:

- Attempt 1: Try using library method A
- Attempt 2: Try using library method B
- Attempt 3: Try different architectural pattern

NOT attempts:

- Fixing typos in the same approach
- Re-running the same code hoping for different results
- Minor tweaks to the same approach

**After 3 failed attempts:**

1. **Document what failed**:
   - What you tried (be specific about each attempt)
   - Specific error messages or unexpected behavior
   - Why you think each approach failed

2. **Research alternatives**:
   - Find 2-3 similar implementations in other projects
   - Note different approaches used
   - Look for official examples in library documentation

3. **Question fundamentals**:
   - Is this the right abstraction level?
   - Can this be split into smaller problems?
   - Is there a simpler approach entirely?
   - Am I fighting the framework/library?

4. **Try different angle**:
   - Different library/framework feature?
   - Different architectural pattern?
   - Remove abstraction instead of adding?
   - Can I solve 10% of the problem first?

## Technical Standards

### Architecture Principles

**Composition over inheritance**

- Use dependency injection to compose behavior
- Pass dependencies explicitly rather than importing globals
- Makes code testable and flexible

**Interfaces over singletons**

- Define contracts with TypeScript interfaces
- Enable testing with mock implementations
- Allow runtime flexibility

**Explicit over implicit**

- Clear data flow (no hidden side effects)
- Explicit dependencies (no magic imports)
- Obvious error cases (no silent failures)

**Test-driven when possible**

- Write test first to clarify requirements
- Never disable tests, fix them
- Tests should enable refactoring, not prevent it

### Code Quality Standards

**Every commit must**:

- Compile successfully (`npm run typecheck`)
- Pass all existing tests (`npm run test`)
- Pass linting (`npm run lint`)
- Include tests for new functionality
- Follow project formatting

**Before committing**:

- Run `npm run check` (typecheck + lint)
- Self-review changes in git diff
- Ensure commit message explains "why"
- Verify no debug code (console.log, commented code)

### Error Handling

**Fail fast with descriptive messages**

```typescript
// ❌ Bad
if (!user) return null;

// ✅ Good
if (!user) {
  throw new Error(`User not found: ${userId}`);
}
```

**Include context for debugging**

```typescript
// ❌ Bad
throw new Error('Invalid input');

// ✅ Good
throw new Error(`Invalid email format: ${email}. Expected format: user@domain.com`);
```

**Handle errors at appropriate level**

- Don't catch errors you can't handle
- Let errors bubble up to boundaries (API handlers, etc.)
- Log with context at error boundaries

**Never silently swallow exceptions**

```typescript
// ❌ Bad
try {
  await riskyOperation();
} catch (e) {
  // Silent failure
}

// ✅ Good
try {
  await riskyOperation();
} catch (e) {
  logger.error('Failed to perform risky operation', { error: e, context });
  throw e; // or handle appropriately
}
```

## Decision Framework

When multiple valid approaches exist, choose based on:

1. **Testability** - Can I easily test this in isolation?
2. **Readability** - Will someone understand this in 6 months?
3. **Consistency** - Does this match existing project patterns?
4. **Simplicity** - Is this the simplest solution that works?
5. **Reversibility** - How hard to change later if requirements shift?

Use this priority order. Testability trumps all else.

## Debugging

- **Use Breakpoint MCP server to step through code**
- **Write scratch files to `scratch/` to test assumptions, try things, or to get to breakpoints easier**

See @DEBUGGING.md for more details

## Testing

**Test Types in This Project**:

- **Unit tests**: Functions, utilities, pure logic
- **Integration tests**: Test actual file, message watching, etc
- **E2e tests**: Use a real workflow

**Guidelines**:

- Test behavior, not implementation details
- One assertion per test when possible
- Clear test names describing scenario
- Use existing test utilities/helpers
- Tests should be deterministic (no random data, no timing dependencies)
- **NEVER leave console.log in tests**

**Common Mistakes**:

- Testing implementation (checking internal state) instead of behavior (checking outputs)
- Tests that pass even when code is broken (false positives)
- Tests that depend on order or previous tests
- Mocking things that should be real (like the database in database-tests)

## Quality Gates

### Definition of Done

- [ ] Tests written and passing
- [ ] Code follows project conventions
- [ ] `npm run check` passes (typecheck + lint)
- [ ] Commit messages are clear
- [ ] Implementation matches plan stage
- [ ] No TODOs without issue numbers
- [ ] No debug code left behind

## Critical Rules

### NEVER

- Use `any` type without explicit permission (causes lint errors)
- Use `unknown` type without asking first
- Use `--no-verify` to bypass commit hooks
- Disable tests instead of fixing them
- Commit code that doesn't compile
- Make assumptions - verify with existing code
- Leave console.log statements in code or tests

### ALWAYS

- Run `npm run check` before claiming "done"
- Run `npm run lint` before claiming "done"
- Update plan documentation as you go
- Learn from existing implementations
- Stop after 3 failed attempts and reassess
- Use proper types instead of `any` or `unknown`

See DEBUGGING.md for detailed debugging workflows and ARCHITECTURE.md for project-specific technical details.
