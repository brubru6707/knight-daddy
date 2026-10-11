// "Hey KD" wake phrase. Speech recognizers hear "KD" many ways ("Katie", "K.D.", "kay dee", "Casey"...), so the
// pattern accepts the common ones. afterWake returns what was said after the last wake phrase, or null if none.
const WAKE = /\b(?:hey|hi|hay|a|okay|ok)[\s,.!]*(?:k\.?\s?d\.?|kd|kdee|kay\s?dee|kaydee|katie|katy|kady|cady|kd's|casey)(?![a-z])[\s,.!?:]*/gi;

export function afterWake(text: string): string | null {
  let last: RegExpExecArray | null = null, m: RegExpExecArray | null;
  WAKE.lastIndex = 0;
  while ((m = WAKE.exec(text))) last = m;
  return last ? text.slice(last.index + last[0].length).trim() : null;
}

export const WAKE_HINTS = ["Hey KD", "KD", "Hey K D"]; // biases the recognizer toward the wake phrase
