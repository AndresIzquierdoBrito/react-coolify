import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { createDatabase, type DatabaseContext } from "../db/index.js";
import { MediaService } from "./service.js";

describe("MediaService project gallery", () => {
  let db: DatabaseContext;
  let uploadsPath: string;
  let media: MediaService;

  beforeEach(() => {
    uploadsPath = fs.mkdtempSync(path.join(os.tmpdir(), "izbri-gallery-"));
    db = createDatabase(":memory:");
    db.sqlite.prepare(`INSERT INTO coolify_resources(id,resource_type,resource_uuid,name,synced_at) VALUES('resource-1','application','app-1','Example',?)`).run(new Date().toISOString());
    db.sqlite.prepare(`INSERT INTO projects(id,coolify_resource_id,slug,live_url,created_at,updated_at) VALUES('project-1','resource-1','example','https://example.com',?,?)`).run(new Date().toISOString(), new Date().toISOString());
    media = new MediaService(db, loadConfig({ NODE_ENV: "test", DATABASE_PATH: ":memory:", UPLOADS_PATH: uploadsPath }));
  });

  afterEach(() => { db.sqlite.close(); fs.rmSync(uploadsPath, { recursive: true, force: true }); });

  it("preserves a real animated-capable GIF and requires bilingual alt text", async () => {
    const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
    await expect(media.addGalleryImage("project-1", gif, "", "Alternativa")).rejects.toThrow("GALLERY_ALT_REQUIRED");
    const result = await media.addGalleryImage("project-1", gif, "Animated demo", "Demostración animada");
    expect(result).toMatchObject({ mimeType: "image/gif" });
    expect(result.src.endsWith(".gif")).toBe(true);
    const stored = db.sqlite.prepare(`SELECT file_path,mime_type,alt_en,alt_es FROM project_gallery WHERE id=?`).get(result.id) as Record<string, string>;
    expect(stored).toMatchObject({ mime_type: "image/gif", alt_en: "Animated demo", alt_es: "Demostración animada" });
    expect(fs.readFileSync(path.join(uploadsPath, stored.file_path))).toEqual(gif);
  });

  it("deletes both the gallery record and its persisted file", async () => {
    const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
    const result = await media.addGalleryImage("project-1", gif, "Demo", "Demostración");
    const file = path.join(uploadsPath, result.src.replace("/media/", ""));
    media.deleteGalleryImage("project-1", result.id);
    expect(db.sqlite.prepare(`SELECT id FROM project_gallery WHERE id=?`).get(result.id)).toBeUndefined();
    expect(fs.existsSync(file)).toBe(false);
  });
});
