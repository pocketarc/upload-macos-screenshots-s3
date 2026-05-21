import type { SftpConfig } from "./config.ts";

export async function backupToSftp(localPath: string, filename: string, config: SftpConfig): Promise<boolean> {
    const remoteDestination = `${config.user}@${config.host}:${config.path.replace(/\/$/, "")}/${filename}`;

    try {
        const proc = Bun.spawn(
            [
                "scp",
                "-i",
                config.keyPath,
                "-o",
                "StrictHostKeyChecking=accept-new",
                "-o",
                "BatchMode=yes",
                "-o",
                "ConnectTimeout=10",
                localPath,
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
            console.error(`SFTP backup failed (exit ${String(exitCode)}): ${stderr}`);
            return false;
        }

        return true;
    } catch (error) {
        console.error("SFTP backup error:", error);
        return false;
    }
}
