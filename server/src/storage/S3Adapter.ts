import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { StorageAdapter, validateStorageKey, getPrefixedStoragePath } from './StorageAdapter';

export class S3Adapter implements StorageAdapter {
  private client: S3Client;
  private bucket: string;

  constructor() {
    this.bucket = env.S3_BUCKET;
    this.client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY,
        secretAccessKey: env.S3_SECRET_KEY,
      },
      forcePathStyle: true, // Required for MinIO
    });
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      logger.info(`Storage bucket "${this.bucket}" verified.`);
    } catch (err: any) {
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404 || err.name === 'NoSuchBucket') {
        logger.info(`Bucket "${this.bucket}" does not exist. Creating private bucket...`);
        await this.client.send(
          new CreateBucketCommand({
            Bucket: this.bucket,
            ACL: 'private', // Explicitly private
          })
        );
        logger.info(`Bucket "${this.bucket}" created successfully with private ACL.`);
      } else {
        logger.error({ err }, `Failed to verify or create bucket "${this.bucket}"`);
        throw err;
      }
    }
  }

  async putObject(key: string, data: Buffer, contentType = 'application/octet-stream'): Promise<void> {
    const safePath = getPrefixedStoragePath(key);
    logger.debug(`Uploading object to S3 at "${safePath}" (${data.length} bytes)`);

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: safePath,
        Body: data,
        ContentType: contentType,
      })
    );
  }

  async getObject(key: string): Promise<Buffer> {
    const safePath = getPrefixedStoragePath(key);
    logger.debug(`Retrieving object from S3 at "${safePath}"`);

    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: safePath,
      })
    );

    if (!response.Body) {
      throw new Error(`S3 returned empty body for object key "${key}"`);
    }

    if (response.Body instanceof Readable) {
      const chunks: Buffer[] = [];
      for await (const chunk of response.Body) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    } else {
      // Body may be a Uint8Array or Blob in some environments
      const bytes = await response.Body.transformToByteArray();
      return Buffer.from(bytes);
    }
  }

  async deleteObject(key: string): Promise<void> {
    const safePath = getPrefixedStoragePath(key);
    logger.debug(`Deleting object from S3 at "${safePath}"`);

    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: safePath,
      })
    );
  }
}

export const storage: StorageAdapter = new S3Adapter();
