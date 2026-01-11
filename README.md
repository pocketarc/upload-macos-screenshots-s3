# Screenshot Uploader

Automatically upload macOS screenshots to S3 and copy the URL to your clipboard.

The macOS screenshot tool is great, but getting that screenshot from my Desktop to a URL I can share is friction I wanted to eliminate.

This tool watches my Desktop for new screenshots, compresses them to WebP, uploads them to S3, and copies the URL to my clipboard. The whole process takes less than a second, and I never have to think about it.

## How it works

1. Take a screenshot (Cmd+Shift+4 or similar)
2. The original PNG is immediately copied to your clipboard (so you can paste it right away if needed)
3. After 1 second, the compressed WebP URL replaces the image in your clipboard
4. The original screenshot is moved to trash

The 1-second grace period exists because sometimes I just want to paste the image directly into a document, not share a URL. This gives me time to Cmd+V before the URL takes over.

## Output format

Screenshots are renamed from `Screenshot 2024-01-15 at 10.30.45.png` to `20240115-103045-a1b2.webp`, where the last 4 characters are random hex to avoid collisions.

## History

This started as a simple PHP script in 2013 (long before I stored it in a repo) that used `pngcrush` and the AWS CLI. It worked, but LaunchAgent folder watching has variable latency, and it required multiple external CLI tools.

The current TypeScript version runs as a LaunchAgent daemon, uses Sharp to convert to WebP (typically 70-80% smaller than crushed PNG), streams uploads directly to S3, and can even back up to SFTP as a redundancy measure.

## Setup

### Environment variables

Create a `.env` file:

```bash
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
S3_BUCKET=your-bucket
S3_REGION=us-east-1
BASE_URL=https://your-cdn.com/

SFTP_HOST=your-server.com
SFTP_USER=username
SFTP_KEY_PATH=/Users/you/.ssh/id_rsa
SFTP_PATH=/path/to/backup/
```

Update `com.pocketarc.screenshot-uploader.plist` with the correct path to the script.

Copy `com.pocketarc.screenshot-uploader.plist` to `~/Library/LaunchAgents/`. 

Load it:

```bash
launchctl load ~/Library/LaunchAgents/com.pocketarc.screenshot-uploader.plist
```

## Technical details

- **50ms polling loop** - Watches ~/Desktop for `Screenshot*.png` files
- **Streaming uploads** - Sharp compresses to WebP and streams directly to S3 while also writing to a temp file for SFTP backup
- **Unicode normalization** - macOS screenshot filenames contain fancy Unicode (narrow no-break spaces), which is normalized using `any-ascii`.
