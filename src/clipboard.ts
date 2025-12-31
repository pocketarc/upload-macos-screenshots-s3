export async function copyImageToClipboard(filePath: string): Promise<void> {
    // Use osascript to copy image data to clipboard
    // This allows pasting the actual image while upload is in progress
    await Bun.spawn(["osascript", "-e", `set the clipboard to (read POSIX file "${filePath}" as «class PNGf»)`]).exited;
}

export async function copyTextToClipboard(text: string): Promise<void> {
    const proc = Bun.spawn(["pbcopy"], {
        stdin: "pipe",
    });
    proc.stdin.write(text);
    proc.stdin.end();
    await proc.exited;
}
