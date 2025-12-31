import { S3Client } from "bun";

export interface UploadResult {
    success: boolean;
    url?: string;
    error?: string;
}

async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function uploadToS3(
    filePath: string,
    filename: string,
    bucket: string,
    region: string,
    baseUrl: string,
    accessKeyId: string,
    secretAccessKey: string,
    maxRetries = 3,
): Promise<UploadResult> {
    const client = new S3Client({
        accessKeyId,
        secretAccessKey,
        endpoint: `https://${bucket}.s3.${region}.amazonaws.com`,
        virtualHostedStyle: true,
    });

    const file = Bun.file(filePath);
    const contentType = filename.endsWith(".webp") ? "image/webp" : "image/png";

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await client.write(filename, file, {
                type: contentType,
            });

            const url = `${baseUrl.replace(/\/$/, "")}/${filename}`;
            return { success: true, url };
        } catch (error) {
            lastError = error as Error;
            console.error(`S3 upload attempt ${attempt}/${maxRetries} failed:`, error);

            if (attempt < maxRetries) {
                const delay = 2 ** (attempt - 1) * 1000; // 1s, 2s, 4s
                await sleep(delay);
            }
        }
    }

    return {
        success: false,
        error: lastError?.message || "Unknown upload error",
    };
}
