# Screenshot Uploader

Watches my macOS Desktop for new screenshots, compresses them to WebP, and backs each one up to whichever destinations I've turned on.

The macOS screenshot tool is great, but a fresh screenshot just sits on my Desktop, uncompressed and not backed up. This watches the Desktop and deals with each one the moment it appears, so I never think about it.

## How it works

1. Take a screenshot (Cmd+Shift+4 or similar)
2. The original PNG is immediately copied to the clipboard, so I can paste it right away
3. It's compressed to WebP and sent to every enabled destination
4. If S3 is enabled, its public URL replaces the image on the clipboard after a 1-second grace period
5. Once every destination has the file, the original is moved to the trash

The 1-second grace period exists because sometimes I just want to paste the image straight into a document, not share a URL. It gives me time to Cmd+V before the URL takes over. With S3 off, the original PNG stays on the clipboard.

If a destination fails (the backup server is unreachable, say), the screenshot is left on the Desktop instead of trashed. That's the warning that something didn't go through, and it's the retry queue: the daemon reprocesses whatever is still on the Desktop every time it starts.

## Destinations

Each one is independent, switched on by an env flag. At least one must be enabled.

- S3: public upload that puts a shareable URL on the clipboard.
- SFTP: `scp` backup to a private server.
- Local archive: a copy in a folder on this Mac.

## Output format

Screenshots are renamed from `Screenshot 2024-01-15 at 10.30.45.png` to `20240115-103045-a1b2.webp`. The last four characters are a hash of the original filename, so reprocessing the same screenshot always produces the same name.

## History

This started as a simple PHP script in 2013 (long before I stored it in a repo) that used `pngcrush` and the AWS CLI. It worked, but LaunchAgent folder watching has variable latency, and it required multiple external CLI tools.

The current TypeScript version runs as a LaunchAgent daemon and uses Sharp to convert to WebP (typically 70-80% smaller than crushed PNG). It began as an S3-only uploader. S3 is now just one of three optional destinations, since I rarely need a public URL these days.

## Setup

### Environment variables

Create a `.env` file. Turn on the destinations you want and fill in their settings:

```bash
# Destinations (true/false). At least one must be true.
S3_ENABLED=false
SFTP_ENABLED=true
LOCAL_ENABLED=true

# S3 - needed when S3_ENABLED=true. Credentials are optional if ~/.aws/credentials exists.
S3_BUCKET=your-bucket
S3_REGION=us-east-1
BASE_URL=https://your-cdn.com/

# SFTP backup - needed when SFTP_ENABLED=true.
SFTP_HOST=your-server.com
SFTP_USER=username
SFTP_KEY_PATH=~/.ssh/id_ed25519
SFTP_PATH=/path/to/backup/

# Local archive - optional when LOCAL_ENABLED=true (defaults to ~/Pictures/Screenshots).
LOCAL_PATH=~/Pictures/Screenshots
```

Update `com.pocketarc.screenshot-uploader.plist` with the correct path to the script.

Copy `com.pocketarc.screenshot-uploader.plist` to `~/Library/LaunchAgents/`.

Load it:

```bash
launchctl load ~/Library/LaunchAgents/com.pocketarc.screenshot-uploader.plist
```

## Technical details

- **50ms polling loop** - Watches ~/Desktop for `Screenshot*.png` files
- **Compress then fan out** - Sharp compresses the PNG to a WebP temp file, which is sent to each enabled destination
- **Retry on restart** - A failed screenshot stays on the Desktop; the daemon processes everything on the Desktop at startup, so restarting it retries the backup
- **Unicode normalization** - macOS screenshot filenames contain fancy Unicode (narrow no-break spaces), which is normalized using `any-ascii`
