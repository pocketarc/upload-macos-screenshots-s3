import security from "eslint-plugin-security";
import tseslint from "typescript-eslint";

// biome-ignore lint/style/noDefaultExport: ESLint flat config requires a default export.
export default tseslint.config(
    ...tseslint.configs.strictTypeChecked,
    security.configs.recommended,
    {
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            // Extra rules not in strict-type-checked.
            "@typescript-eslint/strict-boolean-expressions": [
                "error",
                {
                    allowString: true,
                    allowNumber: true,
                    allowNullableObject: false,
                    allowNullableBoolean: false,
                    allowNullableString: false,
                    allowNullableNumber: false,
                    allowAny: false,
                },
            ],

            // Already handled by Biome. Disabled to avoid double-reporting.
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-unnecessary-condition": "off",
            "@typescript-eslint/no-floating-promises": "off",
            "@typescript-eslint/no-misused-promises": "off",
            "@typescript-eslint/await-thenable": "off",
            "@typescript-eslint/no-for-in-array": "off",

            // This is a file-handling daemon: every fs call takes a dynamic path,
            // so this rule is all noise and no signal here.
            "security/detect-non-literal-fs-filename": "off",
        },
    },
);
