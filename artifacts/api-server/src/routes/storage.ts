import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { isProofPhotoContentType, isProofPhotoSize } from "../lib/proof-photos";
import { requireActiveEmployee } from "../middlewares/auth";

const router: IRouter = Router();

router.post("/storage/uploads/request-url", requireActiveEmployee, async (req, res): Promise<void> => {
  const { name, size, contentType } = req.body ?? {};
  if (
    typeof name !== "string" ||
    !name.trim() ||
    name.length > 255 ||
    !isProofPhotoSize(size) ||
    !isProofPhotoContentType(contentType)
  ) {
    res.status(400).json({ error: "A photo name, a supported image type, and an image no larger than 10 MB are required" });
    return;
  }
  const bucket = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  if (!bucket || !privateDir) {
    res.status(503).json({ error: "Object storage is not configured" });
    return;
  }
  const objectPath = `/objects/uploads/${randomUUID()}`;
  const response = await fetch("http://127.0.0.1:1106/object-storage/signed-object-url", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucket, object_name: `${privateDir.replace(/^\/?/, "").replace(/\/$/, "")}${objectPath.slice("/objects".length)}`,
      method: "PUT", expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    }),
  });
  if (!response.ok) {
    res.status(502).json({ error: "Unable to create upload URL" });
    return;
  }
  const payload = await response.json() as { signed_url?: string };
  if (!payload.signed_url) {
    res.status(502).json({ error: "Storage provider returned no upload URL" });
    return;
  }
  res.status(201).json({ uploadURL: payload.signed_url, objectPath, metadata: { name, size, contentType } });
});

export default router;
