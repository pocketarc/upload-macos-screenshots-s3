import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export async function saveToLocalFolder(localPath: string, filename: string, destFolder: string): Promise<boolean> {
    try {
        await mkdir(destFolder, { recursive: true });
        await copyFile(localPath, join(destFolder, filename));
        return true;
    } catch (error) {
        console.error("Local archive error:", error);
        return false;
    }
}
