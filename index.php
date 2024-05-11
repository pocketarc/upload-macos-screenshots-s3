#!/usr/bin/env php
<?php

$log_file = dirname(__FILE__) . '/upload-screenshots.errors.txt';
ini_set('display_errors', 1);
ini_set('log_errors', 1);
ini_set('error_log', $log_file);
error_reporting(E_ALL);

$base_url = "https://i.28hours.org/";
$s3_bucket = "apro.screenshots";

# Sample screenshot name: Screen Shot 2017-05-13 at 13.47.23.png
# New sample screenshot name: Screenshot 2018-10-01 at 07.21.30.png

function notify($message, $title = "Started uploading!"): void
{
	shell_exec('osascript -e "display notification \"' . $message . '\" with title \"' . $title . '\" sound name \"Glass\""');
}

$folder = $_SERVER["HOME"] . "/Desktop/";
$file_to_clipboard = __DIR__ . "/file-to-clipboard";
$aws = "/opt/homebrew/bin/aws";
$pngcrush = "/opt/homebrew/bin/pngcrush";

$iterator = new DirectoryIterator($folder);
foreach ($iterator as $file) {
	/** @var SplFileInfo $file */
	if ($file->isFile() && str_starts_with($file->getFilename(), "Screenshot")) {
		shell_exec("$file_to_clipboard " . escapeshellarg($file->getRealpath()));
		notify($file->getFilename());
		$time = microtime(true);

		$parts = $file->getBasename("." . $file->getExtension());
		$parts = explode(" ", $parts);

		$random = bin2hex(random_bytes(2));
		$date = DateTime::createFromFormat('Y-m-d h.i.s A', "{$parts[1]} {$parts[3]}");

		$new_filename = $date->format('Ymd-His') . "-{$random}.png";
		$pngcrush = shell_exec("$pngcrush -reduce " . escapeshellarg($file->getRealPath()) . " " . escapeshellarg($folder . $new_filename) . " 2>&1");
		unlink($file->getRealPath());
		shell_exec("$file_to_clipboard " . escapeshellarg($folder . $new_filename));

		$s3_bucket = rtrim($s3_bucket, "/");
		$output = shell_exec("$aws s3 cp " . escapeshellarg($folder . $new_filename) . " " . escapeshellarg("s3://$s3_bucket/$new_filename") . " --acl public-read 2>&1");

		$elapsed = microtime(true) - $time;
		$remaining = (5 - $elapsed) * 1000 * 1000; # Seconds to milliseconds, to microseconds.
		if ($elapsed < 5) {
			usleep(round($remaining));
		}

		if (!str_contains($output, "upload failed:")) {
			echo $output;
			if (file_exists($folder . $new_filename)) {
				unlink($folder . $new_filename);
			}

			$url = rtrim($base_url, "/") . "/$new_filename";

			shell_exec("echo " . escapeshellarg($url) . " | tr -d '\\n' | pbcopy");
			notify($new_filename, "Image Uploaded!");
		} else {
			notify("The image has been kept in the desktop.", "Failed to upload.");
		}
	}
}

