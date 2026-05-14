import * as fs from 'fs';
import * as path from 'path';
import { ArtifactRecord } from './types';

export class ArtifactStore {
  readonly compiledDir: string;
  readonly artifactIndexPath: string;

  constructor(compiledDir: string, artifactIndexPath: string) {
    this.compiledDir = path.resolve(compiledDir);
    this.artifactIndexPath = path.resolve(artifactIndexPath);
  }

  readIndex(): ArtifactRecord[] {
    if (!fs.existsSync(this.artifactIndexPath)) {
      return [];
    }
    return JSON.parse(fs.readFileSync(this.artifactIndexPath, 'utf-8')) as ArtifactRecord[];
  }

  writeIndex(records: ArtifactRecord[]): void {
    this.ensureParentDir(this.artifactIndexPath);
    this.writeTextAtomic(this.artifactIndexPath, `${JSON.stringify(records, null, 2)}\n`);
  }

  readPayload(filePath: string): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  }

  writePayload(filePath: string, payload: unknown): void {
    this.writeJsonAtomic(filePath, payload);
  }

  writeText(filePath: string, contents: string): void {
    this.writeTextAtomic(filePath, contents);
  }

  buildArtifactId(kind: ArtifactRecord['kind']): string {
    return `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  exists(filePath: string): boolean {
    return fs.existsSync(filePath);
  }

  remove(filePath: string): void {
    fs.unlinkSync(filePath);
  }

  ensureCompiledDir(): void {
    fs.mkdirSync(this.compiledDir, { recursive: true });
  }

  private writeJsonAtomic(filePath: string, payload: unknown): void {
    this.writeTextAtomic(filePath, `${JSON.stringify(payload, null, 2)}\n`);
  }

  private writeTextAtomic(filePath: string, contents: string): void {
    this.ensureParentDir(filePath);
    const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    fs.writeFileSync(tempPath, contents);
    fs.renameSync(tempPath, filePath);
  }

  private ensureParentDir(filePath: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }
}
