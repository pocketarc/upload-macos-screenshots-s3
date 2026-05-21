import { S3Client } from "bun";
import type { S3Config } from "./config.ts";

export interface UploadResult {
    success: boolean;
    url?: string;
    error?: string;
}

export async function uploadFileToS3(localPath: string, filename: string, config: S3Config): Promise<UploadResult> {
    const client = new S3Client({
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        endpoint: `https://${config.bucket}.s3.${config.region}.amazonaws.com`,
        virtualHostedStyle: true,
    });

    const contentType = filename.endsWith(".webp") ? "image/webp" : "image/png";

    try {
        await client.file(filename).write(Bun.file(localPath), { type: contentType });
        const url = `${config.baseUrl.replace(/\/$/, "")}/${filename}`;
        return { success: true, url };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
}
