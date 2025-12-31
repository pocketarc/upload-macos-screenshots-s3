import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import ini from "ini";
import { z } from "zod/v4";

const AwsCredentialsSchema = z.object({
    default: z
        .object({
            aws_access_key_id: z.string(),
            aws_secret_access_key: z.string(),
        })
        .optional(),
});

const AwsConfigSchema = z.object({
    default: z.object({ region: z.string() }).optional(),
});

function loadAwsCredentials() {
    try {
        const content = readFileSync(join(homedir(), ".aws", "credentials"), "utf-8");
        const result = AwsCredentialsSchema.safeParse(ini.parse(content));
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

function loadAwsConfig() {
    try {
        const content = readFileSync(join(homedir(), ".aws", "config"), "utf-8");
        const result = AwsConfigSchema.safeParse(ini.parse(content));
        if (!result.success) {
            return {};
        }
        return { region: result.data.default?.region };
    } catch {
        return {};
    }
}

const EnvSchema = z.object({
    S3_BUCKET: z.string(),
    S3_REGION: z.string().optional(),
    BASE_URL: z.string(),
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    SFTP_HOST: z.string(),
    SFTP_USER: z.string(),
    SFTP_KEY_PATH: z.string().optional(),
    SFTP_PATH: z.string(),
});

export function loadConfig() {
    const home = homedir();
    const awsCreds = loadAwsCredentials();
    const awsConfig = loadAwsConfig();

    const envResult = EnvSchema.safeParse(process.env);
    if (!envResult.success) {
        const missing = envResult.error.issues.map((i) => i.path.join(".")).join(", ");
        throw new Error(`Missing required config: ${missing}`);
    }
    const env = envResult.data;

    return {
        s3Bucket: env.S3_BUCKET,
        s3Region: env.S3_REGION ?? awsConfig.region ?? "us-east-1",
        baseUrl: env.BASE_URL,
        awsAccessKeyId:
            env.AWS_ACCESS_KEY_ID ??
            awsCreds.accessKeyId ??
            (() => {
                throw new Error("Missing AWS_ACCESS_KEY_ID");
            })(),
        awsSecretAccessKey:
            env.AWS_SECRET_ACCESS_KEY ??
            awsCreds.secretAccessKey ??
            (() => {
                throw new Error("Missing AWS_SECRET_ACCESS_KEY");
            })(),
        sftpHost: env.SFTP_HOST,
        sftpUser: env.SFTP_USER,
        sftpKeyPath: (env.SFTP_KEY_PATH ?? "~/.ssh/id_ed25519").replace("~", home),
        sftpPath: env.SFTP_PATH,
        desktopPath: join(home, "Desktop"),
        trashPath: join(home, ".Trash"),
    };
}
