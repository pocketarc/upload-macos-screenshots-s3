import { existsSync } from "node:fs";
import { rename } from "node:fs/promises";
import { basename, join } from "node:path";

export async function moveToTrash(filePath: string, trashPath: string): Promise<void> {
    const filename = basename(filePath);
    let destPath = join(trashPath, filename);

    // Handle conflicts by appending timestamp
    if (existsSync(destPath)) {
        const timestamp = Date.now();
        const ext = filename.includes(".") ? `.${filename.split(".").pop()}` : "";
        const base = filename.replace(ext, "");
        destPath = join(trashPath, `${base}-${timestamp}${ext}`);
    }

    try {
        await rename(filePath, destPath);
    } catch (error) {
        console.error("Failed to move to trash:", error);
    }
}
