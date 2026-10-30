import { randomUUID } from 'crypto';
import { createWriteStream } from 'fs';
import { mkdir, open, readdir, rename, rm, stat } from 'fs/promises';
import { join, resolve } from 'path';
import { Transform, type Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { BadRequestException, Injectable, PayloadTooLargeException } from '@nestjs/common';

// Generous for a 15s clip at the bitrate the web client records at.
const MAX_BYTES = 25 * 1024 * 1024;

const TYPES: Record<string, { ext: string; matches: (head: Buffer) => boolean }> = {
  'image/jpeg': { ext: 'jpg', matches: (head) => head.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) },
  'video/mp4': { ext: 'mp4', matches: (head) => head.subarray(4, 8).toString('latin1') === 'ftyp' },
  'video/webm': { ext: 'webm', matches: (head) => head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) },
};

// Photos and clips kids attach to a finished chore, kept on disk only until a parent reviews it.
@Injectable()
export class ProofsService {
  private readonly root = resolve(process.env.PROOFS_DIR || 'data/proofs');

  private dir(instanceId: string) {
    return join(this.root, instanceId);
  }

  path(instanceId: string, key: string) {
    return join(this.dir(instanceId), key);
  }

  async save(instanceId: string, userId: string, contentType: string | undefined, contentLength: number, body: Readable) {
    const type = TYPES[(contentType || '').split(';')[0].trim().toLowerCase()];
    if (!type) throw new BadRequestException('Only camera photos and videos can be attached');
    if (contentLength > MAX_BYTES) throw new PayloadTooLargeException('This video is too long');

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
    return stat(this.path(instanceId, key)).then((s) => s.isFile(), () => false);
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
