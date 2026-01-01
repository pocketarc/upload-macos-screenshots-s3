import type { Readable } from "node:stream";
import { S3Client } from "bun";

export interface UploadResult {
    success: boolean;
    url?: string;
    error?: string;
}

export async function uploadStreamToS3(
    stream: Readable,
    filename: string,
    bucket: string,
    region: string,
    baseUrl: string,
    accessKeyId: string,
    secretAccessKey: string,
    localPath?: string,
): Promise<UploadResult> {
    const client = new S3Client({
        accessKeyId,
        secretAccessKey,
        endpoint: `https://${bucket}.s3.${region}.amazonaws.com`,
        virtualHostedStyle: true,
    });

    const contentType = filename.endsWith(".webp") ? "image/webp" : "image/png";
    const s3Writer = client.file(filename).writer({ type: contentType });
    const localWriter = localPath ? Bun.file(localPath).writer() : null;

    try {
        // Pump chunks to both S3 and local file
        for await (const chunk of stream) {
            s3Writer.write(chunk);
            localWriter?.write(chunk);
        }
        await s3Writer.end();
        if (localWriter) {
            await localWriter.end();
        }

        const url = `${baseUrl.replace(/\/$/, "")}/${filename}`;
        return { success: true, url };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}
