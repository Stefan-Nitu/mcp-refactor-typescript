# Test-Driven Development (TDD)

## The Core Cycle: Red-Green-Refactor

TDD operates in a tight loop (1-2 minutes):

```
🔴 RED → 🟢 GREEN → 🔵 REFACTOR → repeat
```

### 🔴 RED: Write a Failing Test

Write a test for functionality that doesn't exist yet.

```typescript
it('should validate email format', () => {
  expect(validateEmail('invalid')).toBe(false);
  expect(validateEmail('test@example.com')).toBe(true);
});
// Run → FAILS: "validateEmail is not defined" ✅
```

**Why:** Proves the test actually tests something. If you don't see it fail, you can't trust it.

### 🟢 GREEN: Write Minimal Code

Write just enough code to make the test pass. Nothing more.

```typescript
function validateEmail(email: string): boolean {
  return email.includes('@');
}
// Run → PASSES ✅
```

**Why:** Forces small steps, prevents over-engineering, keeps you focused on requirements.

### 🔵 REFACTOR: Improve the Design

Clean up the code without changing behavior.

```typescript
function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
// Run → STILL PASSES ✅
```

**Why:** Tests provide safety net for improvements. Do this constantly, not at project end.

---

## The Critical Distinction: Behavior vs Implementation

### Test WHAT, Not HOW

**Behavior Testing** = Test observable outcomes through public APIs

```typescript
// ✅ GOOD - Tests behavior
it('should rename function across files', async () => {
  await writeFile('lib.ts', 'export function oldName() {}');
  await writeFile('main.ts', 'import { oldName } from "./lib"');

  await renameFunction('lib.ts', 'oldName', 'newName');

  expect(await readFile('lib.ts')).toContain('newName');
  expect(await readFile('main.ts')).toContain('newName');
});
```

**Implementation Testing** = Test internal mechanics, method calls, private state

```typescript
// ❌ BAD - Tests implementation
it('should call sortEdits before applyEdits', () => {
  const sortSpy = vi.spyOn(service, 'sortEdits');
  const applySpy = vi.spyOn(service, 'applyEdits');

  service.process(data);

  expect(sortSpy).toHaveBeenCalledBefore(applySpy);
  // Breaks when you refactor, even if behavior unchanged
});
```

### The Decision Framework

Ask: **"Would this test break if I completely rewrote the internals but kept the same behavior?"**

- **YES** → You're testing implementation (bad)
- **NO** → You're testing behavior (good)

---

## AI-Assisted TDD Rules

When working with AI (Claude, GPT-4, Copilot):

### Rule #1: Humans Write Tests, AI Implements

```typescript
// ❌ WRONG
"Claude, write tests and implementation for user authentication"

// ✅ RIGHT
// 1. Human writes test first:
it('should reject weak passwords', () => {
  expect(() => validatePassword('weak')).toThrow('Too weak');
});

// 2. Then: "Claude, implement validatePassword to pass this test"
```

**Why:** If AI writes both, it may generate tests that validate buggy behavior.

### Rule #2: Always Verify Tests Fail First

```typescript
// Must show AI the failure:
"Claude, run this test and show me it fails"
// Claude: "Test fails: validatePassword is not defined"

// Then implement:
"Claude, now implement it to pass"
```

**Why:** Proves test actually tests something. Prevents AI hallucinations.

### Rule #3: Constrain AI to Minimal Implementation

```
Write the SIMPLEST code to pass this test.
No extra features.
No code for untested scenarios.
YAGNI - You Aren't Gonna Need It.
```

**Why:** AI defaults to comprehensive solutions. You must explicitly constrain it.

---

## Common Pitfalls

### 1. Testing for Testing's Sake

**Symptom:** Tests with no meaningful assertions, testing trivial code.

```typescript
// ❌ Don't test this
it('should set value', () => {
  obj.value = 42;
  expect(obj.value).toBe(42);
});
```

**Fix:** Only test code with logic, not simple assignments.

### 2. Skipping the RED Phase

**Symptom:** Tests written and immediately pass.

**Fix:** ALWAYS run test and verify it fails before implementing.

### 3. Writing Multiple Tests Before Any Pass

**Symptom:** Many failing tests at once.

**Fix:** One test at a time. Make it pass before writing the next.

### 4. Testing Implementation Details

**Symptom:** Tests break during refactoring, tests reference private methods.

**Fix:** Test through public API only. Verify observable outcomes.

### 5. Over-Mocking

**Symptom:** More mock setup than actual test code.

```typescript
// ❌ Bad
const mockDb = vi.fn();
const mockCache = vi.fn();
const mockLogger = vi.fn();
const mockValidator = vi.fn();
// ...tons of setup

// ✅ Good
const realValidator = new Validator();
const mockExternalApi = vi.fn(); // Only mock external dependencies
```

**Fix:** Only mock external dependencies (databases, APIs). Use real implementations for your own code.

### 6. Slow Tests

**Symptom:** Test suite takes minutes, developers stop running tests.

**Fix:**
- Use test doubles for external dependencies
- Use fake timers instead of real delays
- Keep unit tests < 100ms each

### 7. Tests Harder to Understand Than Code

**Symptom:** Complex test logic, nested loops, unclear assertions.

**Fix:** Follow Arrange-Act-Assert pattern. Use helper functions. Keep tests simple.

---

## Test Organization

### Test Types

Organize tests by purpose:

**Unit Tests** - Business logic only, all dependencies mocked
```typescript
describe('calculateDiscount', () => {
  it('should apply 10% discount', () => {
    expect(calculateDiscount(100, 10)).toBe(90);
  });
});
```

**Integration Tests** - Multiple components together, minimal mocking
```typescript
describe('Order processing', () => {
  it('should create order and update inventory', async () => {
    // Real database, real services, mock only external APIs
  });
});
```

**Contract Tests** - Verify correct API/protocol usage
```typescript
describe('API contract', () => {
  it('should follow REST conventions', async () => {
    const response = await api.getUser('123');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/json');
  });
});
```

**Note:** Contract tests ARE behavioral tests - they test the behavior of maintaining compatibility.

**E2E Tests** - Full user workflows, no mocks
```typescript
describe('Complete checkout flow', () => {
  it('should allow user to purchase item', async () => {
    // Real browser, real backend, real database
  });
});
```

---

## Quick Reference

### TDD Workflow Checklist

For each new feature:

1. ☐ Write ONE failing test (RED)
2. ☐ Run test, verify FAILS
3. ☐ Write MINIMUM code (GREEN)
4. ☐ Run test, verify PASSES
5. ☐ Refactor while keeping green
6. ☐ Commit
7. ☐ Repeat

### AI-Assisted TDD Checklist

1. ☐ Human writes test
2. ☐ Show AI the failure
3. ☐ AI implements minimal code
4. ☐ Human reviews critically
5. ☐ Human refactors

### Test Quality Checklist

Before committing:

1. ☐ Did I see this fail first?
2. ☐ Tests behavior, not implementation?
3. ☐ Will survive refactoring?
4. ☐ Is it fast?
5. ☐ Tests one concept?
6. ☐ Tests edge cases?

### Red Flags

🚩 Test passes without seeing it fail first
🚩 Testing private methods or internal state
🚩 Heavy mocking of your own code
🚩 Test name describes HOW instead of WHAT
🚩 Test breaks during refactoring
🚩 Test takes > 1 second (unit test)

---

## The Golden Rules

> **Test the contract (WHAT), not the implementation (HOW)**

> **One test at a time, baby steps**

> **Always see RED before GREEN**

> **Humans write tests, AI implements**

> **Fast feedback over comprehensive coverage**

---

## Why TDD Matters

TDD is about **eliminating fear**:
- Fear of breaking things
- Fear of making changes
- Fear of not knowing if it works

With TDD, you have:
1. **Specification before implementation** - Tests define requirements
2. **Rapid feedback** - Know immediately if something breaks
3. **Safety net** - Refactor fearlessly
4. **Living documentation** - Tests never get out of sync

**The payoff:** Clean code that works, with confidence to improve it continuously.
