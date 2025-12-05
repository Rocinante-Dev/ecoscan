import { GoogleGenerativeAI } from "@google/generative-ai";

console.log("App.js module loaded");
// alert("App.js loaded"); // Uncomment if needed for extreme debugging

// State
const state = {
    apiKey: localStorage.getItem('gemini_api_key') || '',
    model: localStorage.getItem('gemini_model') || 'gemini-1.5-pro-latest',
    currentView: 'view-camera',
    stream: null
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
                // Keep default if nothing matches or update? 
                // If default 'gemini-1.5-pro-latest' invalid, maybe we should switch?
                // For now, let's just warn or keep as is.
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
        const model = genAI.getGenerativeModel({ model: state.model });

        const location = await getLocation();

        // Remove header from base64
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

        const result = await model.generateContent([prompt, imagePart]);
        const response = await result.response;
        const text = response.text();

        renderMarkdown(text);
    } catch (error) {
        console.error("Gemini Error:", error);
        elements.analysisContent.innerHTML = `<p style="color: var(--danger-color)">Error analyzing image: ${error.message}</p>`;
    } finally {
        elements.loadingIndicator.classList.add('hidden');
    }
}

function renderMarkdown(text) {
    // Simple markdown to HTML converter for the MVP
    // In a real app, use a library like marked
    let html = text
        .replace(/^### (.*$)/gim, '<h3>$1</h3>')
        .replace(/^## (.*$)/gim, '<h2>$1</h2>')
        .replace(/^# (.*$)/gim, '<h1>$1</h1>')
        .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
        .replace(/\n/gim, '<br>');

    elements.analysisContent.innerHTML = html;
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
            modelSelect: document.getElementById('model-select')
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
                if (elements.apiKeyInput) elements.apiKeyInput.value = state.apiKey;
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
                    state.apiKey = key;
                    localStorage.setItem('gemini_api_key', key);
                    alert("API Key saved!");
                    fetchAvailableModels();
                    switchView('view-camera');
                } else {
                    alert("Please enter a valid key.");
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

        // Initial fetch if key exists
        if (state.apiKey) {
            fetchAvailableModels();
        }

        // Start camera
        await startCamera();

        // Expose for debugging
        window.debugApp = { state, elements, views };
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
