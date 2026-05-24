// Paris Map Coordinates
const DEFAULT_MAP_BOUNDS = {
    latMin: 48.840,
    latMax: 48.890,
    lngMin: 2.270,
    lngMax: 2.365
};

let MAP_BOUNDS = { ...DEFAULT_MAP_BOUNDS };

// Landmarks in Paris (lat, lng, name)
const LANDMARKS = [
    { name: "Eiffel Tower", lat: 48.8584, lng: 2.2945 },
    { name: "Louvre Museum", lat: 48.8606, lng: 2.3376 },
    { name: "Arc de Triomphe", lat: 48.8738, lng: 2.2950 }
];

// Driver state dictionary
let driversState = {};

// Colors mapping
const driverColors = {
    'driver_1': '#06b6d4', // Alice - Cyan
    'driver_2': '#10b981', // Bob - Emerald
    'driver_3': '#8b5cf6'  // Charlie - Purple
};

// UI State variables
let currentUser = null;
let currentRole = null;
let currentOrderId = null;
let assignedDriverId = null;
let focusedDriverId = 'all';

// DOM Elements
const loginOverlay = document.getElementById('login-overlay');
const loginForm = document.getElementById('login-form');
const loginUsernameInput = document.getElementById('login-username');
const roleTag = document.getElementById('role-tag');
const btnLogout = document.getElementById('btn-logout');

const userPanel = document.getElementById('user-panel');
const btnRequestRide = document.getElementById('btn-request-ride');
const btnCancelRide = document.getElementById('btn-cancel-ride');
const rideStatus = document.getElementById('ride-status');

const adminPanel = document.getElementById('admin-panel');
const driverFilterSelect = document.getElementById('driver-filter');
const followDriverChk = document.getElementById('follow-driver-chk');

const connectionBadge = document.getElementById('connection-status');
const statusText = document.getElementById('status-text');
const driversList = document.getElementById('drivers-list');
const consoleStream = document.getElementById('console-stream');
const btnClearConsole = document.getElementById('btn-clear-console');

const canvas = document.getElementById('map-canvas');
const ctx = canvas.getContext('2d');

let centrifuge = null;
let currentSubscription = null;

// --- Helper Functions ---

// Map GPS coordinates to Canvas pixel coordinates
function getPixelCoords(lat, lng, width, height) {
    const x = ((lng - MAP_BOUNDS.lngMin) / (MAP_BOUNDS.lngMax - MAP_BOUNDS.lngMin)) * width;
    const y = (1.0 - (lat - MAP_BOUNDS.latMin) / (MAP_BOUNDS.latMax - MAP_BOUNDS.latMin)) * height;
    return { x, y };
}

// Log message to the console panel securely
function logMessage(tag, message) {
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');

    const entry = document.createElement('div');
    entry.className = 'log-entry';

    const timeSpan = document.createElement('span');
    timeSpan.className = 'log-time';
    timeSpan.textContent = timeStr;

    const tagSpan = document.createElement('span');
    tagSpan.className = `log-tag ${tag.toLowerCase()}`;
    tagSpan.textContent = `[${tag}]`;

    const bodySpan = document.createElement('span');
    bodySpan.className = 'log-body';
    bodySpan.textContent = typeof message === 'object' ? JSON.stringify(message) : message;

    entry.appendChild(timeSpan);
    entry.appendChild(tagSpan);
    entry.appendChild(bodySpan);

    consoleStream.appendChild(entry);

    // Limit logs count to 50
    while (consoleStream.childNodes.length > 50) {
        consoleStream.removeChild(consoleStream.firstChild);
    }

    // Scroll to bottom
    consoleStream.scrollTop = consoleStream.scrollHeight;
}

// Clear console stream
btnClearConsole.addEventListener('click', () => {
    consoleStream.replaceChildren();
    logMessage('SYSTEM', 'Console logs cleared.');
});

// Update or create driver card in the sidebar
function updateDriverCard(driverId, name, lat, lng, speed, status) {
    let card = document.getElementById(`card-${driverId}`);
    
    if (!card) {
        // Create card structure
        card = document.createElement('div');
        card.id = `card-${driverId}`;
        card.className = `driver-card ${driverId}`;

        const cardHeader = document.createElement('div');
        cardHeader.className = 'driver-header';

        const nameEl = document.createElement('span');
        nameEl.className = 'driver-name';
        nameEl.textContent = name;

        const statusIndicator = document.createElement('span');
        statusIndicator.className = 'driver-status active';
        statusIndicator.id = `status-ind-${driverId}`;

        cardHeader.appendChild(nameEl);
        cardHeader.appendChild(statusIndicator);

        const telemetry = document.createElement('div');
        telemetry.className = 'driver-telemetry';

        // Coordinates item
        const itemCoords = document.createElement('div');
        itemCoords.className = 'telemetry-item';
        const labelCoords = document.createElement('span');
        labelCoords.className = 'telemetry-label';
        labelCoords.textContent = 'Coordinates';
        const valCoords = document.createElement('span');
        valCoords.className = 'telemetry-value';
        valCoords.id = `coords-val-${driverId}`;
        itemCoords.appendChild(labelCoords);
        itemCoords.appendChild(valCoords);

        // Speed item
        const itemSpeed = document.createElement('div');
        itemSpeed.className = 'telemetry-item';
        const labelSpeed = document.createElement('span');
        labelSpeed.className = 'telemetry-label';
        labelSpeed.textContent = 'Speed';
        const valSpeed = document.createElement('span');
        valSpeed.className = 'telemetry-value';
        valSpeed.id = `speed-val-${driverId}`;
        itemSpeed.appendChild(labelSpeed);
        itemSpeed.appendChild(valSpeed);

        // Progress speed bar
        const speedIndicator = document.createElement('div');
        speedIndicator.className = 'speed-indicator';
        const barBg = document.createElement('div');
        barBg.className = 'speed-bar-bg';
        const barFill = document.createElement('div');
        barFill.className = 'speed-bar-fill';
        barFill.id = `speed-bar-${driverId}`;
        barBg.appendChild(barFill);
        speedIndicator.appendChild(barBg);

        telemetry.appendChild(itemCoords);
        telemetry.appendChild(itemSpeed);
        telemetry.appendChild(speedIndicator);

        card.appendChild(cardHeader);
        card.appendChild(telemetry);
        
        // Let admin focus on driver on card click
        card.addEventListener('click', () => {
            if (currentRole === 'admin') {
                driverFilterSelect.value = driverId;
                focusedDriverId = driverId;
                logMessage('ADMIN', `Focused map on driver: ${driverId}`);
            }
        });

        driversList.appendChild(card);
    }

    // Update fields securely using textContent
    const coordsEl = document.getElementById(`coords-val-${driverId}`);
    if (coordsEl) coordsEl.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

    const speedEl = document.getElementById(`speed-val-${driverId}`);
    if (speedEl) speedEl.textContent = `${speed} km/h`;

    const statusInd = document.getElementById(`status-ind-${driverId}`);
    if (statusInd) {
        statusInd.className = `driver-status ${status === 'active' ? 'active' : ''}`;
    }

    const barFill = document.getElementById(`speed-bar-${driverId}`);
    if (barFill) {
        const percent = Math.min((speed / 80) * 100, 100);
        barFill.style.width = `${percent}%`;
    }
}

// --- Telemetry Event Handler ---
function handleTelemetryUpdate(data) {
    const driverId = data.driver_id;
    if (!driverId) return;

    // Check if we have this driver tracked
    if (!driversState[driverId]) {
        driversState[driverId] = {
            name: data.name,
            currentLat: data.lat,
            currentLng: data.lng,
            targetLat: data.lat,
            targetLng: data.lng,
            history: [],
            speed: data.speed,
            status: data.status,
            lastUpdated: Date.now()
        };
    } else {
        const state = driversState[driverId];
        state.history.push({ lat: state.targetLat, lng: state.targetLng });
        if (state.history.length > 25) {
            state.history.shift();
        }
        state.targetLat = data.lat;
        state.targetLng = data.lng;
        state.speed = data.speed;
        state.status = data.status;
        state.lastUpdated = Date.now();
    }

    // Update sidebar card
    updateDriverCard(driverId, data.name, data.lat, data.lng, data.speed, data.status);
}

// --- WebSocket Subscriptions ---

function disconnectCentrifugo() {
    if (currentSubscription) {
        currentSubscription.unsubscribe();
        currentSubscription = null;
    }
    if (centrifuge) {
        centrifuge.disconnect();
        centrifuge = null;
    }
    connectionBadge.className = 'status-badge';
    statusText.textContent = 'Disconnected';
}

function connectAndSubscribe(channelName) {
    disconnectCentrifugo();

    const token = localStorage.getItem('access_token');
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/connection/websocket?token=${token}`;
    logMessage('SYSTEM', `Initializing WebSocket connection to: ${wsUrl}`);

    centrifuge = new Centrifuge(wsUrl, {
        token: token
    });

    centrifuge.on('connecting', (ctx) => {
        connectionBadge.className = 'status-badge';
        statusText.textContent = 'Connecting';
        logMessage('WS', 'Connecting to Centrifugo...');
    });

    centrifuge.on('connected', (ctx) => {
        connectionBadge.className = 'status-badge connected';
        statusText.textContent = 'Connected';
        logMessage('WS', `Connected! Transport: ${ctx.transport}`);
    });

    centrifuge.on('disconnected', (ctx) => {
        connectionBadge.className = 'status-badge';
        statusText.textContent = 'Disconnected';
        logMessage('WS', `Disconnected: ${ctx.reason}`);

        // If disconnected due to token expiry, auto-logout and show login screen
        if (ctx.code === 401 || ctx.reason === 'unauthorized') {
            logMessage('API_ERR', 'WebSocket session expired. Please log in again.');
            localStorage.clear();
            currentUser = null;
            currentRole = null;
            currentOrderId = null;
            assignedDriverId = null;
            driversState = {};
            loginOverlay.classList.remove('hidden');
        }
    });

    logMessage('SYSTEM', `Subscribing to channel: ${channelName}`);
    currentSubscription = centrifuge.newSubscription(channelName);

    currentSubscription.on('publication', (ctx) => {
        logMessage('WS_MSG', ctx.data);
        handleTelemetryUpdate(ctx.data);
    });

    currentSubscription.on('subscribing', (ctx) => {
        logMessage('SUB', `Subscribing to channel ${channelName}...`);
    });

    currentSubscription.on('subscribed', (ctx) => {
        logMessage('SUB', `Subscribed to ${channelName}!`);
    });

    currentSubscription.on('error', (ctx) => {
        logMessage('SUB_ERR', `Subscription error: ${ctx.error.message}`);
    });

    currentSubscription.subscribe();
    centrifuge.connect();
}

// --- REST API Calls ---

async function apiRequest(endpoint, payload = {}) {
    try {
        logMessage('API', `Sending POST request to ${endpoint}`);
        const headers = {
            'Content-Type': 'application/json'
        };
        const token = localStorage.getItem('access_token');
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload)
        });

        // Detect expired/invalid token before trying to parse the HTML error page as JSON
        if (response.status === 401) {
            logMessage('API_ERR', 'Session expired. Please log in again.');
            disconnectCentrifugo();
            localStorage.clear();
            currentUser = null;
            currentRole = null;
            currentOrderId = null;
            assignedDriverId = null;
            driversState = {};
            loginOverlay.classList.remove('hidden');
            throw new Error('Session expired. Please log in again.');
        }

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.detail || 'API request failed');
        }
        return data;
    } catch (e) {
        logMessage('API_ERR', e.message);
        throw e;
    }
}


// User Action: Request Driver
btnRequestRide.addEventListener('click', async () => {
    btnRequestRide.disabled = true;
    rideStatus.textContent = 'Searching for a driver...';
    
    try {
        const result = await apiRequest('/api/request-ride');
        
        currentOrderId = result.order_id;
        assignedDriverId = result.driver_id;
        
        localStorage.setItem('order_id', currentOrderId);
        localStorage.setItem('driver_id', assignedDriverId);
        
        rideStatus.textContent = `Assigned to: ${result.driver_name}`;
        
        btnRequestRide.classList.add('hidden');
        btnCancelRide.classList.remove('hidden');
        
        // Start WSS telemetry feed for this order
        connectAndSubscribe(`orders:updates_${currentOrderId}`);
    } catch (e) {
        rideStatus.textContent = `Error: ${e.message}`;
        btnRequestRide.disabled = false;
    }
});

// User Action: Cancel Ride
btnCancelRide.addEventListener('click', async () => {
    btnCancelRide.disabled = true;
    rideStatus.textContent = 'Cancelling ride...';
    
    try {
        await apiRequest('/api/end-ride', { order_id: currentOrderId });
        
        disconnectCentrifugo();
        
        localStorage.removeItem('order_id');
        localStorage.removeItem('driver_id');
        currentOrderId = null;
        assignedDriverId = null;
        driversState = {};
        driversList.replaceChildren();
        
        rideStatus.textContent = 'Ride cancelled. Ready.';
        
        btnCancelRide.classList.add('hidden');
        btnRequestRide.classList.remove('hidden');
        btnRequestRide.disabled = false;
        btnCancelRide.disabled = false;
        
        // Reset Map View
        MAP_BOUNDS = { ...DEFAULT_MAP_BOUNDS };
    } catch (e) {
        rideStatus.textContent = `Error cancelling: ${e.message}`;
        btnCancelRide.disabled = false;
    }
});

// Admin Filter Change
driverFilterSelect.addEventListener('change', (e) => {
    focusedDriverId = e.target.value;
    logMessage('ADMIN', `Changed filter focus to: ${focusedDriverId}`);
});

// --- Session Lifecycle (Login/Logout) ---

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = loginUsernameInput.value.trim();
    const password = document.getElementById('login-password').value;
    
    try {
        const response = await apiRequest('/oauth2/token', { username, password });
        
        currentUser = username;
        currentRole = response.role;
        
        localStorage.setItem('username', currentUser);
        localStorage.setItem('role', currentRole);
        localStorage.setItem('access_token', response.access_token);
        
        initSession();
    } catch (err) {
        alert(err.message || 'Login failed');
    }
});

btnLogout.addEventListener('click', () => {
    disconnectCentrifugo();
    
    localStorage.clear();
    currentUser = null;
    currentRole = null;
    currentOrderId = null;
    assignedDriverId = null;
    driversState = {};
    driversList.replaceChildren();
    
    loginOverlay.classList.remove('hidden');
});

function initSession() {
    currentUser = localStorage.getItem('username');
    currentRole = localStorage.getItem('role');
    const token = localStorage.getItem('access_token');
    
    if (!currentUser || !currentRole || !token) {
        loginOverlay.classList.remove('hidden');
        return;
    }
    
    loginOverlay.classList.add('hidden');
    roleTag.textContent = currentRole;
    
    // Reset views
    userPanel.classList.add('hidden');
    adminPanel.classList.add('hidden');
    driversList.replaceChildren();
    driversState = {};
    
    if (currentRole === 'admin') {
        adminPanel.classList.remove('hidden');
        document.getElementById('list-title').textContent = 'Live Fleet Status';
        
        // Admin listens to the global feed
        connectAndSubscribe('admin:updates');
    } else {
        userPanel.classList.remove('hidden');
        document.getElementById('list-title').textContent = 'Your Driver';
        
        currentOrderId = localStorage.getItem('order_id');
        assignedDriverId = localStorage.getItem('driver_id');
        
        if (currentOrderId && assignedDriverId) {
            rideStatus.textContent = `Assigned Driver: ${assignedDriverId}`;
            btnRequestRide.classList.add('hidden');
            btnCancelRide.classList.remove('hidden');
            
            // Re-subscribe to existing order feed
            connectAndSubscribe(`orders:updates_${currentOrderId}`);
        } else {
            rideStatus.textContent = 'Ready to request.';
            btnRequestRide.classList.remove('hidden');
            btnCancelRide.classList.add('hidden');
            btnRequestRide.disabled = false;
        }
    }
}

// --- Map Canvas Rendering ---

function resizeCanvas() {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas(); // initial setup

let pulseAngle = 0;

function drawMap() {
    requestAnimationFrame(drawMap);

    const w = canvas.width;
    const h = canvas.height;

    // Clear Canvas
    ctx.clearRect(0, 0, w, h);

    pulseAngle += 0.05;
    const pulseRadius = 6 + Math.sin(pulseAngle) * 3;

    // Dynamic Camera Centering and Zoom on focused driver (Admin) or assigned driver (User)
    let followDriver = null;
    
    if (currentRole === 'user' && assignedDriverId && driversState[assignedDriverId]) {
        followDriver = driversState[assignedDriverId];
    } else if (currentRole === 'admin' && focusedDriverId !== 'all' && driversState[focusedDriverId] && followDriverChk.checked) {
        followDriver = driversState[focusedDriverId];
    }
    
    if (followDriver) {
        // Tight bounds centered on the active vehicle to simulate camera tracking/zoom
        const centerLat = followDriver.currentLat;
        const centerLng = followDriver.currentLng;
        MAP_BOUNDS = {
            latMin: centerLat - 0.003,
            latMax: centerLat + 0.003,
            lngMin: centerLng - 0.0055,
            lngMax: centerLng + 0.0055
        };
    } else {
        // Revert to full Paris view
        MAP_BOUNDS = { ...DEFAULT_MAP_BOUNDS };
    }

    // 1. Draw Landmarks
    LANDMARKS.forEach(landmark => {
        const pix = getPixelCoords(landmark.lat, landmark.lng, w, h);
        
        // Draw crosshair indicator
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(pix.x, pix.y, 12, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.beginPath();
        ctx.arc(pix.x, pix.y, 2, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#6b7280';
        ctx.font = '10px ui-monospace, SFMono-Regular, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(landmark.name, pix.x, pix.y - 18);
    });

    // 2. Draw and Interpolate Drivers
    Object.keys(driversState).forEach(driverId => {
        // Filter drivers if we are user (only show assigned) or admin (filter focused)
        if (currentRole === 'user' && driverId !== assignedDriverId) {
            return;
        }
        if (currentRole === 'admin' && focusedDriverId !== 'all' && driverId !== focusedDriverId) {
            // Remove unselected driver card from DOM in sidebar to keep list filtered
            const card = document.getElementById(`card-${driverId}`);
            if (card) card.classList.add('hidden');
        } else {
            const card = document.getElementById(`card-${driverId}`);
            if (card) card.classList.remove('hidden');
        }

        const driver = driversState[driverId];
        const color = driverColors[driverId] || '#ffffff';

        // LERP interpolation
        driver.currentLat += (driver.targetLat - driver.currentLat) * 0.045;
        driver.currentLng += (driver.targetLng - driver.currentLng) * 0.045;

        const pix = getPixelCoords(driver.currentLat, driver.currentLng, w, h);

        // A. Draw Trail History
        if (driver.history.length > 1) {
            ctx.strokeStyle = color;
            ctx.lineWidth = 2.5;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            
            const firstPix = getPixelCoords(driver.history[0].lat, driver.history[0].lng, w, h);
            ctx.moveTo(firstPix.x, firstPix.y);
            
            for (let i = 1; i < driver.history.length; i++) {
                const stepPix = getPixelCoords(driver.history[i].lat, driver.history[i].lng, w, h);
                ctx.lineTo(stepPix.x, stepPix.y);
            }
            
            ctx.lineTo(pix.x, pix.y);
            ctx.globalAlpha = 0.2;
            ctx.stroke();
            ctx.globalAlpha = 1.0;
        }

        // B. Draw Pulse Glowing Ring
        if (driver.status === 'active') {
            ctx.fillStyle = color;
            ctx.globalAlpha = 0.15;
            ctx.beginPath();
            ctx.arc(pix.x, pix.y, pulseRadius * 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1.0;
        }

        // C. Draw Core Marker
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(pix.x, pix.y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#0c101d';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // D. Draw Driver Label
        ctx.fillStyle = '#f3f4f6';
        ctx.font = 'bold 11px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'left';
        const labelText = driver.name.split(' ')[0];
        ctx.fillText(labelText, pix.x + 12, pix.y + 4);
    });
}

// Start Session Initialization and Map Render Loop
logMessage('SYSTEM', 'Fleet Dashboard loaded. Initializing session...');
initSession();
drawMap();
