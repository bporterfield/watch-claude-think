# Architecture Decision Records (ADRs)

This directory contains Architecture Decision Records (ADRs) documenting major architectural and design decisions in watch-claude-think.

## What is an ADR?

An Architecture Decision Record (ADR) captures an important architectural decision made along with its context and consequences. ADRs help future maintainers understand:

- Why certain design choices were made
- What alternatives were considered
- What trade-offs were accepted
- What constraints influenced the decision

## ADR Index

### Rendering & Display Architecture

- [ADR-001: Custom Terminal Rendering Pipeline](./001-custom-terminal-rendering.md) - Why bypass Ink's React rendering
- [ADR-002: Static vs Dynamic Output Separation](./002-static-dynamic-output.md) - Two-phase rendering model

### File System & Data Model

- [ADR-003: JSONL File Structure and Relationships](./003-jsonl-structure.md) - How sessions, conversations, and files relate
- [ADR-004: CWD Derivation Strategy](./004-cwd-derivation.md) - Reading from files vs decoding directory names
- [ADR-005: Git Worktree Detection](./005-worktree-detection.md) - Grouping related project worktrees

### Session & Message Management

- [ADR-006: Sessions vs Conversations Model](./006-sessions-vs-conversations.md) - Distinction and when to use each
- [ADR-007: Summary Handling and Session Naming](./007-summary-handling.md) - Cross-file summaries and orphan detection

## Reading ADRs

ADRs are numbered sequentially and organized by topic. Each ADR follows a standard format:

1. **Status**: Current state of the decision
2. **Context**: The problem and constraints
3. **Decision**: What was decided
4. **Consequences**: Results and trade-offs
5. **Alternatives**: What else was considered
6. **References**: Related code and docs

## Creating New ADRs

When making significant architectural decisions:

1. Copy `000-template.md` to a new numbered file
2. Fill in all sections with detail
3. Discuss with team/maintainers
4. Update status to "Accepted" when finalized
5. Add to this README's index

## ADR Lifecycle

- **Proposed**: Under discussion
- **Accepted**: Agreed upon and implemented
- **Deprecated**: No longer followed
- **Superseded**: Replaced by a newer ADR

## Questions or Feedback

For questions about these architectural decisions or to propose new ADRs, please open an issue in the repository.
