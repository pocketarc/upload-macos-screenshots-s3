import { stat } from "node:fs/promises";
import sharp from "sharp";

export interface CompressionResult {
    originalSize: number;
    compressedSize: number;
}

export async function compressToWebp(inputPath: string, outputPath: string): Promise<CompressionResult> {
    const originalStat = await stat(inputPath);
    const info = await sharp(inputPath).webp({ lossless: true, effort: 6 }).toFile(outputPath);
    return { originalSize: originalStat.size, compressedSize: info.size };
}
