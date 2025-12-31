export async function notify(message: string, title = "Screenshot Uploader"): Promise<void> {
    const escapedMessage = message.replace(/"/g, '\\"');
    const escapedTitle = title.replace(/"/g, '\\"');
    await Bun.spawn([
        "osascript",
        "-e",
        `display notification "${escapedMessage}" with title "${escapedTitle}" sound name "Glass"`,
    ]).exited;
}

export async function notifyError(message: string, title = "Upload Error"): Promise<void> {
    const escapedMessage = message.substring(0, 200).replace(/"/g, '\\"');
    const escapedTitle = title.replace(/"/g, '\\"');
    console.error(`[${title}] ${message}`);
    await Bun.spawn([
        "osascript",
        "-e",
        `display notification "${escapedMessage}" with title "${escapedTitle}" sound name "Basso"`,
    ]).exited;
}

export async function notifySuccess(filename: string, originalSize: number, compressedSize: number): Promise<void> {
    const savings = Math.round((1 - compressedSize / originalSize) * 100);
    const originalKb = Math.round(originalSize / 1024);
    const compressedKb = Math.round(compressedSize / 1024);
    const message = `${filename} (${originalKb}KB → ${compressedKb}KB, ${savings}% saved)`;
    await notify(message, "Image Uploaded!");
}
