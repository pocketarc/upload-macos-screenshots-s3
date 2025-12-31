import { stat } from "node:fs/promises";
import { PassThrough } from "node:stream";
import sharp from "sharp";

export interface CompressionStream {
    stream: PassThrough;
    originalSize: number;
    getCompressedSize: () => number | undefined;
}

export async function createCompressionStream(inputPath: string): Promise<CompressionStream> {
    const originalStat = await stat(inputPath);
    let compressedSize: number | undefined;

    const passThrough = new PassThrough();

    sharp(inputPath)
        .webp({ lossless: true, effort: 6 })
        .on("info", (info) => {
            compressedSize = info.size;
            console.log(`  [Sharp] format=${info.format}, size=${info.size} bytes`);
        })
        .pipe(passThrough);

    return {
        stream: passThrough,
        originalSize: originalStat.size,
        getCompressedSize: () => compressedSize,
    };
}
