import { describe, expect, it } from 'bun:test';
import { MessageParser } from '../message-parser.js';

/** Mirrors tsserver: Content-Length counts UTF-8 bytes, not UTF-16 code units */
function buildMessage(body: object): string {
  const json = JSON.stringify(body);
  return `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`;
}

describe('MessageParser', () => {
  it('should parse a single message', () => {
    // Arrange
    const parser = new MessageParser();
    const body = { seq: 1, type: 'response', success: true };

    // Act
    const messages = parser.feed(buildMessage(body));

    // Assert
    expect(messages).toEqual([body]);
  });

  it('should parse batched messages in a single chunk', () => {
    // Arrange
    const parser = new MessageParser();
    const body1 = {
      seq: 1,
      type: 'response',
      success: true,
      body: { first: true },
    };
    const body2 = {
      seq: 2,
      type: 'response',
      success: true,
      body: { second: true },
    };

    // Act
    const messages = parser.feed(buildMessage(body1) + buildMessage(body2));

    // Assert
    expect(messages).toEqual([body1, body2]);
  });

  it('should parse batched messages separated by trailing newlines', () => {
    // Arrange - this was the original bug: prefix bytes before Content-Length
    const parser = new MessageParser();
    const body1 = { seq: 1, type: 'response', request_seq: 1, success: true };
    const body2 = { seq: 2, type: 'response', request_seq: 2, success: true };

    // Act
    const messages = parser.feed(
      `${buildMessage(body1)}\r\n${buildMessage(body2)}`,
    );

    // Assert
    expect(messages).toEqual([body1, body2]);
  });

  it('should handle partial messages across multiple chunks', () => {
    // Arrange
    const parser = new MessageParser();
    const body = {
      seq: 1,
      type: 'response',
      success: true,
      body: { chunked: true },
    };
    const full = buildMessage(body);
    const mid = Math.floor(full.length / 2);

    // Act
    const first = parser.feed(full.slice(0, mid));
    const second = parser.feed(full.slice(mid));

    // Assert
    expect(first).toEqual([]);
    expect(second).toEqual([body]);
  });

  it('should handle three batched messages', () => {
    // Arrange
    const parser = new MessageParser();
    const bodies = [
      { seq: 1, type: 'response', success: true },
      { seq: 2, type: 'event', event: 'projectLoadingFinish' },
      { seq: 3, type: 'response', success: true, body: { data: 42 } },
    ];

    // Act
    const messages = parser.feed(bodies.map(buildMessage).join(''));

    // Assert
    expect(messages).toEqual(bodies);
  });

  it('should parse a message whose body contains non-ASCII characters', () => {
    // Arrange - tsserver sizes the header in bytes, so a multi-byte body makes
    // Content-Length exceed the JS string length of that same body
    const parser = new MessageParser();
    const body = {
      seq: 1,
      type: 'response',
      request_seq: 1,
      success: true,
      body: { edits: [{ newText: 'const label = "héllo — ✅";' }] },
    };

    // Act
    const messages = parser.feed(buildMessage(body));

    // Assert
    expect(messages).toEqual([body]);
  });

  it('should not stall a following message after a non-ASCII one', () => {
    // Arrange - a mis-sized slice desynchronises every later message too
    const parser = new MessageParser();
    const first = { seq: 1, type: 'response', body: { text: '✅ ünïcödé' } };
    const second = { seq: 2, type: 'response', body: { text: 'ascii' } };

    // Act
    const messages = parser.feed(buildMessage(first) + buildMessage(second));

    // Assert
    expect(messages).toEqual([first, second]);
  });

  it('should reassemble a non-ASCII message split mid-character', () => {
    // Arrange - stdout chunks land on byte boundaries, which can fall inside a
    // multi-byte character
    const parser = new MessageParser();
    const body = { seq: 1, type: 'response', body: { text: '→→→→→→' } };
    const bytes = Buffer.from(buildMessage(body), 'utf8');
    const splitInsideChar = bytes.length - 4;

    // Act
    const first = parser.feed(bytes.subarray(0, splitInsideChar));
    const second = parser.feed(bytes.subarray(splitInsideChar));

    // Assert
    expect(first).toEqual([]);
    expect(second).toEqual([body]);
  });

  it('should reassemble a message whose header is split across chunks', () => {
    // Arrange - a chunk boundary can land inside "Content-Length: " itself
    const parser = new MessageParser();
    const body = { seq: 1, type: 'response', body: { split: 'header' } };
    const full = buildMessage(body);

    // Act
    const first = parser.feed(full.slice(0, 10));
    const second = parser.feed(full.slice(10));

    // Assert
    expect(first).toEqual([]);
    expect(second).toEqual([body]);
  });

  it('should recover from a malformed header', () => {
    // Arrange - a header that will never parse must not block the stream
    const parser = new MessageParser();
    const valid = { seq: 1, type: 'response', success: true };

    // Act
    const messages = parser.feed(
      `Content-Length: not-a-number\r\n\r\n${buildMessage(valid)}`,
    );

    // Assert
    expect(messages).toEqual([valid]);
  });

  it('should recover from an impossible Content-Length', () => {
    // Arrange - a length that can never be satisfied would otherwise leave the
    // parser buffering every later byte forever
    const parser = new MessageParser();
    const valid = { seq: 1, type: 'response', success: true };

    // Act
    const messages = parser.feed(
      `Content-Length: 99999999999999999999\r\n\r\n${buildMessage(valid)}`,
    );

    // Assert
    expect(messages).toEqual([valid]);
  });

  it('should skip malformed JSON and continue parsing', () => {
    // Arrange
    const parser = new MessageParser();
    const garbage = 'Content-Length: 5\r\n\r\n{bad}';
    const valid = { seq: 1, type: 'response', success: true };

    // Act
    const messages = parser.feed(garbage + buildMessage(valid));

    // Assert
    expect(messages).toEqual([valid]);
  });
});
