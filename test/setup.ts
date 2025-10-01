import { vi } from 'vitest';

// Mock console.error to avoid cluttering test output
globalThis.console.error = vi.fn();