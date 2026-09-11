export const MAX_PROOF_PHOTO_BYTES = 10 * 1024 * 1024;

const proofPhotoContentTypes = new Set([
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const objectPathPattern = /^\/objects\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isProofPhotoContentType(value: unknown): value is string {
  return typeof value === "string" && proofPhotoContentTypes.has(value.toLowerCase());
}

export function isProofPhotoSize(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= MAX_PROOF_PHOTO_BYTES;
}

export function isProofPhotoObjectPath(value: unknown): value is string {
  return typeof value === "string" && objectPathPattern.test(value);
}
