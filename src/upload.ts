import { S3Client } from "bun";
import type { Readable } from "node:stream";

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
): Promise<UploadResult> {
    const client = new S3Client({
        accessKeyId,
        secretAccessKey,
        endpoint: `https://${bucket}.s3.${region}.amazonaws.com`,
        virtualHostedStyle: true,
    });

    const contentType = filename.endsWith(".webp") ? "image/webp" : "image/png";
    const file = client.file(filename);
    const writer = file.writer({ type: contentType });

    try {
        // Pump chunks from Node stream to Bun S3 writer
        for await (const chunk of stream) {
            writer.write(chunk);
        }
        await writer.end();

        const url = `${baseUrl.replace(/\/$/, "")}/${filename}`;
        return { success: true, url };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}
