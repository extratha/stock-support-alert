/** LINE allows 5000 characters per text message; stay under it with a safety margin. */
export const LINE_TEXT_LIMIT = 4500;
/** LINE accepts at most 5 messages per reply/push request. */
export const LINE_MAX_MESSAGES = 5;

/**
 * Pack text blocks into as few messages as fit under `limit` characters, never
 * splitting a block. `header` opens the first message only.
 */
export function packBlocks(
  blocks: string[],
  { header = "", limit = LINE_TEXT_LIMIT, separator = "\n\n" }: { header?: string; limit?: number; separator?: string } = {},
): string[] {
  const messages: string[] = [];
  let current = header;
  for (const block of blocks) {
    const candidate = current ? `${current}${separator}${block}` : block;
    if (candidate.length <= limit || current === "") {
      current = candidate;
    } else {
      messages.push(current);
      current = block;
    }
  }
  if (current) messages.push(current);
  return messages;
}
