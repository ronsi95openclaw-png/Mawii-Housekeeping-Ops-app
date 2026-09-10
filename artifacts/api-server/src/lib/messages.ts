export type MessageChannel = "sms" | "whatsapp";
export type MessageAudience = "customer" | "employee";

export interface MessageIntent {
  channel?: MessageChannel;
  audience?: MessageAudience;
  recipient?: string;
  body: string;
}

/** Normalize legacy client/team payloads without implying provider delivery. */
export function normalizeMessageIntent(input: MessageIntent) {
  const legacyAudience = input.audience ?? (input.recipient === "team" ? "employee" : "customer");
  return {
    channel: input.channel ?? "sms",
    audience: legacyAudience,
    recipient: input.recipient ?? legacyAudience,
    body: input.body,
  };
}