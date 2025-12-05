import { GoogleGenerativeAI } from "@google/generative-ai";

console.log("App.js module loaded");
// alert("App.js loaded"); // Uncomment if needed for extreme debugging

// State
const state = {
    apiKey: localStorage.getItem('gemini_api_key') || '',
    currentView: 'view-camera',
    stream: null
};

// DOM Elements
const views = {
    camera: document.getElementById('view-camera'),
    result: document.getElementById('view-result'),
    settings: document.getElementById('view-settings')
};

const elements = {
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
    saveKeyBtn: document.getElementById('save-key-btn')
};

// Navigation
function switchView(viewName) {
    Object.values(views).forEach(view => {
        view.classList.remove('active');
    });
    views[viewName.replace('view-', '')].classList.add('active');
    state.currentView = viewName;

    if (viewName === 'view-camera') {
        startCamera();
    } else {
        stopCamera();
    }
}

// Camera Logic
async function startCamera() {
    try {
        if (state.stream) return; // Already running

        const constraints = {
            video: {
                facingMode: 'environment', // Use back camera on mobile
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }
        };

        state.stream = await navigator.mediaDevices.getUserMedia(constraints);
        elements.video.srcObject = state.stream;
    } catch (err) {
        console.error("Error accessing camera:", err);
        alert("Could not access camera. Please ensure you have granted permissions.");
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
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" }); // Using 1.5 Pro as 3 is not public yet, or fallback

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
function init() {
    console.log("Initializing App...");

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
        saveKeyBtn: document.getElementById('save-key-btn')
    };

    // Attach listeners
    if (elements.captureBtn) {
        elements.captureBtn.onclick = async () => {
            const imageDataUrl = captureImage();
            switchView('view-result');
            await analyzeImage(imageDataUrl);
        };
    }

    if (elements.backBtn) {
        elements.backBtn.onclick = () => switchView('view-camera');
    }

    if (elements.settingsBtn) {
        elements.settingsBtn.onclick = () => {
            if (elements.apiKeyInput) elements.apiKeyInput.value = state.apiKey;
            switchView('view-settings');
        };
    }

    if (elements.closeSettingsBtn) {
        elements.closeSettingsBtn.onclick = () => {
            if (state.currentView === 'view-settings') switchView('view-camera');
        };
    }

    if (elements.saveKeyBtn) {
        elements.saveKeyBtn.onclick = () => {
            const key = elements.apiKeyInput ? elements.apiKeyInput.value.trim() : '';
            if (key) {
                state.apiKey = key;
                localStorage.setItem('gemini_api_key', key);
                alert("API Key saved!");
                switchView('view-camera');
            } else {
                alert("Please enter a valid key.");
            }
        };
    }

    // Start camera
    startCamera();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
