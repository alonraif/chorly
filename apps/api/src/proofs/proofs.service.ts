import { randomUUID } from 'crypto';
import { createWriteStream } from 'fs';
import { mkdir, open, readdir, rename, rm, stat } from 'fs/promises';
import { join, resolve, sep } from 'path';
import { Transform, type Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { BadRequestException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';

// Generous for a 15s clip at the bitrate the web client records at.
const MAX_BYTES = 25 * 1024 * 1024;
// Everything one person has waiting for review, across chores, so uploads can't fill the disk.
const MAX_BYTES_PER_USER = 250 * 1024 * 1024;
// What save() names a file: the uploader's id, a random UUID and one of the TYPES extensions.
const KEY_TAIL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|mp4|webm)$/;
// Instance ids are cuids; anything else must never become a directory name.
const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/;

const TYPES: Record<string, { ext: string; matches: (head: Buffer) => boolean }> = {
  'image/jpeg': { ext: 'jpg', matches: (head) => head.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) },
  'video/mp4': { ext: 'mp4', matches: (head) => head.subarray(4, 8).toString('latin1') === 'ftyp' },
  'video/webm': { ext: 'webm', matches: (head) => head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) },
};

// Photos and clips kids attach to a finished chore, kept on disk only until a parent reviews it.
@Injectable()
export class ProofsService {
  private readonly root = resolve(process.env.PROOFS_DIR || 'data/proofs');

  // Whether `key` is a name save() could have given one of this user's uploads.
  isKeyFor(userId: string, key: string) {
    return SAFE_SEGMENT.test(userId) && key.startsWith(`${userId}-`) && KEY_TAIL.test(key.slice(userId.length + 1));
  }

  private dir(instanceId: string) {
    return this.inside(join(this.root, instanceId), instanceId);
  }

  path(instanceId: string, key: string) {
    return this.inside(join(this.dir(instanceId), key), key);
  }

  // A path built from request input has to stay under the proofs root.
  private inside(path: string, segment: string) {
    if (!SAFE_SEGMENT.test(segment.replace(/\.(jpg|mp4|webm)$/, '')) || !resolve(path).startsWith(this.root + sep)) {
      throw new NotFoundException('Proof not found');
    }
    return path;
  }

  private async bytesFor(userId: string) {
    const dirs = await readdir(this.root, { withFileTypes: true }).catch(() => []);
    let total = 0;
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const files = await readdir(join(this.root, dir.name)).catch(() => [] as string[]);
      for (const name of files) {
        if (!name.startsWith(`${userId}-`)) continue;
        total += await stat(join(this.root, dir.name, name)).then((s) => s.size, () => 0);
      }
    }
    return total;
  }

  async save(instanceId: string, userId: string, contentType: string | undefined, contentLength: number, body: Readable) {
    const type = TYPES[(contentType || '').split(';')[0].trim().toLowerCase()];
    if (!type) throw new BadRequestException('Only camera photos and videos can be attached');
    if (contentLength > MAX_BYTES) throw new PayloadTooLargeException('This video is too long');
    if ((await this.bytesFor(userId)) + Math.max(contentLength, 0) > MAX_BYTES_PER_USER) {
      throw new PayloadTooLargeException('Too many photos and clips are waiting for review');
    }

    const key = `${userId}-${randomUUID()}.${type.ext}`;
    const file = this.path(instanceId, key);
    const partial = `${file}.part`;
    await mkdir(this.dir(instanceId), { recursive: true });

    let received = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        if (received > MAX_BYTES) callback(new PayloadTooLargeException('This video is too long'));
        else callback(null, chunk);
      },
    });

    try {
      await pipeline(body, limit, createWriteStream(partial));
      const handle = await open(partial, 'r');
      const { buffer } = await handle.read(Buffer.alloc(12), 0, 12, 0);
      await handle.close();
      if (!type.matches(buffer)) throw new BadRequestException('Only camera photos and videos can be attached');
      // One proof per person: a retry replaces whatever an earlier attempt left behind.
      await this.removeForUser(instanceId, userId);
      await rename(partial, file);
    } catch (error) {
      await rm(partial, { force: true });
      throw error;
    }
    return key;
  }

  async exists(instanceId: string, key: string) {
    const path = (() => {
      try {
        return this.path(instanceId, key);
      } catch {
        return null;
      }
    })();
    return path ? stat(path).then((s) => s.isFile(), () => false) : false;
  }

  async removeForUser(instanceId: string, userId: string) {
    const files = await readdir(this.dir(instanceId)).catch(() => [] as string[]);
    await Promise.all(
      files
        .filter((name) => name.startsWith(`${userId}-`) && !name.endsWith('.part'))
        .map((name) => rm(this.path(instanceId, name), { force: true })),
    );
  }

  async removeForInstances(instanceIds: string[]) {
    await Promise.all(instanceIds.map((id) => rm(this.dir(id), { recursive: true, force: true })));
  }
}
