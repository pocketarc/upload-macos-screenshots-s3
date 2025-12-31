import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlink } from "node:fs/promises";

export async function backupToSftp(
    s3Url: string,
    filename: string,
    host: string,
    user: string,
    keyPath: string,
    remotePath: string,
): Promise<void> {
    const tempPath = join(tmpdir(), `sftp-backup-${filename}`);
    const remoteDestination = `${user}@${host}:${remotePath.replace(/\/$/, "")}/${filename}`;

    try {
        const response = await fetch(s3Url);
        if (!response.ok) {
            throw new Error(`Failed to download from S3: ${response.status}`);
        }
        await Bun.write(tempPath, response);

        const proc = Bun.spawn(
            [
                "scp",
                "-i",
                keyPath,
                "-o",
                "StrictHostKeyChecking=accept-new",
                "-o",
                "BatchMode=yes",
                tempPath,
                remoteDestination,
            ],
            {
                stdout: "pipe",
                stderr: "pipe",
            },
        );

        const exitCode = await proc.exited;

        if (exitCode !== 0) {
            const stderr = await new Response(proc.stderr).text();
            console.error(`SFTP backup failed (exit ${exitCode}): ${stderr}`);
        }
    } catch (error) {
        console.error("SFTP backup error:", error);
    } finally {
        await unlink(tempPath);
    }
}
