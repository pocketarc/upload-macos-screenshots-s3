import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import anyAscii from "any-ascii";
import { backupToSftp } from "./backup";
import { copyImageToClipboard, copyTextToClipboard } from "./clipboard";
import { type CompressionResult, compressToWebp } from "./compress";
import { loadConfig } from "./config";
import { notify, notifyError, notifySuccess } from "./notify";
import { moveToTrash } from "./trash";
import { uploadToS3 } from "./upload";

const POLL_INTERVAL_MS = 50;

function humanizeBytes(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Normalize any Unicode to ASCII equivalents
function normalizeFilename(filename: string): string {
    return anyAscii(filename);
}

// Parse screenshot filename into date components
// Formats:
// - 24-hour: "Screenshot 2018-10-01 at 07.21.30.png"
// - 12-hour: "Screenshot 2018-10-01 at 3.41.31 PM.png"
function parseScreenshotDate(filename: string): Date | null {
    const normalized = normalizeFilename(filename);
    const withoutExt = normalized.replace(/\.[^.]+$/, "");
    const parts = withoutExt.split(" ");

    if (parts.length < 4 || parts[0] !== "Screenshot") {
        return null;
    }

    const datePart = parts[1];
    const timePart = parts[3];
    const ampm = parts[4]; // "AM" or "PM" or undefined

    if (!datePart || !timePart) {
        return null;
    }

    const dateParts = datePart.split("-").map(Number);
    const timeParts = timePart.split(".").map(Number);

    if (dateParts.length !== 3 || timeParts.length !== 3) {
        return null;
    }

    const [year, month, day] = dateParts as [number, number, number];
    const [hour, minute, second] = timeParts as [number, number, number];

    if ([year, month, day, hour, minute, second].some((n) => Number.isNaN(n))) {
        return null;
    }

    let hour24 = hour;
    if (ampm === "PM" && hour !== 12) {
        hour24 = hour + 12;
    } else if (ampm === "AM" && hour === 12) {
        hour24 = 0;
    }

    const date = new Date(year, month - 1, day, hour24, minute, second);
    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date;
}

function generateFilename(date: Date): string {
    const random = Math.random().toString(16).slice(2, 6);
    const pad = (n: number) => n.toString().padStart(2, "0");

    const datePart = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
    const timePart = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;

    return `${datePart}-${timePart}-${random}`;
}

async function processScreenshot(filePath: string, filename: string, config: ReturnType<typeof loadConfig>) {
    console.log(`Processing: ${filename}`);

    // 1. Copy original to clipboard immediately (for instant paste)
    await copyImageToClipboard(filePath);
    await notify(filename, "Started uploading!");

    // 2. Parse date from filename
    const date = parseScreenshotDate(filename);
    if (!date) {
        await notifyError(`Could not parse date from: ${filename}`, "Parse Error");
        return;
    }

    const baseName = generateFilename(date);

    // 3. Compress to WebP
    let compression: CompressionResult;
    try {
        compression = await compressToWebp(filePath, baseName, config.cwebpPath);
        const savings = Math.round((1 - compression.compressedSize / compression.originalSize) * 100);
        console.log(`PNG:  ${humanizeBytes(compression.originalSize)}`);
        console.log(
            `WebP: ${humanizeBytes(compression.compressedSize)} (${savings}% saved, ${compression.elapsedMs}ms)`,
        );
    } catch (error) {
        await notifyError(`WebP conversion failed: ${error}`, "Compression Error");
        return;
    }

    // 4. Copy compressed file to clipboard
    await copyImageToClipboard(compression.outputPath);

    // 5. Upload to S3
    const uploadResult = await uploadToS3(
        compression.outputPath,
        compression.filename,
        config.s3Bucket,
        config.s3Region,
        config.baseUrl,
        config.awsAccessKeyId,
        config.awsSecretAccessKey,
    );

    if (!uploadResult.success || !uploadResult.url) {
        await notifyError(`S3 upload failed: ${uploadResult.error}`, "Upload Failed");
        await unlink(compression.outputPath).catch(() => {});
        return;
    }

    // 6. Copy URL to clipboard and notify with stats
    await copyTextToClipboard(uploadResult.url);
    const savings = Math.round((1 - compression.compressedSize / compression.originalSize) * 100);
    console.log(`Uploaded: ${uploadResult.url} (${savings}% saved)`);
    await notifySuccess(compression.filename, compression.originalSize, compression.compressedSize);

    // 7. Background: SFTP backup + trash (fire-and-forget)
    (async () => {
        try {
            // Backup compressed file to SFTP
            await backupToSftp(
                compression.outputPath,
                compression.filename,
                config.sftpHost,
                config.sftpUser,
                config.sftpKeyPath,
                config.sftpPath,
            );
            console.log(`SFTP backup: ${compression.filename} → ${config.sftpHost}:${config.sftpPath}`);

            // Move original to trash
            await moveToTrash(filePath, config.trashPath);
            console.log(`Trashed: ${filename}`);

            // Clean up temp file
            await unlink(compression.outputPath).catch(() => {});
            console.log(`Cleanup complete for ${filename}`);
        } catch (error) {
            console.error("Background cleanup error:", error);
        }
    })();
}

async function main() {
    console.log("Screenshot uploader starting...");

    const config = loadConfig();
    console.log(`Watching: ${config.desktopPath}`);
    console.log(`Uploading to: s3://${config.s3Bucket}`);
    console.log(`Backing up to: ${config.sftpUser}@${config.sftpHost}:${config.sftpPath}`);

    const processedFiles = new Set<string>();

    // Initial scan - mark existing files as processed
    const initialFiles = await readdir(config.desktopPath);
    for (const file of initialFiles) {
        if (file.startsWith("Screenshot") && file.endsWith(".png")) {
            processedFiles.add(file);
        }
    }
    console.log(`Found ${processedFiles.size} existing screenshots (will be ignored)`);

    // Polling loop
    while (true) {
        try {
            const files = await readdir(config.desktopPath);

            for (const file of files) {
                if (file.startsWith("Screenshot") && file.endsWith(".png") && !processedFiles.has(file)) {
                    processedFiles.add(file);
                    const filePath = join(config.desktopPath, file);

                    // Process in background to keep polling responsive
                    processScreenshot(filePath, file, config).catch((error) => {
                        console.error(`Error processing ${file}:`, error);
                    });
                }
            }
        } catch (error) {
            console.error("Polling error:", error);
        }

        await Bun.sleep(POLL_INTERVAL_MS);
    }
}

main().catch(console.error);
