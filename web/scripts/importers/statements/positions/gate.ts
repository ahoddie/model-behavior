// Which findings show on the Statements page without a person checking them first. Set from the eval (REPORT-positions.md).
export const AUTO_CONFIDENCE = 0.75;
export const statusFor = (f: { confidence: number; verified: boolean }) => (f.verified && f.confidence >= AUTO_CONFIDENCE ? "auto" : "pending");
