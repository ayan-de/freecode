// =============================================================================
// VectorStore - packed f32 embeddings + meta sidecar, with cosine top-k.
// Derived index (spec D1): safe to delete & rebuild from the markdown files.
// A memory is keyed by id (`type/name`); its content hash gates re-embedding
// (spec D2 content-hash cache). Vectors are stored L2-normalized so cosine
// similarity is a plain dot product.
// =============================================================================

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

const SCHEMA_VERSION = 1;
const EMB_FILE = "embeddings.bin";
const META_FILE = "meta.json";

interface MetaEntry {
  id: string;
  hash: string;
}

interface Meta {
  schemaVersion: number;
  modelId: string;
  // dims is read from the loaded model's vectors, never hard-coded (spec §6).
  dims: number;
  entries: MetaEntry[];
  // sha256 of embeddings.bin — binds the two files so a torn write that keeps
  // the same vector count (new vectors, stale meta, or vice versa) is caught.
  checksum: string;
}

function sha256(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

export interface ScoredId {
  id: string;
  score: number;
}

function atomicWrite(filePath: string, data: Buffer | string): void {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, filePath);
}

function normalize(vec: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
  const norm = Math.sqrt(sum) || 1;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / norm;
  return out;
}

export class VectorStore {
  private dir: string;
  private modelId: string;
  // Parallel arrays: rows[i] is the normalized vector for entries[i].
  private entries: MetaEntry[] = [];
  private rows: Float32Array[] = [];
  private dims = 0;

  constructor(graphDir: string, modelId: string) {
    this.dir = graphDir;
    this.modelId = modelId;
    this.load();
  }

  private load(): void {
    try {
      const meta: Meta = JSON.parse(
        fs.readFileSync(path.join(this.dir, META_FILE), "utf-8"),
      );
      // Corrupt / stale sidecar → drop it; caller rebuilds from files (D1).
      if (
        meta.schemaVersion !== SCHEMA_VERSION ||
        meta.modelId !== this.modelId ||
        !Number.isInteger(meta.dims) ||
        meta.dims <= 0
      ) {
        return;
      }
      const buf = fs.readFileSync(path.join(this.dir, EMB_FILE));
      const expected = meta.entries.length * meta.dims * 4;
      if (buf.byteLength !== expected) return; // torn write → treat as empty
      // Checksum binds the two files: catches a same-size torn write where the
      // vectors and metadata come from different generations.
      if (meta.checksum !== sha256(buf)) return;
      const flat = new Float32Array(
        buf.buffer,
        buf.byteOffset,
        buf.byteLength / 4,
      );
      this.dims = meta.dims;
      this.entries = meta.entries;
      this.rows = meta.entries.map((_, i) =>
        flat.slice(i * meta.dims, (i + 1) * meta.dims),
      );
    } catch {
      // Missing or unreadable sidecar → start empty.
    }
  }

  private persist(): void {
    fs.mkdirSync(this.dir, { recursive: true });
    const buf = Buffer.alloc(this.rows.length * this.dims * 4);
    for (let i = 0; i < this.rows.length; i++) {
      const row = this.rows[i];
      for (let j = 0; j < this.dims; j++) {
        buf.writeFloatLE(row[j], (i * this.dims + j) * 4);
      }
    }
    const meta: Meta = {
      schemaVersion: SCHEMA_VERSION,
      modelId: this.modelId,
      dims: this.dims,
      entries: this.entries,
      checksum: sha256(buf),
    };
    // Write vectors first, then meta: a crash in between leaves meta's checksum
    // pointing at the old vectors, so the mismatch is detected on load.
    atomicWrite(path.join(this.dir, EMB_FILE), buf);
    atomicWrite(path.join(this.dir, META_FILE), JSON.stringify(meta));
  }

  // Does this id already have a vector for this exact content hash?
  hasFresh(id: string, hash: string): boolean {
    const e = this.entries.find((x) => x.id === id);
    return !!e && e.hash === hash;
  }

  has(id: string): boolean {
    return this.entries.some((e) => e.id === id);
  }

  allIds(): Set<string> {
    return new Set(this.entries.map((e) => e.id));
  }

  size(): number {
    return this.entries.length;
  }

  getDims(): number {
    return this.dims;
  }

  // Normalized vectors with their ids — for clustering (Phase 3).
  all(): Array<{ id: string; vec: Float32Array }> {
    return this.entries.map((e, i) => ({ id: e.id, vec: this.rows[i] }));
  }

  // Stable digest of the current vector set (ids + content hashes). Lets the
  // service skip re-clustering when the embeddings haven't changed.
  fingerprint(): string {
    const parts = this.entries
      .map((e) => `${e.id}:${e.hash}`)
      .sort()
      .join("\n");
    return crypto.createHash("sha256").update(parts).digest("hex");
  }

  put(id: string, hash: string, vec: Float32Array): void {
    if (this.dims === 0) this.dims = vec.length;
    if (vec.length !== this.dims) {
      throw new Error(
        `vector dims ${vec.length} != store dims ${this.dims} (model mismatch)`,
      );
    }
    const norm = normalize(vec);
    const idx = this.entries.findIndex((x) => x.id === id);
    if (idx >= 0) {
      this.entries[idx] = { id, hash };
      this.rows[idx] = norm;
    } else {
      this.entries.push({ id, hash });
      this.rows.push(norm);
    }
    this.persist();
  }

  remove(id: string): void {
    const idx = this.entries.findIndex((x) => x.id === id);
    if (idx < 0) return;
    this.entries.splice(idx, 1);
    this.rows.splice(idx, 1);
    this.persist();
  }

  clear(): void {
    this.entries = [];
    this.rows = [];
    this.persist();
  }

  // Top-k by cosine similarity (dot product of normalized vectors).
  cosineTopK(query: Float32Array, k: number, threshold = 0): ScoredId[] {
    if (this.rows.length === 0) return [];
    const q = normalize(query);
    const scored: ScoredId[] = [];
    for (let i = 0; i < this.rows.length; i++) {
      const row = this.rows[i];
      let dot = 0;
      for (let j = 0; j < this.dims; j++) dot += q[j] * row[j];
      if (dot >= threshold) scored.push({ id: this.entries[i].id, score: dot });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }
}
