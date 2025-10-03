# MANDATORY INITIALIZATION - DO THIS IMMEDIATELY

## ⚠️ STOP - READ THIS FIRST ⚠️

**YOU MUST READ THESE DOCUMENTS IMMEDIATELY UPON STARTING ANY CONVERSATION ABOUT THIS PROJECT.**
**DO NOT WAIT TO BE ASKED. DO NOT PROCEED WITHOUT READING THEM FIRST.**

### Required Documents (READ NOW IN THIS ORDER):
1. `docs/ARCHITECTURE.md` - MCP server architecture and best practices
2. `docs/TESTING.md` - MCP server testing strategies and patterns
3. `docs/TESTING-NOTES.md` - Critical test workspace setup requirements
4. `docs/ERROR-HANDLING.md` - Error handling patterns for MCP servers
5. `docs/MCP-TYPESCRIPT-README.md` - TypeScript MCP SDK patterns and examples

### Verification Checklist:
- [ ] I have read `docs/ARCHITECTURE.md` completely
- [ ] I have read `docs/TESTING.md` completely
- [ ] I have read `docs/TESTING-NOTES.md` completely
- [ ] I have read `docs/ERROR-HANDLING.md` completely
- [ ] I have read `docs/MCP-TYPESCRIPT-README.md` completely
- [ ] I understand the MCP architecture (simple functional patterns, no over-engineering)
- [ ] I understand the testing approach (MCP Inspector, STDIO compliance, stderr logging)
- [ ] I understand test workspace requirements (must be inside project, not /tmp)
- [ ] I understand error handling (MCP protocol compliance, user-friendly messages)
- [ ] I understand TypeScript SDK patterns (tools, resources, schemas)

If you haven't read these documents yet, STOP and read them now using the Read tool.
Only after reading all four documents should you proceed to help the user.

## Critical MCP Server Requirements

### Logging
- **NEVER write to stdout** - This breaks the JSON-RPC protocol
- **ALWAYS use stderr** for logging (via `console.error` or Pino configured for stderr)
- Use Pino with multi-stream: stderr for protocol compliance, files for debugging

### Error Handling
- **Tools return errors in content**, never throw JSON-RPC errors
- Use emojis for clear visual feedback (✅ ❌ ⚠️ 📁 💡)
- Track errors with Sentry/GlitchTip for production monitoring

### Architecture
- Keep it **simple and functional** - MCP protocol is the abstraction layer
- Use **Zod for validation**, not complex domain layers
- Direct tool implementations, no unnecessary factories or layers

### Testing
- Use **MCP Inspector** as primary development tool
- Test **stderr vs stdout compliance** rigorously
- Mock external commands for fast, deterministic tests

## Project Context

This is an MCP (Model Context Protocol) server for Xcode operations. The codebase should follow:
- Simple, functional architecture (not over-engineered layers)
- MCP protocol compliance (stderr for logs, content for errors)
- Integration-focused testing with MCP Inspector
- Zod validation for input schemas
- Direct tool implementations without unnecessary abstraction