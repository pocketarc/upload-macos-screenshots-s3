export async function backupToSftp(
    localPath: string,
    filename: string,
    host: string,
    user: string,
    keyPath: string,
    remotePath: string,
): Promise<void> {
    const remoteDestination = `${user}@${host}:${remotePath.replace(/\/$/, "")}/${filename}`;

    try {
        const proc = Bun.spawn(
            [
                "scp",
                "-i",
                keyPath,
                "-o",
                "StrictHostKeyChecking=accept-new",
                "-o",
                "BatchMode=yes",
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
            console.error(`SFTP backup failed (exit ${exitCode}): ${stderr}`);
        }
    } catch (error) {
        console.error("SFTP backup error:", error);
    }
}
