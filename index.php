#!/usr/bin/env php
<?php

$log_file = dirname(__FILE__) . '/upload-screenshots.errors.txt';
ini_set('display_errors', 1);
ini_set('log_errors', 1);
ini_set('error_log', $log_file);
error_reporting(E_ALL);

$base_url = "https://i.28hours.org/";
$s3_bucket = "i28hours";

# Sample screenshot names:
# Screenshot 2018-10-01 at 07.21.30.png (24-hour, UK locale)
# Screenshot 2018-10-01 at 3.41.31 PM.png (12-hour, US locale)

function logMessage(string $message): void
{
	$timestamp = date('Y-m-d H:i:s');
	$line = "[$timestamp] $message";
	echo $line . PHP_EOL;
	error_log($message);
}

function notify($message, $title = "Started uploading!"): void
{
	shell_exec('osascript -e "display notification \"' . $message . '\" with title \"' . $title . '\" sound name \"Glass\""');
}

function notifyError($message, $title = "Upload Error"): void
{
	$message = substr(str_replace('"', '\\"', $message), 0, 200);
	shell_exec('osascript -e "display notification \"' . $message . '\" with title \"' . $title . '\" sound name \"Basso\""');
	logMessage("[$title] $message");
}

function execWithExitCode(string $command, ?int &$exitCode): string
{
	$output = [];
	exec($command . ' 2>&1', $output, $exitCode);
	return implode("\n", $output);
}

$folder = $_SERVER["HOME"] . "/Desktop/";
$file_to_clipboard = __DIR__ . "/file-to-clipboard";
$aws = "/opt/homebrew/bin/aws";
$cwebp_bin = "/opt/homebrew/bin/cwebp";

$temp_dir = sys_get_temp_dir() . '/screenshot-upload-' . getmypid();
if (!is_dir($temp_dir) && !mkdir($temp_dir, 0700, true)) {
	notifyError("Failed to create temp directory", "Setup Error");
	exit(1);
}

register_shutdown_function(function() use ($temp_dir) {
	if (is_dir($temp_dir)) {
		array_map('unlink', glob("$temp_dir/*"));
		@rmdir($temp_dir);
	}
});

$iterator = new DirectoryIterator($folder);
foreach ($iterator as $file) {
	/** @var SplFileInfo $file */
	if ($file->isFile() && str_starts_with($file->getFilename(), "Screenshot")) {
		$original_file = $file->getRealPath();
		shell_exec("$file_to_clipboard " . escapeshellarg($original_file));
		notify($file->getFilename());
		$time = microtime(true);

		$parts = $file->getBasename("." . $file->getExtension());
		$parts = explode(" ", $parts);

		$random = bin2hex(random_bytes(2));
		if (isset($parts[4])) {
			// 12-hour format with AM/PM: "Screenshot 2018-10-01 at 3.41.31 PM"
			$date = DateTime::createFromFormat('Y-m-d g.i.s A', "{$parts[1]} {$parts[3]} {$parts[4]}");
		} else {
			// 24-hour format: "Screenshot 2018-10-01 at 07.21.30"
			$date = DateTime::createFromFormat('Y-m-d H.i.s', "{$parts[1]} {$parts[3]}");
		}
		if ($date === false) {
			notifyError("Could not parse date from: {$file->getFilename()}", "Parse Error");
			continue;
		}

		$base_name = $date->format('Ymd-His') . "-{$random}";
		$temp_file = "$temp_dir/$base_name.webp";

		// Compress with lossless webp
		$start_time = microtime(true);
		$convert_output = execWithExitCode(
			"$cwebp_bin -lossless -quiet " . escapeshellarg($original_file) . " -o " . escapeshellarg($temp_file),
			$convert_exit
		);
		$elapsed_ms = round((microtime(true) - $start_time) * 1000);

		if ($convert_exit !== 0 || !file_exists($temp_file)) {
			notifyError("WebP conversion failed", "Compression Error");
			continue;
		}

		$original_size = filesize($original_file);
		$compressed_size = filesize($temp_file);

		// Use original PNG if webp is larger
		if ($compressed_size >= $original_size) {
			unlink($temp_file);
			$new_filename = "$base_name.png";
			$temp_file = "$temp_dir/$new_filename";
			copy($original_file, $temp_file);
			logMessage("Kept PNG ({$original_size} bytes, webp was larger) - {$elapsed_ms}ms");
		} else {
			$new_filename = "$base_name.webp";
			$savings = round((1 - $compressed_size / $original_size) * 100);
			logMessage("WebP: {$compressed_size} bytes ({$savings}% savings) - {$elapsed_ms}ms");
		}

		shell_exec("$file_to_clipboard " . escapeshellarg($temp_file));

		// Upload to S3
		$s3_bucket_clean = rtrim($s3_bucket, "/");
		$aws_output = execWithExitCode(
			"$aws s3 cp " . escapeshellarg($temp_file) . " " . escapeshellarg("s3://$s3_bucket_clean/$new_filename"),
			$aws_exit
		);

		$elapsed = microtime(true) - $time;
		$remaining = (5 - $elapsed) * 1000 * 1000; # Seconds to milliseconds, to microseconds.
		if ($elapsed < 5) {
			usleep(round($remaining));
		}

		if ($aws_exit === 0) {
			// Success: safe to delete original file now
			if (!unlink($original_file)) {
				notifyError("Failed to delete original (upload succeeded)", "Cleanup Warning");
			}
			if (file_exists($temp_file)) {
				unlink($temp_file);
			}

			$url = rtrim($base_url, "/") . "/$new_filename";
			shell_exec("echo " . escapeshellarg($url) . " | tr -d '\\n' | pbcopy");
			notify($new_filename, "Image Uploaded!");
		} else {
			// Failure: keep original, clean up temp
			if (file_exists($temp_file)) {
				unlink($temp_file);
			}
			notifyError("S3 upload failed (exit $aws_exit): " . substr($aws_output, 0, 100), "Upload Failed");
		}
	}
}

