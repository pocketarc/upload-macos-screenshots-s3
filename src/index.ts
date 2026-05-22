import { createHash } from "node:crypto";
import { readdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import anyAscii from "any-ascii";
import { backupToSftp } from "./backup.ts";
import { copyImageToClipboard, copyTextToClipboard } from "./clipboard.ts";
import { compressToWebp } from "./compress.ts";
import { type AppConfig, loadConfig } from "./config.ts";
import { saveToLocalFolder } from "./local.ts";
import { notify, notifyError, notifySuccess } from "./notify.ts";
import { moveToTrash } from "./trash.ts";
import { uploadFileToS3 } from "./upload.ts";

const POLL_INTERVAL_MS = 50;

function humanizeBytes(bytes: number): string {
    if (bytes < 1024) {
        return `${String(bytes)} B`;
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

    if (datePart === undefined || timePart === undefined) {
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

// Output name is `YYYYMMDD-HHMMSS-XXXX`. The suffix is a hash of the original
// filename, not random, so reprocessing the same screenshot (a failed backup
// retried on the next restart) produces the same name instead of a duplicate.
function generateFilename(date: Date, originalFilename: string): string {
    const suffix = createHash("sha1").update(originalFilename).digest("hex").slice(0, 4);
    const pad = (n: number): string => n.toString().padStart(2, "0");

    const datePart = `${String(date.getFullYear())}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
    const timePart = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;

    return `${datePart}-${timePart}-${suffix}`;
}

// Send the compressed WebP to every enabled destination. Returns the names of
// any that failed, plus the public URL if S3 produced one.
async function deliverToDestinations(
    tempPath: string,
    webpFilename: string,
    config: AppConfig,
): Promise<{ failures: string[]; s3Url: string | undefined }> {
    const failures: string[] = [];
    let s3Url: string | undefined;

    if (config.s3 !== null) {
        const result = await uploadFileToS3(tempPath, webpFilename, config.s3);
        if (result.success && result.url !== undefined) {
            s3Url = result.url;
            console.log(`Uploaded: ${s3Url}`);
        } else {
            failures.push("S3");
            console.error(`S3 upload failed: ${result.error ?? "unknown error"}`);
        }
    }

    if (config.sftp !== null) {
        const ok = await backupToSftp(tempPath, webpFilename, config.sftp);
        if (ok) {
            console.log(`SFTP backup: ${webpFilename} → ${config.sftp.host}:${config.sftp.path}`);
        } else {
            failures.push("SFTP");
        }
    }

    if (config.local !== null) {
        const ok = await saveToLocalFolder(tempPath, webpFilename, config.local.path);
        if (ok) {
            console.log(`Local archive: ${webpFilename} → ${config.local.path}`);
        } else {
            failures.push("local archive");
        }
    }

    return { failures, s3Url };
}

async function processScreenshot(filePath: string, filename: string, config: AppConfig): Promise<void> {
    console.log(`Processing: ${filename}`);
    const startTime = performance.now();

    // 1. Copy original to clipboard immediately (for instant paste)
    await copyImageToClipboard(filePath);
    const clipboardTime = Date.now();
    await notify(filename, "Processing…");

    // 2. Parse date from filename
    const date = parseScreenshotDate(filename);
    if (date === null) {
        await notifyError(`Could not parse date from: ${filename}`, "Parse Error");
        return;
    }

    const webpFilename = `${generateFilename(date, filename)}.webp`;
    const tempPath = join(tmpdir(), webpFilename);

    // 3. Compress to a WebP temp file (created once, read by every destination)
    let originalSize: number;
    let compressedSize: number;
    try {
        const result = await compressToWebp(filePath, tempPath);
        originalSize = result.originalSize;
        compressedSize = result.compressedSize;
    } catch (error) {
        await notifyError(`WebP conversion failed: ${String(error)}`, "Compression Error");
        return;
    }

    const savings = Math.round((1 - compressedSize / originalSize) * 100);
    console.log(
        `${webpFilename}: ${humanizeBytes(originalSize)} → ${humanizeBytes(compressedSize)} (${String(savings)}% saved)`,
    );

    try {
        // 4. Fan out to each enabled destination.
        const { failures, s3Url } = await deliverToDestinations(tempPath, webpFilename, config);

        // 5. Clipboard: only when S3 produced a URL, swap the WebP image + URL
        // in after the 1s grace period. With S3 off, the original PNG stays.
        if (s3Url !== undefined) {
            const clipboardRemaining = 1000 - (Date.now() - clipboardTime);
            if (clipboardRemaining > 0) {
                await Bun.sleep(clipboardRemaining);
            }
            await copyImageToClipboard(tempPath);
            await copyTextToClipboard(s3Url);
        }

        // 6. One terminal notification, and trash the original only when every
        // enabled destination succeeded. A failure leaves the screenshot on the
        // Desktop: both the warning and the retry queue (reprocessed on restart).
        const elapsedMs = Math.round(performance.now() - startTime);
        if (failures.length === 0) {
            await notifySuccess(webpFilename, originalSize, compressedSize);
            await moveToTrash(filePath, config.trashPath);
            console.log(`Done: ${filename} (${String(elapsedMs)}ms)`);
        } else {
            await notifyError(
                `${failures.join(" + ")} failed — ${filename} kept on Desktop, retries on restart`,
                "Backup Failed",
            );
        }
    } finally {
        // 7. Clean up the temp file regardless of outcome.
        await unlink(tempPath).catch(() => {});
    }
}

async function main(): Promise<void> {
    console.log("Screenshot uploader starting...");

    const config = loadConfig();
    console.log(`Watching: ${config.desktopPath}`);
    if (config.s3 !== null) {
        console.log(`S3: s3://${config.s3.bucket} → ${config.s3.baseUrl}`);
    }
    if (config.sftp !== null) {
        console.log(`SFTP: ${config.sftp.user}@${config.sftp.host}:${config.sftp.path}`);
    }
    if (config.local !== null) {
        console.log(`Local archive: ${config.local.path}`);
    }

    const processedFiles = new Set<string>();

    while (true) {
        try {
            const files = await readdir(config.desktopPath);

            for (const file of files) {
                if (file.startsWith("Screenshot") && file.endsWith(".png") && !processedFiles.has(file)) {
                    processedFiles.add(file);
                    const filePath = join(config.desktopPath, file);

                    processScreenshot(filePath, file, config).catch((error: unknown) => {
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

main().catch((error: unknown) => {
    console.error(error);
});
