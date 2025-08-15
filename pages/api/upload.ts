// pages/api/upload.ts
import type { NextApiRequest, NextApiResponse } from "next";
import formidable, { type Files, type File } from "formidable";
import * as fs from "node:fs";
import * as path from "node:path";

export const config = {
  api: {
    bodyParser: false, // Next must NOT parse; formidable will
  },
};

function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function pickFirstFile(files: Files): File | undefined {
  for (const key of Object.keys(files)) {
    const arr = (files as any)[key] as File[] | undefined;
    if (Array.isArray(arr) && arr.length > 0) return arr[0];
  }
  return undefined;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  try {
    const uploadDir = path.join(process.cwd(), "public", "uploads");
    ensureDir(uploadDir);

    const form = formidable({
      multiples: false,
      uploadDir,
      keepExtensions: true,
      maxFileSize: 200 * 1024 * 1024, // 200MB
      filename: (_name, _ext, part) => {
        // keep original extension, unique name
        const ext = path.extname(part.originalFilename || "") || ".bin";
        const base = Date.now() + "-" + Math.random().toString(36).slice(2);
        return `${base}${ext}`;
      },
    });

    const [fields, files] = await form.parse(req);
    const file = pickFirstFile(files);
    if (!file) return res.status(400).json({ ok: false, error: "no_file" });

    // Formidable v3 stores to uploadDir already; path is file.filepath
    const storedPath = file.filepath; // absolute path in /public/uploads
    const finalName = path.basename(storedPath);
    const url = "/uploads/" + finalName;

    return res.json({ ok: true, url });
  } catch (err: any) {
    console.error("UPLOAD_ERROR", err?.message || err);
    return res.status(500).json({ ok: false, error: "upload_failed" });
  }
}