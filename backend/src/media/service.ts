import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { AppConfig } from "../config.js";
import type { DatabaseContext } from "../db/index.js";

export class MediaService {
  constructor(private readonly db: DatabaseContext, private readonly config: AppConfig) {
    fs.mkdirSync(config.uploadsPath, { recursive: true });
  }

  async replaceCover(projectId: string, buffer: Buffer, altEn: string, altEs: string) {
    const project = this.db.sqlite.prepare(`SELECT id FROM projects WHERE id=?`).get(projectId);
    if (!project) throw new Error("PROJECT_NOT_FOUND");
    const image = sharp(buffer, { failOn: "error", limitInputPixels: 40_000_000 });
    const metadata = await image.metadata();
    if (!metadata.format || !["jpeg", "png", "webp", "avif"].includes(metadata.format)) throw new Error("UNSUPPORTED_IMAGE");
    const id = randomUUID();
    const originalName = `${id}.original.${metadata.format === "jpeg" ? "jpg" : metadata.format}`;
    const largeName = `${id}-1600.avif`;
    const smallName = `${id}-800.webp`;
    await Promise.all([
      fs.promises.writeFile(path.join(this.config.uploadsPath, originalName), buffer, { flag: "wx" }),
      sharp(buffer).rotate().resize({ width: 1600, height: 1000, fit: "cover", withoutEnlargement: true }).avif({ quality: 75 }).toFile(path.join(this.config.uploadsPath, largeName)),
      sharp(buffer).rotate().resize({ width: 800, height: 600, fit: "cover", withoutEnlargement: true }).webp({ quality: 80 }).toFile(path.join(this.config.uploadsPath, smallName)),
    ]);
    const old = this.db.sqlite.prepare(`SELECT original_path,large_path,small_path FROM media WHERE project_id=?`).get(projectId) as Record<string, string> | undefined;
    this.db.sqlite.prepare(`
      INSERT INTO media(id,project_id,original_path,large_path,small_path,alt_en,alt_es,created_at)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET id=excluded.id,original_path=excluded.original_path,
      large_path=excluded.large_path,small_path=excluded.small_path,alt_en=excluded.alt_en,alt_es=excluded.alt_es,created_at=excluded.created_at
    `).run(id, projectId, originalName, largeName, smallName, altEn.trim(), altEs.trim(), new Date().toISOString());
    if (old) for (const file of Object.values(old)) void fs.promises.unlink(path.join(this.config.uploadsPath, file)).catch(() => undefined);
    return { src: `/media/${largeName}`, srcSmall: `/media/${smallName}` };
  }

  async addGalleryImage(projectId: string, buffer: Buffer, altEn: string, altEs: string) {
    if (!this.db.sqlite.prepare(`SELECT id FROM projects WHERE id=?`).get(projectId)) throw new Error("PROJECT_NOT_FOUND");
    if (!altEn.trim() || !altEs.trim()) throw new Error("GALLERY_ALT_REQUIRED");
    const count = this.db.sqlite.prepare(`SELECT COUNT(*) AS count FROM project_gallery WHERE project_id=?`).get(projectId) as { count: number };
    if (count.count >= 12) throw new Error("GALLERY_LIMIT");

    const image = sharp(buffer, { animated: true, failOn: "error", limitInputPixels: 40_000_000 });
    const metadata = await image.metadata();
    if (!metadata.format || !["jpeg", "png", "webp", "avif", "gif"].includes(metadata.format)) throw new Error("UNSUPPORTED_IMAGE");
    const id = randomUUID();
    const isGif = metadata.format === "gif";
    const extension = isGif ? "gif" : "avif";
    const fileName = `${id}-gallery.${extension}`;
    const target = path.join(this.config.uploadsPath, fileName);
    if (isGif) await fs.promises.writeFile(target, buffer, { flag: "wx" });
    else await sharp(buffer).rotate().resize({ width: 1800, height: 1200, fit: "inside", withoutEnlargement: true }).avif({ quality: 78 }).toFile(target);
    const max = this.db.sqlite.prepare(`SELECT COALESCE(MAX(display_order), -1) AS value FROM project_gallery WHERE project_id=?`).get(projectId) as { value: number };
    const mimeType = isGif ? "image/gif" : "image/avif";
    this.db.sqlite.prepare(`INSERT INTO project_gallery(id,project_id,file_path,mime_type,alt_en,alt_es,display_order,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(id, projectId, fileName, mimeType, altEn.trim(), altEs.trim(), max.value + 1, new Date().toISOString());
    return { id, src: `/media/${fileName}`, mimeType };
  }

  deleteGalleryImage(projectId: string, imageId: string) {
    const image = this.db.sqlite.prepare(`SELECT file_path FROM project_gallery WHERE id=? AND project_id=?`).get(imageId, projectId) as { file_path: string } | undefined;
    if (!image) throw new Error("GALLERY_IMAGE_NOT_FOUND");
    this.db.sqlite.transaction(() => {
      this.db.sqlite.prepare(`DELETE FROM project_gallery WHERE id=? AND project_id=?`).run(imageId, projectId);
      const rows = this.db.sqlite.prepare(`SELECT id FROM project_gallery WHERE project_id=? ORDER BY display_order,created_at`).all(projectId) as { id: string }[];
      rows.forEach((row, index) => this.db.sqlite.prepare(`UPDATE project_gallery SET display_order=? WHERE id=?`).run(index, row.id));
    })();
    try { fs.unlinkSync(path.join(this.config.uploadsPath, path.basename(image.file_path))); } catch { /* Missing files are already deleted. */ }
  }

  reorderGallery(projectId: string, ids: string[]) {
    const current = this.db.sqlite.prepare(`SELECT id FROM project_gallery WHERE project_id=?`).all(projectId) as { id: string }[];
    const allowed = new Set(current.map((item) => item.id));
    if (ids.length !== current.length || ids.some((id) => !allowed.has(id)) || new Set(ids).size !== ids.length) throw new Error("INVALID_GALLERY_ORDER");
    this.db.sqlite.transaction(() => ids.forEach((id, index) => this.db.sqlite.prepare(`UPDATE project_gallery SET display_order=? WHERE id=? AND project_id=?`).run(index, id, projectId)))();
  }
}
