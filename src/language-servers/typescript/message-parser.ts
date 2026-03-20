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

export class MessageParser {
  private buffer = '';

  feed(data: string): ParsedMessage[] {
    this.buffer += data;
    const messages: ParsedMessage[] = [];

    while (true) {
      const headerMatch = /Content-Length: (\d+)\r?\n\r?\n/.exec(this.buffer);
      if (!headerMatch) {
        break;
      }

      const contentLength = parseInt(headerMatch[1], 10);
      const headerEnd = headerMatch.index + headerMatch[0].length;
      const messageEnd = headerEnd + contentLength;

      if (this.buffer.length < messageEnd) {
        break;
      }

      const jsonBody = this.buffer.slice(headerEnd, messageEnd);
      this.buffer = this.buffer.slice(messageEnd);

      try {
        messages.push(JSON.parse(jsonBody));
      } catch (error) {
        logger.error({ err: error, body: jsonBody }, 'Failed to parse TSServer message');
      }
    }

    return messages;
  }
}
