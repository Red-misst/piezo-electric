// Simple icon replacements (since React Icons is causing issues)
const icons = {
    voltage: '⚡',
    car: '🚗',
    battery: '🔋',
    clock: '🕐',
    wifiOn: '📶',
    wifiOff: '📵'
};

// WebSocket connection
let socket;
let isConnected = false;
let esp8266Connected = false;
let voltageChart;
let voltageData = [];
let timestamps = [];
const MAX_DATA_POINTS = 50;
let isRealtime = true;
let timeRange = 1; // minutes
let currentMode = 'demo'; // Default to demo mode

// DOM elements
const voltageValue = document.getElementById('voltage-value');
const passCountValue = document.getElementById('pass-count-value');
const energyValue = document.getElementById('energy-value');
const runtimeValue = document.getElementById('runtime-value');
const connectionStatus = document.getElementById('connection-status');
const esp8266Status = document.getElementById('esp8266-status');
const voltageIcon = document.getElementById('voltage-icon');
const passCountIcon = document.getElementById('pass-count-icon');
const energyIcon = document.getElementById('energy-icon');
const runtimeIcon = document.getElementById('runtime-icon');
const realtimeToggle = document.getElementById('realtime-toggle');
const timeRangeSelect = document.getElementById('time-range');
const liveModeBtn = document.getElementById('live-mode-btn');
const demoModeBtn = document.getElementById('demo-mode-btn');

// Render simple icons
function renderIcons() {
    voltageIcon.textContent = icons.voltage;
    passCountIcon.textContent = icons.car;
    energyIcon.textContent = icons.battery;
    runtimeIcon.textContent = icons.clock;
    
    // Style the icons
    [voltageIcon, passCountIcon, energyIcon, runtimeIcon].forEach(icon => {
        icon.style.fontSize = '30px';
        icon.style.display = 'flex';
        icon.style.alignItems = 'center';
        icon.style.justifyContent = 'center';
    });
}

// Initialize Chart.js
function initChart() {
    const ctx = document.getElementById('voltage-chart').getContext('2d');
    
    const gradientFill = ctx.createLinearGradient(0, 0, 0, 300);
    gradientFill.addColorStop(0, 'rgba(100, 255, 218, 0.3)');
    gradientFill.addColorStop(1, 'rgba(100, 255, 218, 0)');
    
    voltageChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Voltage (V)',
                data: [],
                borderColor: '#64ffda',
                backgroundColor: gradientFill,
                borderWidth: 2,
                tension: 0.4,
                fill: true,
                pointRadius: 3,
                pointBackgroundColor: '#64ffda',
                pointBorderColor: '#112240',
                pointHoverRadius: 5,
                pointHoverBackgroundColor: '#ffd700',
                pointHoverBorderColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false, // Allow height control
            interaction: {
                intersect: false,
                mode: 'index'
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        color: '#a8b2d1',
                        font: {
                            family: 'Segoe UI',
                            size: 12
                        }
                    }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(27, 45, 69, 0.9)',
                    titleColor: '#64ffda',
                    bodyColor: '#e6f1ff',
                    borderColor: '#64ffda',
                    borderWidth: 1,
                    padding: 10,
                    titleFont: {
                        family: 'Segoe UI',
                        size: 14,
                        weight: 'bold'
                    },
                    bodyFont: {
                        family: 'Segoe UI',
                        size: 12
                    },
                    displayColors: false
                }
            },
            scales: {
                x: {
                    display: true,
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    },
                    ticks: {
                        color: '#a8b2d1',
                        maxRotation: 0,
                        callback: function(value, index, values) {
                            const label = this.getLabelForValue(value);
                            if (label && index % Math.ceil(values.length / 5) === 0) {
                                return label.includes(':') ? label : '';
                            }
                            return '';
                        }
                    }
                },
                y: {
                    display: true,
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    },
                    ticks: {
                        color: '#a8b2d1'
                    }
                    // Remove fixed min/max to allow dynamic scaling
                }
            },
            animation: {
                duration: 300
            },
            elements: {
                point: {
                    radius: 2
                }
            }
        }
    });
}

// Format timestamp for chart label
function formatTimestamp(date) {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

// Calculate dynamic Y-axis range based on data
function calculateYAxisRange(data) {
    if (data.length === 0) {
        return { min: 0, max: 5 }; // Default range when no data
    }
    
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min;
    
    // Add 15% padding on each side for better visualization
    const padding = Math.max(range * 0.15, 0.1); // Minimum padding of 0.1
    
    return {
        min: Math.max(0, min - padding), // Don't go below 0
        max: max + padding
    };
}

// Update chart with new voltage value
function updateChart(voltage) {
    const now = new Date();
    timestamps.push(now);
    voltageData.push(voltage);
    
    // Remove old data points to maintain the correct range
    const cutoffTime = new Date(now.getTime() - timeRange * 60 * 1000);
    while (timestamps.length > 0 && timestamps[0] < cutoffTime) {
        timestamps.shift();
        voltageData.shift();
    }
    
    // Calculate dynamic Y-axis range
    const yRange = calculateYAxisRange(voltageData);
    
    // Update chart
    voltageChart.data.labels = timestamps.map(formatTimestamp);
    voltageChart.data.datasets[0].data = voltageData;
    
    // Update Y-axis range dynamically
    voltageChart.options.scales.y.min = yRange.min;
    voltageChart.options.scales.y.max = yRange.max;
    
    voltageChart.update('none'); // Use 'none' to disable animation for better performance
}

// Clear chart data
function clearChart() {
    timestamps = [];
    voltageData = [];
    voltageChart.data.labels = [];
    voltageChart.data.datasets[0].data = [];
    voltageChart.update();
}

// Reset all UI values to zero
function resetUIValues() {
    voltageValue.textContent = '0.00';
    passCountValue.textContent = '0';
    energyValue.textContent = '0.0000';
    runtimeValue.textContent = '0.0';
    clearChart();
    console.log('UI values reset to zero');
}

// Add animation effect to updated values
function animateValue(element) {
    element.classList.add('updated');
    setTimeout(() => {
        element.classList.remove('updated');
    }, 1000);
}

// Update UI with new data
function updateUI(data) {
    console.log('Updating UI with data:', data);
    
    // Format values with appropriate precision
    const formattedVoltage = data.voltage.toFixed(2);
    const formattedEnergy = data.energy.toFixed(4);
    const formattedRuntime = data.estimatedRuntime.toFixed(1);
    
    // Update mode buttons to reflect current mode
    updateModeButtons(data.mode || currentMode);
    
    // Update title based on mode
    updateChartTitle(data.mode || currentMode);
    
    // Update only if values have changed
    if (voltageValue.textContent !== formattedVoltage) {
        voltageValue.textContent = formattedVoltage;
        animateValue(voltageValue);
        if (isRealtime) {
            updateChart(data.voltage);
        }
    }
    
    if (passCountValue.textContent !== data.passCount.toString()) {
        passCountValue.textContent = data.passCount;
        animateValue(passCountValue);
    }
    
    if (energyValue.textContent !== formattedEnergy) {
        energyValue.textContent = formattedEnergy;
        animateValue(energyValue);
    }
    
    if (runtimeValue.textContent !== formattedRuntime) {
        runtimeValue.textContent = formattedRuntime;
        animateValue(runtimeValue);
    }
}

function updateChartTitle(mode) {
    const chartTitle = document.querySelector('.chart-header h2');
    if (chartTitle) {
        chartTitle.textContent = mode === 'demo' ? 'Voltage History (Historical Test)' : 'Voltage History (Live Data)';
    }
}

function updateModeButtons(mode) {
    const previousMode = currentMode;
    currentMode = mode;
    
    if (mode === 'live') {
        liveModeBtn.classList.add('active');
        demoModeBtn.classList.remove('active');
        
        // Reset values when switching to live mode
        if (previousMode !== 'live') {
            resetUIValues();
        }
    } else { // demo mode
        demoModeBtn.classList.add('active');
        liveModeBtn.classList.remove('active');
    }
}

function updateConnectionStatus(connected) {
    isConnected = connected;
    connectionStatus.className = connected ? 'connected' : 'disconnected';
    connectionStatus.textContent = `${icons.wifiOn} Server: ${connected ? 'Connected' : 'Disconnected'}`;
    console.log(`Server connection status: ${connected ? 'Connected' : 'Disconnected'}`);
}

function updateESP8266Status(connected, lastSeen) {
    esp8266Connected = connected;
    esp8266Status.className = connected ? 'connected' : 'disconnected';
    
    let statusText = `${connected ? icons.wifiOn : icons.wifiOff} ESP8266: ${connected ? 'Connected' : 'Disconnected'}`;
    if (!connected && lastSeen) {
        const timeSince = Math.floor((Date.now() - new Date(lastSeen).getTime()) / 1000);
        statusText += ` (${timeSince}s ago)`;
    }
    
    esp8266Status.textContent = statusText;
    console.log(`ESP8266 connection status: ${connected ? 'Connected' : 'Disconnected'}`);
}

// Switch monitoring mode
function switchMode(mode) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        console.log(`Switching from ${currentMode} to ${mode} mode`);
        
        // If switching to live mode, reset everything first
        if (mode === 'live' && currentMode !== 'live') {
            resetUIValues();
        }
        
        socket.send(JSON.stringify({
            type: 'mode',
            mode: mode
        }));
        
        console.log(`Requesting switch to ${mode} mode`);
    } else {
        console.error('Cannot switch mode: WebSocket not connected');
    }
}

// Connect to WebSocket server
function connectWebSocket() {
    return new Promise((resolve, reject) => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        const wsUrl = `${protocol}//${host}`;
        
        console.log(`Attempting to connect to WebSocket: ${wsUrl}`);
        socket = new WebSocket(wsUrl);
        
        socket.onopen = function() {
            updateConnectionStatus(true);
            console.log('WebSocket connection established successfully');
            resolve(socket);
        };
        
        socket.onmessage = function(event) {
            try {
                const message = JSON.parse(event.data);
                console.log('Received message:', message);
                
                if (message.type === 'data') {
                    updateUI(message.data);
                } else if (message.type === 'mode_change') {
                    updateModeButtons(message.mode);
                    console.log(`Mode changed to: ${message.mode}`);
                } else if (message.type === 'status') {
                    updateESP8266Status(message.esp8266Connected, message.esp8266LastSeen);
                }
            } catch (error) {
                console.error('Error processing message:', error, 'Raw data:', event.data);
            }
        };
        
        socket.onclose = function(event) {
            updateConnectionStatus(false);
            updateESP8266Status(false);
            console.log('WebSocket connection closed. Code:', event.code, 'Reason:', event.reason);
            
            // Try to reconnect after 3 seconds
            setTimeout(() => {
                console.log('Attempting to reconnect...');
                connectWebSocket().catch(console.error);
            }, 3000);
            reject(new Error('WebSocket connection closed'));
        };
        
        socket.onerror = function(error) {
            updateConnectionStatus(false);
            updateESP8266Status(false);
            console.error('WebSocket error:', error);
            reject(error);
        };
    });
}

// Event listeners for controls
realtimeToggle.addEventListener('click', function() {
    isRealtime = !isRealtime;
    this.classList.toggle('active');
});

timeRangeSelect.addEventListener('change', function() {
    timeRange = parseInt(this.value);
    
    // Clear the current data when time range changes
    const now = new Date();
    const cutoffTime = new Date(now.getTime() - timeRange * 60 * 1000);
    
    // Filter existing data based on new time range
    const newTimestamps = [];
    const newVoltageData = [];
    
    for (let i = 0; i < timestamps.length; i++) {
        if (timestamps[i] >= cutoffTime) {
            newTimestamps.push(timestamps[i]);
            newVoltageData.push(voltageData[i]);
        }
    }
    
    timestamps = newTimestamps;
    voltageData = newVoltageData;
    
    // Calculate dynamic Y-axis range for filtered data
    const yRange = calculateYAxisRange(voltageData);
    
    // Update chart with dynamic scale
    voltageChart.data.labels = timestamps.map(formatTimestamp);
    voltageChart.data.datasets[0].data = voltageData;
    voltageChart.options.scales.y.min = yRange.min;
    voltageChart.options.scales.y.max = yRange.max;
    voltageChart.update();
});

// Mode switching buttons
liveModeBtn.addEventListener('click', function() {
    if (currentMode !== 'live') {
        switchMode('live');
    }
});

demoModeBtn.addEventListener('click', function() {
    if (currentMode !== 'demo') {
        switchMode('demo');
    }
});

// Initialize the application
function init() {
    console.log('Initializing application...');
    renderIcons();
    initChart();
    
    // Initial status
    updateConnectionStatus(false);
    updateESP8266Status(false);
    updateModeButtons('demo');
    updateChartTitle('demo');
    
    // Connect to WebSocket
    connectWebSocket().catch(error => {
        console.error('Failed to establish initial WebSocket connection:', error);
    });
}

// Start the application when the document is loaded
document.addEventListener('DOMContentLoaded', init);
