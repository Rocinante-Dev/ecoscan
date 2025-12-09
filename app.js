import { GoogleGenerativeAI } from "@google/generative-ai";
import { CONFIG } from "./config.js";
import { checkAndShowChangelog } from "./changelog.js";

console.log(`App.js module loaded. Version: ${CONFIG.APP_VERSION}`);

// State
const state = {
    apiKey: localStorage.getItem('gemini_api_key') || getEnvironmentApiKey() || '',
    model: localStorage.getItem('gemini_model') || CONFIG.DEFAULT_MODEL,
    currentView: 'view-camera',
    stream: null,
    get isDemoMode() {
        // Demo mode if no local key IS saved AND we are falling back to the default config key
        const defaultKey = getEnvironmentApiKey();
        return !localStorage.getItem('gemini_api_key') && this.apiKey === defaultKey && !!defaultKey;
    }
};

function getEnvironmentApiKey() {
    const hostname = window.location.hostname;
    // Simple check: localhost, 127.0.0.1, or empty (file://) is development
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '') {
        console.log("Environment: Development");
        return CONFIG.API_KEYS.DEV;
    }
    console.log("Environment: Production");

    // Check for obfuscated demo key first
    if (CONFIG.API_KEYS.DEMO_ENCODED) {
        try {
            return atob(CONFIG.API_KEYS.DEMO_ENCODED);
        } catch (e) {
            console.error("Failed to decode demo key");
        }
    }

    return CONFIG.API_KEYS.PROD;
}

// DOM Elements
let views = {};
let elements = {};


// Navigation
function switchView(viewName) {
    console.log(`Switching to view: ${viewName}`);
    Object.values(views).forEach(view => {
        if (view) view.classList.remove('active');
    });
    if (views[viewName.replace('view-', '')]) {
        views[viewName.replace('view-', '')].classList.add('active');
        state.currentView = viewName;

        if (viewName === 'view-camera') {
            startCamera();
        } else {
            stopCamera();
        }

        updateUIState();
    } else {
        console.error(`View not found: ${viewName}`);
    }
}

// Camera Logic
async function startCamera() {
    console.log("Attempting to start camera...");
    try {
        if (state.stream) return;

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error("Camera API not supported");
        }

        const constraints = {
            video: {
                facingMode: 'environment',
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }
        };

        state.stream = await navigator.mediaDevices.getUserMedia(constraints);
        elements.video.srcObject = state.stream;
    } catch (err) {
        console.error("Error accessing camera:", err);
        alert(`Camera Error: ${err.message}`);
    }
}

function stopCamera() {
    if (state.stream) {
        state.stream.getTracks().forEach(track => track.stop());
        state.stream = null;
    }
}

function captureImage() {
    const context = elements.canvas.getContext('2d');
    elements.canvas.width = elements.video.videoWidth;
    elements.canvas.height = elements.video.videoHeight;
    context.drawImage(elements.video, 0, 0, elements.canvas.width, elements.canvas.height);
    const imageDataUrl = elements.canvas.toDataURL('image/jpeg', 0.8);
    elements.capturedImage.src = imageDataUrl;
    return imageDataUrl;
}

// Location Logic
// Location Logic
let hasPromptedForManualLocation = false;

async function getLocation() {
    const statusEl = document.getElementById('location-status');
    const updateStatus = (msg) => { if (statusEl) statusEl.textContent = msg; };

    // 1. Check Manual Override first
    const manualLoc = localStorage.getItem('manual_location');
    if (manualLoc && manualLoc.trim() !== "") {
        updateStatus("📍 Manual Override");
        return `Manual Override: ${manualLoc}`;
    }

    updateStatus("🛰️ Acquiring GPS...");

    // 2. High-Accuracy GPS Fallback
    return new Promise((resolve) => {
        if (!navigator.geolocation) {
            updateStatus("❌ GPS Unsupported");
            resolve("Location not supported");
            return;
        }

        const handleGpsError = (error) => {
            console.warn("GPS Error:", error);
            updateStatus("⚠️ GPS Failed");

            // Prompt for manual location if we haven't already and there is no manual location set
            if (!localStorage.getItem('manual_location') && !hasPromptedForManualLocation) {
                hasPromptedForManualLocation = true;
                setTimeout(() => {
                    const proceed = confirm("GPS location could not be detected. Would you like to enter your city manually to ensure accurate recycling rules?");
                    if (proceed) {
                        switchView('view-settings');
                        if (elements.locationInput) elements.locationInput.focus();
                    }
                }, 500);
            }
            resolve("Unknown Location");
        };

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const acc = Math.round(position.coords.accuracy);
                updateStatus(`📍 GPS (±${acc}m)`);
                resolve(`${position.coords.latitude}, ${position.coords.longitude} (Accuracy: ${acc}m)`);
            },
            handleGpsError,
            {
                enableHighAccuracy: true,
                timeout: 8000,
                maximumAge: 0
            }
        );
    });
}

// Gemini Logic
async function fetchAvailableModels() {
    if (!state.apiKey) return;
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${state.apiKey}`);
        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
        const data = await response.json();

        if (data.models && elements.modelSelect) {
            const contentModels = data.models.filter(m =>
                m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent")
            );

            contentModels.sort((a, b) => {
                const aName = a.displayName || a.name;
                const bName = b.displayName || b.name;
                if (aName.includes('Pro') && !bName.includes('Pro')) return -1;
                if (!aName.includes('Pro') && bName.includes('Pro')) return 1;
                return 0;
            });

            elements.modelSelect.innerHTML = contentModels.map(m => {
                const id = m.name.replace('models/', '');
                const name = m.displayName || id;
                return `<option value="${id}" ${state.model === id ? 'selected' : ''}>${name} (${id})</option>`;
            }).join('');
        }
    } catch (e) {
        console.error("Failed to fetch models:", e);
    }
}

async function analyzeItem(input) {
    if (!state.apiKey) {
        // Show "Get Started" / Missing Key Modal
        if (elements.limitModalTitle) elements.limitModalTitle.textContent = "✨ Get Started";
        if (elements.limitModalMsg) elements.limitModalMsg.textContent = "To start recycling with AI, you need a free Google Gemini API Key. It takes about 30 seconds to get one!";
        elements.limitModal.classList.add('active');
        return;
    }

    // Check Usage Limit for Free Users
    const hasUserKey = !!localStorage.getItem('gemini_api_key');
    if (!hasUserKey) {
        let usageCount = parseInt(localStorage.getItem('free_usage_count') || '0');
        if (usageCount >= CONFIG.SHARED_USAGE_LIMIT) {
            document.getElementById('limit-modal').classList.add('active');
            return;
        }
        localStorage.setItem('free_usage_count', (usageCount + 1).toString());
        console.log(`Free usage: ${usageCount + 1}/${CONFIG.SHARED_USAGE_LIMIT}`);
    }

    elements.loadingIndicator.classList.remove('hidden');
    elements.analysisContent.innerHTML = '';
    const dateStr = new Date().toLocaleDateString();

    try {
        const genAI = new GoogleGenerativeAI(state.apiKey);
        let model = genAI.getGenerativeModel({ model: state.model });
        const location = await getLocation();
        let prompt;
        let contentParts;

        if (input.image) {
            const base64Data = input.image.split(',')[1];
            prompt = `
            Identify this item and provide recycling instructions for location coordinates: ${location}.
            Current Date: ${dateStr}.

            STRICT RESPONSE GUIDELINES:
            1. LOCATION: Deduce specific City/Municipality.
            2. TEMPORAL AWARENESS: Be aware of current date (${dateStr}). KEY FACT: Ottawa's transition to Circular Materials is JAN 1, 2026 (NOT 2025).
            3. ACCURACY: You MUST cross-reference the known bin rules below if the location matches.
               - OTTAWA RULES:
                 * BLUE BIN: Glass, Metal, Plastics, Soft Plastics (Clean).
                 * BLACK BIN: Paper, Cardboard.
                 * GREEN BIN: Organics (Food, Yard Waste).
                 * GARBAGE: Styrofoam, composite materials.
               - TORONTO RULES:
                 * BLUE BIN: All Recycling (Paper, Plastic, Metal, Glass).
                 * GREEN BIN: Organics.
                 * GARBAGE: Black Bin.
            4. UNCERTAINTY: If location is unknown or rules unclear, say "Check Local Guidelines" instead of guessing colors.
            5. VERIFICATION: Provide a clickable Google Search link.

            Format your response in Markdown:
            ### [Item Name]
            **Detected Location:** [City, Region]
            **Recyclable:** [Yes/No/Check Local]
            **Instructions:** [Step-by-step guide]
            **Verify:** [Link]
            `;
            contentParts = [prompt, { inlineData: { data: base64Data, mimeType: "image/jpeg" } }];
        } else if (input.text) {
            prompt = `
            Provide recycling instructions for item: "${input.text}".
            User location coordinates: ${location}.
            Current Date: ${dateStr}.

            STRICT RESPONSE GUIDELINES:
            1. LOCATION: Deduce specific City/Municipality.
            2. TEMPORAL AWARENESS: Be aware of current date (${dateStr}). KEY FACT: Ottawa's transition to Circular Materials is JAN 1, 2026 (NOT 2025).
            3. ACCURACY: You MUST cross-reference the known bin rules below if the location matches.
               - OTTAWA RULES:
                 * BLUE BIN: Glass, Metal, Plastics, Soft Plastics (Clean).
                 * BLACK BIN: Paper, Cardboard.
                 * GREEN BIN: Organics (Food, Yard Waste).
                 * GARBAGE: Styrofoam, composite materials.
               - TORONTO RULES:
                 * BLUE BIN: All Recycling (Paper, Plastic, Metal, Glass).
                 * GREEN BIN: Organics.
                 * GARBAGE: Black Bin.
            4. UNCERTAINTY: If location is unknown or rules unclear, say "Check Local Guidelines" instead of guessing colors.
            5. VERIFICATION: Provide a clickable Google Search link.

            Format your response in Markdown:
            ### ${input.text}
            **Detected Location:** [City, Region]
            **Recyclable:** [Yes/No/Check Local]
            **Instructions:** [Step-by-step guide]
            **Verify:** [Link]
            `;
            contentParts = [prompt];
        }

        try {
            console.log(`Attempting generation with ${state.model}...`);
            const result = await model.generateContent(contentParts);
            const response = await result.response;
            renderMarkdown(response.text());
        } catch (error) {

            console.warn(`Error with ${state.model}:`, error);

            // Handle specific API Leaked/Invalid Key errors
            if (error.message.includes('403') || error.message.includes('leaked') || error.message.includes('API key not valid')) {
                // Show Limit Modal but with "Invalid Key" text
                if (elements.limitModalTitle) elements.limitModalTitle.textContent = "⚠️ Demo Key Expired";
                if (elements.limitModalMsg) elements.limitModalMsg.textContent = "The shared demo key has expired or is invalid. Please get your own free API key to continue.";
                elements.limitModal.classList.add('active');
                elements.analysisContent.innerHTML = `<p style="color: var(--danger-color)">API Key Problem. Please check settings.</p>`;
                return;
            }

            const isQuotaError = error.message.includes('429') || error.message.includes('Resource has been exhausted');

            if (isQuotaError && state.model !== CONFIG.FALLBACK_MODEL) {
                console.log(`Switching to fallback: ${CONFIG.FALLBACK_MODEL}`);
                elements.analysisContent.innerHTML = `<p style="color: var(--warning-color, orange)">Switched to faster model (${CONFIG.FALLBACK_MODEL}) due to traffic.</p>`;
                model = genAI.getGenerativeModel({ model: CONFIG.FALLBACK_MODEL });
                const result = await model.generateContent(contentParts);
                const response = await result.response;
                renderMarkdown(`> [!NOTE]\n> Used fallback model.\n\n` + response.text());
            } else {
                throw error;
            }
        }
    } catch (error) {
        console.error("Gemini Error:", error);
        elements.analysisContent.innerHTML = `<p style="color: var(--danger-color)">Error: ${error.message}</p>`;
    } finally {
        elements.loadingIndicator.classList.add('hidden');
    }
}

function renderMarkdown(text) {
    let html = text
        .replace(/^### (.*$)/gim, '<h3>$1</h3>')
        .replace(/^## (.*$)/gim, '<h2>$1</h2>')
        .replace(/^# (.*$)/gim, '<h1>$1</h1>')
        .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/gim, '<a href="$2" target="_blank">$1</a>')
        .replace(/\n/gim, '<br>');
    elements.analysisContent.innerHTML = html;
}

function updateUIState() {
    document.querySelectorAll('.app-version').forEach(el => el.textContent = CONFIG.APP_VERSION);
    const isDemo = state.isDemoMode;
    document.body.classList.toggle('demo-mode', isDemo);

    if (elements.apiKeyInput) {
        if (isDemo) {
            elements.apiKeyInput.placeholder = "Using Demo Key (Active)";
            elements.apiKeyInput.value = "";
        } else {
            elements.apiKeyInput.placeholder = "Paste your API key here";
            const currentEnvKey = getEnvironmentApiKey();
            elements.apiKeyInput.value = state.apiKey === currentEnvKey ? "" : state.apiKey;
        }
    }

    // Fix: Use classList for visibility to ensure CSS overrides work (display: inline-block vs none)
    if (elements.demoBadge) elements.demoBadge.classList.toggle('hidden', !isDemo);

    // Reset Button: Only show if we actually have a saved user key to remove
    const hasUserKey = !!localStorage.getItem('gemini_api_key');
    if (elements.resetKeyBtn) elements.resetKeyBtn.hidden = !hasUserKey; // HTML hidden attr is fine here if display block, but safer to match style
    if (elements.resetKeyBtn) elements.resetKeyBtn.classList.toggle('hidden', !hasUserKey);
}

function getDOMElements() {
    views = {
        intro: document.getElementById('view-intro'),
        camera: document.getElementById('view-camera'),
        result: document.getElementById('view-result'),
        settings: document.getElementById('view-settings'),
        manual: document.getElementById('view-manual')
    };

    elements = {
        video: document.getElementById('camera-feed'),
        canvas: document.getElementById('camera-canvas'),
        captureBtn: document.getElementById('capture-btn'),
        capturedImage: document.getElementById('captured-image'),
        loadingIndicator: document.getElementById('loading-indicator'),
        analysisContent: document.getElementById('analysis-content'),
        settingsBtn: document.getElementById('settings-btn'),
        closeSettingsBtn: document.getElementById('close-settings-btn'),
        backBtn: document.getElementById('back-btn'),
        apiKeyInput: document.getElementById('api-key-input'),
        saveKeyBtn: document.getElementById('save-key-btn'),
        resetKeyBtn: document.getElementById('reset-key-btn'),
        modelSelect: document.getElementById('model-select'),
        demoBadge: document.getElementById('demo-badge'),
        fileInput: document.getElementById('file-input'),
        uploadBtn: document.getElementById('upload-btn'),
        getStartedBtn: document.getElementById('get-started-btn'),
        manualBtn: document.getElementById('manual-btn'),
        manualInput: document.getElementById('manual-input'),
        searchBtn: document.getElementById('search-btn'),
        closeManualBtn: document.getElementById('close-manual-btn'),
        locationInput: document.getElementById('location-input'),
        // Limit Modal
        limitModal: document.getElementById('limit-modal'),
        limitModalTitle: document.getElementById('limit-modal-title'),
        limitModalMsg: document.getElementById('limit-modal-msg'),
        modalKeyInput: document.getElementById('modal-key-input'),
        saveModalKeyBtn: document.getElementById('save-modal-key-btn')
    };
}

function setupEventListeners() {
    // Initialize app height for mobile browsers
    const setAppHeight = () => {
        const doc = document.documentElement;
        doc.style.setProperty('--app-height', `${window.innerHeight}px`);
    };
    window.addEventListener('resize', setAppHeight);
    setAppHeight();

    // Navigation & Actions
    if (elements.getStartedBtn) {
        elements.getStartedBtn.onclick = () => {
            localStorage.setItem('saw_intro', 'true');
            switchView('view-camera');
        };
    }

    if (elements.captureBtn) {
        elements.captureBtn.onclick = async () => {
            const imageDataUrl = captureImage();
            switchView('view-result');
            await analyzeItem({ image: imageDataUrl });
        };
    }

    if (elements.uploadBtn && elements.fileInput) {
        elements.uploadBtn.onclick = () => elements.fileInput.click();
        elements.fileInput.onchange = async (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = async (event) => {
                    elements.capturedImage.src = event.target.result;
                    switchView('view-result');
                    await analyzeItem({ image: event.target.result });
                };
                reader.readAsDataURL(file);
            }
        };
    }

    if (elements.manualBtn) elements.manualBtn.onclick = () => switchView('view-manual');
    if (elements.closeManualBtn) elements.closeManualBtn.onclick = () => switchView('view-camera');

    if (elements.searchBtn && elements.manualInput) {
        elements.searchBtn.onclick = async () => {
            const text = elements.manualInput.value.trim();
            if (text) {
                switchView('view-result');
                await analyzeItem({ text: text });
            }
        };
    }

    // Navigation buttons
    if (elements.backBtn) elements.backBtn.onclick = () => switchView('view-camera');
    if (elements.settingsBtn) elements.settingsBtn.onclick = () => switchView('view-settings');
    if (elements.closeSettingsBtn) elements.closeSettingsBtn.onclick = () => switchView('view-camera');

    // Settings
    if (elements.saveKeyBtn) {
        elements.saveKeyBtn.onclick = () => {
            const key = elements.apiKeyInput ? elements.apiKeyInput.value.trim() : '';
            if (key) {
                state.apiKey = key;
                localStorage.setItem('gemini_api_key', key);
                alert("API Key saved!");
                fetchAvailableModels();
                updateUIState();
            }
        };
    }

    if (elements.resetKeyBtn) {
        elements.resetKeyBtn.onclick = () => {
            localStorage.removeItem('gemini_api_key');
            state.apiKey = getEnvironmentApiKey() || '';
            fetchAvailableModels();
            updateUIState();
            switchView('view-camera');
        };
    }

    if (elements.modelSelect) {
        elements.modelSelect.onchange = () => {
            state.model = elements.modelSelect.value;
            localStorage.setItem('gemini_model', state.model);
        };
    }

    // Limit Modal Actions
    if (elements.saveModalKeyBtn && elements.modalKeyInput) {
        elements.saveModalKeyBtn.onclick = () => {
            const key = elements.modalKeyInput.value.trim();
            if (key) {
                state.apiKey = key;
                localStorage.setItem('gemini_api_key', key);
                alert("Key saved! You have unlimited access. Try your scan again.");
                if (elements.apiKeyInput) elements.apiKeyInput.value = key; // specific fix
                fetchAvailableModels();
                updateUIState();
                elements.limitModal.classList.remove('active');
            } else {
                alert("Please paste a valid key.");
            }
        };
    }

    // Manual Location Save/Load
    if (elements.locationInput) {
        const savedLoc = localStorage.getItem('manual_location');
        if (savedLoc) elements.locationInput.value = savedLoc;

        const saveLoc = (e) => localStorage.setItem('manual_location', e.target.value);
        elements.locationInput.addEventListener('input', saveLoc);
        elements.locationInput.addEventListener('change', saveLoc);
    }
}

async function init() {
    console.log("Initializing App...");

    getDOMElements();
    setupEventListeners();

    // Fix: Check for stale/broken demo key from old PR version and purge it
    const STALE_KEY = "AIzaSyC_MiybngCmG_DSuXZfWBOHr5d8vI8iS2E";
    if (localStorage.getItem('gemini_api_key') === STALE_KEY) {
        console.log("Migration: Removing stale API key from local storage");
        localStorage.removeItem('gemini_api_key');
        // Re-init state key
        state.apiKey = getEnvironmentApiKey() || '';
    }

    updateUIState();
    if (state.apiKey) fetchAvailableModels();

    // Start fetching location immediately for UI status
    getLocation();

    const sawIntro = localStorage.getItem('saw_intro');
    switchView(sawIntro ? 'view-camera' : 'view-intro');

    // Check for updates
    checkAndShowChangelog(CONFIG.APP_VERSION);

    // Debug
    const debugState = { ...state };
    if (debugState.apiKey) debugState.apiKey = debugState.isDemoMode ? "HIDDEN_DEMO_KEY" : "HIDDEN_USER_KEY";
    window.debugApp = { state: debugState, elements, views, CONFIG };
}

window.addEventListener('DOMContentLoaded', init);
