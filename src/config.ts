// biome-ignore-all lint/style/noProcessEnv: this is the single module that reads process.env; the rest of the app imports typed config from here.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as ini from "ini";
import { z } from "zod/v4";

export interface S3Config {
    bucket: string;
    region: string;
    baseUrl: string;
    accessKeyId: string;
    secretAccessKey: string;
}

export interface SftpConfig {
    host: string;
    user: string;
    keyPath: string;
    path: string;
}

export interface LocalConfig {
    path: string;
}

export interface AppConfig {
    s3: S3Config | null;
    sftp: SftpConfig | null;
    local: LocalConfig | null;
    desktopPath: string;
    trashPath: string;
}

function loadAwsCredentials(): { accessKeyId?: string | undefined; secretAccessKey?: string | undefined } {
    const schema = z.object({
        default: z
            .object({
                aws_access_key_id: z.string(),
                aws_secret_access_key: z.string(),
            })
            .optional(),
    });
    try {
        const content = readFileSync(join(homedir(), ".aws", "credentials"), "utf-8");
        const result = schema.safeParse(ini.parse(content));
        if (!result.success) {
            return {};
        }
        return {
            accessKeyId: result.data.default?.aws_access_key_id,
            secretAccessKey: result.data.default?.aws_secret_access_key,
        };
    } catch {
        return {};
    }
}

function loadAwsConfig(): { region?: string | undefined } {
    const schema = z.object({
        default: z.object({ region: z.string() }).optional(),
    });
    try {
        const content = readFileSync(join(homedir(), ".aws", "config"), "utf-8");
        const result = schema.safeParse(ini.parse(content));
        if (!result.success) {
            return {};
        }
        return { region: result.data.default?.region };
    } catch {
        return {};
    }
}

// Throws a precise error when a destination is enabled but a field it needs is missing.
function requireField(value: string | undefined, name: string, context: string): string {
    if (value === undefined) {
        throw new Error(`Missing ${name} (required when ${context}).`);
    }
    return value;
}

export function loadConfig(): AppConfig {
    const home = homedir();

    const envSchema = z.object({
        S3_ENABLED: z.stringbool().optional().default(false),
        SFTP_ENABLED: z.stringbool().optional().default(false),
        LOCAL_ENABLED: z.stringbool().optional().default(false),
        S3_BUCKET: z.string().optional(),
        S3_REGION: z.string().optional(),
        BASE_URL: z.string().optional(),
        AWS_ACCESS_KEY_ID: z.string().optional(),
        AWS_SECRET_ACCESS_KEY: z.string().optional(),
        SFTP_HOST: z.string().optional(),
        SFTP_USER: z.string().optional(),
        SFTP_KEY_PATH: z.string().optional(),
        SFTP_PATH: z.string().optional(),
        LOCAL_PATH: z.string().optional(),
    });

    const envResult = envSchema.safeParse(process.env);
    if (!envResult.success) {
        const issues = envResult.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(", ");
        throw new Error(`Invalid config: ${issues}`);
    }
    const env = envResult.data;

    if (!env.S3_ENABLED && !env.SFTP_ENABLED && !env.LOCAL_ENABLED) {
        throw new Error(
            "No destination enabled. Set at least one of S3_ENABLED / SFTP_ENABLED / LOCAL_ENABLED to true.",
        );
    }

    let s3: S3Config | null = null;
    if (env.S3_ENABLED) {
        const awsCreds = loadAwsCredentials();
        const awsConfig = loadAwsConfig();
        s3 = {
            bucket: requireField(env.S3_BUCKET, "S3_BUCKET", "S3_ENABLED=true"),
            baseUrl: requireField(env.BASE_URL, "BASE_URL", "S3_ENABLED=true"),
            region: env.S3_REGION ?? awsConfig.region ?? "us-east-1",
            accessKeyId: requireField(
                env.AWS_ACCESS_KEY_ID ?? awsCreds.accessKeyId,
                "AWS_ACCESS_KEY_ID",
                "S3_ENABLED=true and no key found in ~/.aws/credentials",
            ),
            secretAccessKey: requireField(
                env.AWS_SECRET_ACCESS_KEY ?? awsCreds.secretAccessKey,
                "AWS_SECRET_ACCESS_KEY",
                "S3_ENABLED=true and no key found in ~/.aws/credentials",
            ),
        };
    }

    let sftp: SftpConfig | null = null;
    if (env.SFTP_ENABLED) {
        sftp = {
            host: requireField(env.SFTP_HOST, "SFTP_HOST", "SFTP_ENABLED=true"),
            user: requireField(env.SFTP_USER, "SFTP_USER", "SFTP_ENABLED=true"),
            path: requireField(env.SFTP_PATH, "SFTP_PATH", "SFTP_ENABLED=true"),
            keyPath: (env.SFTP_KEY_PATH ?? "~/.ssh/id_ed25519").replace("~", home),
        };
    }

    let local: LocalConfig | null = null;
    if (env.LOCAL_ENABLED) {
        local = {
            path: (env.LOCAL_PATH ?? join(home, "Pictures", "Screenshots")).replace("~", home),
        };
    }

    return {
        s3,
        sftp,
        local,
        desktopPath: join(home, "Desktop"),
        trashPath: join(home, ".Trash"),
    };
}
