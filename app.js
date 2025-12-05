import { GoogleGenerativeAI } from "@google/generative-ai";
import { CONFIG } from "./config.js";

console.log(`App.js module loaded. Version: ${CONFIG.APP_VERSION}`);

// State
const state = {
    // If local key exists, use it. Otherwise use default/demo key.
    apiKey: localStorage.getItem('gemini_api_key') || CONFIG.DEFAULT_API_KEY || '',
    model: localStorage.getItem('gemini_model') || CONFIG.DEFAULT_MODEL,
    currentView: 'view-camera',
    stream: null,
    // Demo mode is active if we are using the default key AND there is no local key override
    get isDemoMode() {
        return !localStorage.getItem('gemini_api_key') && this.apiKey === CONFIG.DEFAULT_API_KEY && !!CONFIG.DEFAULT_API_KEY;
    }
};

// DOM Elements
let views = {};
let elements = {};

// Navigation
function switchView(viewName) {
    console.log(`Switching to view: ${viewName}`);
    Object.values(views).forEach(view => {
        view.classList.remove('active');
    });
    if (views[viewName.replace('view-', '')]) {
        views[viewName.replace('view-', '')].classList.add('active');
        state.currentView = viewName;

        if (viewName === 'view-camera') {
            startCamera();
        } else {
            stopCamera();
        }

        // Refresh UI state when switching views
        updateUIState();
    } else {
        console.error(`View not found: ${viewName}`);
    }
}

// Camera Logic
async function startCamera() {
    console.log("Attempting to start camera...");
    try {
        if (state.stream) {
            console.log("Stream already exists");
            return; // Already running
        }

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error("Camera API not supported in this browser");
        }

        const constraints = {
            video: {
                facingMode: 'environment', // Use back camera on mobile
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }
        };

        state.stream = await navigator.mediaDevices.getUserMedia(constraints);
        elements.video.srcObject = state.stream;
        console.log("Camera started successfully");
    } catch (err) {
        console.error("Error accessing camera:", err);
        alert(`Could not access camera: ${err.message}. Please ensure you have granted permissions and are using HTTPS.`);
    }
}

function stopCamera() {
    console.log("Stopping camera...");
    if (state.stream) {
        state.stream.getTracks().forEach(track => track.stop());
        state.stream = null;
    }
}

function captureImage() {
    console.log("Capturing image...");
    const context = elements.canvas.getContext('2d');
    elements.canvas.width = elements.video.videoWidth;
    elements.canvas.height = elements.video.videoHeight;
    context.drawImage(elements.video, 0, 0, elements.canvas.width, elements.canvas.height);

    const imageDataUrl = elements.canvas.toDataURL('image/jpeg', 0.8);
    elements.capturedImage.src = imageDataUrl;

    return imageDataUrl;
}

// Location Logic
function getLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            resolve("Location not supported");
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (position) => {
                resolve(`${position.coords.latitude}, ${position.coords.longitude}`);
            },
            (error) => {
                console.warn("Location error:", error);
                resolve("Unknown Location");
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

            // Sort: Prefer 'pro' then 'flash' then others
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

            // Ensure selection tracks state if current invalid
            if (contentModels.length > 0 && !contentModels.find(m => m.name.replace('models/', '') === state.model)) {
                console.warn(`Stored model ${state.model} not found in available list.`);
            }
        }
    } catch (e) {
        console.error("Failed to fetch models:", e);
    }
}

// Gemini Logic
async function analyzeImage(base64Image) {
    if (!state.apiKey) {
        alert("Please set your Gemini API Key in settings first.");
        switchView('view-settings');
        return;
    }

    elements.loadingIndicator.classList.remove('hidden');
    elements.analysisContent.innerHTML = '';

    try {
        const genAI = new GoogleGenerativeAI(state.apiKey);
        let model = genAI.getGenerativeModel({ model: state.model });

        const location = await getLocation();

        const base64Data = base64Image.split(',')[1];

        const prompt = `
        You are an expert recycling assistant. I have taken a picture of an item.
        My current location is: ${location}.
        
        Please identify the item and provide specific recycling or disposal instructions.
        Consider local recycling rules for my location if you know them, otherwise provide general best practices.
        
        Format your response in Markdown:
        1. **Item Name**: [Name]
        2. **Recyclable?**: [Yes/No/Check Local]
        3. **Instructions**: [Step by step guide]
        4. **Fun Fact**: [Eco-friendly fact about this item]
        `;

        const imagePart = {
            inlineData: {
                data: base64Data,
                mimeType: "image/jpeg",
            },
        };

        try {
            console.log(`Attempting generation with ${state.model}...`);
            const result = await model.generateContent([prompt, imagePart]);
            const response = await result.response;
            const text = response.text();
            renderMarkdown(text);
        } catch (error) {
            console.warn(`Error with ${state.model}:`, error);

            // Check for Quota Exceeded (429) or Service Unavailable (503)
            const isQuotaError = error.message.includes('429') || error.message.includes('Resource has been exhausted');

            if (isQuotaError && state.model !== CONFIG.FALLBACK_MODEL) {
                console.log(`Switching to fallback model: ${CONFIG.FALLBACK_MODEL}`);
                elements.analysisContent.innerHTML = `<p style="color: var(--warning-color, orange)">NOTE: High traffic detected. Switched to faster model (${CONFIG.FALLBACK_MODEL}).</p>`;

                model = genAI.getGenerativeModel({ model: CONFIG.FALLBACK_MODEL });
                const result = await model.generateContent([prompt, imagePart]);
                const response = await result.response;
                const text = response.text();

                // Prepend note about fallback
                const note = `> [!NOTE]\n> Used fallback model due to high traffic.\n\n`;
                renderMarkdown(note + text);
            } else {
                throw error; // Re-throw if not quota error or already on fallback
            }
        }

    } catch (error) {
        console.error("Gemini Error:", error);
        elements.analysisContent.innerHTML = `<p style="color: var(--danger-color)">Error analyzing image: ${error.message}</p>`;
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
        .replace(/\n/gim, '<br>');

    elements.analysisContent.innerHTML = html;
}

// UI Updates
function updateUIState() {
    // Update Version Displays
    document.querySelectorAll('.app-version').forEach(el => {
        el.textContent = CONFIG.APP_VERSION;
    });

    // Update Demo Mode Indicators
    const isDemo = state.isDemoMode;
    document.body.classList.toggle('demo-mode', isDemo);

    // Update Settings UI
    if (elements.apiKeyInput) {
        if (isDemo) {
            elements.apiKeyInput.placeholder = "Using Demo Key (Active)";
            elements.apiKeyInput.value = ""; // Don't show the actual demo key
        } else {
            elements.apiKeyInput.placeholder = "Paste your API key here";
            // Only show value if it's the user's custom key
            elements.apiKeyInput.value = state.apiKey === CONFIG.DEFAULT_API_KEY ? "" : state.apiKey;
        }
    }

    if (elements.demoBadge) {
        elements.demoBadge.hidden = !isDemo;
    }

    if (elements.resetKeyBtn) {
        elements.resetKeyBtn.hidden = isDemo;
    }
}

// Init
async function init() {
    console.log("Initializing App...");

    try {
        // Query elements
        views = {
            camera: document.getElementById('view-camera'),
            result: document.getElementById('view-result'),
            settings: document.getElementById('view-settings')
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
            demoBadge: document.getElementById('demo-badge')
        };

        console.log("Elements queried:", elements);

        // Attach listeners
        if (elements.captureBtn) {
            elements.captureBtn.onclick = async () => {
                console.log("Capture button clicked");
                const imageDataUrl = captureImage();
                switchView('view-result');
                await analyzeImage(imageDataUrl);
            };
        } else {
            console.error("Capture button not found");
        }

        if (elements.backBtn) {
            elements.backBtn.onclick = () => {
                console.log("Back button clicked");
                switchView('view-camera');
            }
        }

        if (elements.settingsBtn) {
            elements.settingsBtn.onclick = () => {
                console.log("Settings button clicked");
                switchView('view-settings');
            };
        } else {
            console.error("Settings button not found");
        }

        if (elements.closeSettingsBtn) {
            elements.closeSettingsBtn.onclick = () => {
                console.log("Close settings button clicked");
                if (state.currentView === 'view-settings') switchView('view-camera');
            };
        }

        if (elements.saveKeyBtn) {
            elements.saveKeyBtn.onclick = () => {
                console.log("Save key button clicked");
                const key = elements.apiKeyInput ? elements.apiKeyInput.value.trim() : '';

                if (key) {
                    // Save User Key
                    state.apiKey = key;
                    localStorage.setItem('gemini_api_key', key);
                    alert("API Key saved! Switched to Custom Mode.");
                    fetchAvailableModels();
                    updateUIState();
                    switchView('view-camera');
                } else {
                    alert("Please enter a valid key to save.");
                }
            };
        }

        if (elements.resetKeyBtn) {
            elements.resetKeyBtn.onclick = () => {
                if (confirm("Remove your custom key and switch back to Demo Mode?")) {
                    localStorage.removeItem('gemini_api_key');
                    state.apiKey = CONFIG.DEFAULT_API_KEY || '';
                    alert("Switched to Demo Mode.");

                    fetchAvailableModels();
                    updateUIState();
                    switchView('view-camera');
                }
            };
        }

        // Model Selection Listener
        if (elements.modelSelect) {
            elements.modelSelect.onchange = () => {
                state.model = elements.modelSelect.value;
                localStorage.setItem('gemini_model', state.model);
                console.log("Model changed to:", state.model);
            };
        }

        // Initial UI Update
        updateUIState();

        // Initial fetch if key exists
        if (state.apiKey) {
            fetchAvailableModels();
        }

        // Start camera
        await startCamera();

        // Expose for debugging (Sanitized)
        const debugState = { ...state };
        if (debugState.apiKey) {
            debugState.apiKey = debugState.isDemoMode ? "HIDDEN_DEMO_KEY" : "HIDDEN_USER_KEY";
        }

        window.debugApp = { state: debugState, elements, views, CONFIG };
        console.log("App initialized. Debug object available at window.debugApp");

    } catch (e) {
        console.error("Initialization error:", e);
        alert("App initialization failed: " + e.message);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        console.log("DOMContentLoaded fired");
        init();
    });
} else {
    console.log("ReadyState is " + document.readyState);
    init();
}
