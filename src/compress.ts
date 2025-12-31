import { copyFile, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface CompressionResult {
    outputPath: string;
    filename: string;
    originalSize: number;
    compressedSize: number;
    elapsedMs: number;
    keptOriginal: boolean;
}

export async function compressToWebp(
    inputPath: string,
    baseName: string,
    cwebpPath: string,
): Promise<CompressionResult> {
    const tempDir = tmpdir();
    const webpFilename = `${baseName}.webp`;
    const pngFilename = `${baseName}.png`;
    const webpPath = join(tempDir, webpFilename);

    const startTime = performance.now();

    const proc = Bun.spawn([cwebpPath, "-lossless", "-m", "6", "-quiet", inputPath, "-o", webpPath], {
        stdout: "pipe",
        stderr: "pipe",
    });

    const exitCode = await proc.exited;
    const elapsedMs = Math.round(performance.now() - startTime);

    if (exitCode !== 0) {
        throw new Error(`cwebp failed with exit code ${exitCode}`);
    }

    const originalStat = await stat(inputPath);
    const webpStat = await stat(webpPath);

    const originalSize = originalStat.size;
    const compressedSize = webpStat.size;

    // If WebP is larger, keep the original PNG
    if (compressedSize >= originalSize) {
        await unlink(webpPath);
        const pngPath = join(tempDir, pngFilename);
        await copyFile(inputPath, pngPath);
        return {
            outputPath: pngPath,
            filename: pngFilename,
            originalSize,
            compressedSize: originalSize,
            elapsedMs,
            keptOriginal: true,
        };
    }

    return {
        outputPath: webpPath,
        filename: webpFilename,
        originalSize,
        compressedSize,
        elapsedMs,
        keptOriginal: false,
    };
}
