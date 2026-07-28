import { logger } from '../../utils/logger.js';

export interface ParsedMessage {
  seq: number;
  type: string;
  command?: string;
  request_seq?: number;
  success?: boolean;
  body?: unknown;
  event?: string;
}

const HEADER_PREFIX = 'Content-Length: ';
const HEADER_PATTERN = /^Content-Length: (\d+)\r?\n\r?\n/;
/** Comfortably covers "Content-Length: <digits>\r\n\r\n" */
const MAX_HEADER_BYTES = 64;
/** Far above any real reply; past this the stream is not a frame at all */
const MAX_FRAME_BYTES = 128 * 1024 * 1024;

/**
 * tsserver sizes each frame in UTF-8 bytes, so the buffer has to stay bytes
 * until the body is complete - measuring a decoded string instead stalls
 * forever on any payload containing a multi-byte character.
 */
export class MessageParser {
  private buffer = Buffer.alloc(0);
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  private awaiting = 0;

  feed(data: Buffer | string): ParsedMessage[] {
    const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    this.pending.push(chunk);
    this.pendingBytes += chunk.length;

    // Joining costs a copy of everything buffered so far, so while a frame of
    // known size is still short, hold the chunks instead of rejoining per chunk
    if (this.awaiting > 0 && this.pendingBytes < this.awaiting) {
      return [];
    }

    this.buffer = Buffer.concat(
      [this.buffer, ...this.pending],
      this.buffer.length + this.pendingBytes,
    );
    this.pending = [];
    this.pendingBytes = 0;
    this.awaiting = 0;

    return this.drain();
  }

  private drain(): ParsedMessage[] {
    const messages: ParsedMessage[] = [];

    while (true) {
      const headerStart = this.buffer.indexOf(HEADER_PREFIX, 0, 'latin1');
      if (headerStart === -1) {
        break;
      }

      // latin1 maps one byte to one char, keeping these offsets in byte space
      const header = HEADER_PATTERN.exec(
        this.buffer.toString(
          'latin1',
          headerStart,
          headerStart + MAX_HEADER_BYTES,
        ),
      );

      if (!header) {
        // It may simply not have arrived yet; only give up on this header once
        // a full header's worth of bytes has landed and still will not parse
        if (this.buffer.length - headerStart < MAX_HEADER_BYTES) break;
        this.resyncPast(headerStart);
        continue;
      }

      const contentLength = parseInt(header[1], 10);
      if (contentLength > MAX_FRAME_BYTES) {
        logger.error(
          { contentLength },
          'Discarding implausible TSServer frame size',
        );
        this.resyncPast(headerStart);
        continue;
      }

      const headerEnd = headerStart + header[0].length;
      const messageEnd = headerEnd + contentLength;

      if (this.buffer.length < messageEnd) {
        this.awaiting = messageEnd - this.buffer.length;
        break;
      }

      const jsonBody = this.buffer.toString('utf8', headerEnd, messageEnd);
      this.keepFrom(messageEnd);

      try {
        messages.push(JSON.parse(jsonBody));
      } catch (error) {
        logger.error(
          { err: error, body: jsonBody },
          'Failed to parse TSServer message',
        );
      }
    }

    return messages;
  }

  /** Steps over a header that will never parse, so the next one can be found */
  private resyncPast(headerStart: number): void {
    this.keepFrom(headerStart + HEADER_PREFIX.length);
  }

  /**
   * Copied rather than sliced: a view keeps the whole allocation alive, so an
   * idle server would pin a buffer the size of its largest reply
   */
  private keepFrom(offset: number): void {
    this.buffer =
      offset >= this.buffer.length
        ? Buffer.alloc(0)
        : Buffer.from(this.buffer.subarray(offset));
  }
}
