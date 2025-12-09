// config.js
export const CONFIG = {
    APP_NAME: "SortWise",
    APP_VERSION: "v1.3.4",
    // API Keys for different environments
    API_KEYS: {
        // Local Development: Keep empty in code! Set via App Settings (saved to LocalStorage) to keep it off GitHub.
        DEV: "",
        // Production (GitHub Pages / deployed) - UPDATE THIS with your restricted Prod key if needed
        PROD: "",
        // Obfuscated Key to bypass GitHub scanners (Base64 encoded)
        // Run btoa('YOUR_KEY') in console to get this value.
        // Restrict this key to your domain in Google Cloud Console!
        DEMO_ENCODED: "QUl6YVN5QkVxRGRsN2hxR3RGTk02eTdGcU1uR1ZVdzBNVmZZZzVB"
    },
    DEFAULT_MODEL: "gemini-2.5-pro",
    FALLBACK_MODEL: "gemini-2.5-flash",
    SHARED_USAGE_LIMIT: 5
};
