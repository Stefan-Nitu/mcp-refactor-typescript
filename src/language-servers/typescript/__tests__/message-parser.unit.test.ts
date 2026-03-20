import { describe, expect, it } from 'vitest';
import { MessageParser } from '../message-parser.js';

function buildMessage(body: object): string {
  const json = JSON.stringify(body);
  return `Content-Length: ${json.length}\r\n\r\n${json}`;
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
    const body1 = { seq: 1, type: 'response', success: true, body: { first: true } };
    const body2 = { seq: 2, type: 'response', success: true, body: { second: true } };

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
    const messages = parser.feed(buildMessage(body1) + '\r\n' + buildMessage(body2));

    // Assert
    expect(messages).toEqual([body1, body2]);
  });

  it('should handle partial messages across multiple chunks', () => {
    // Arrange
    const parser = new MessageParser();
    const body = { seq: 1, type: 'response', success: true, body: { chunked: true } };
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
