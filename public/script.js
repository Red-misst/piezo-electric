// Simple icon replacements
const icons = {
    voltage: '⚡',
    car: '🚗',
    battery: '🔋',
    wifiOn: '📶',
    wifiOff: '📵'
};

// WebSocket connection
let socket;
let isConnected = false;
let esp8266Connected = false;
let voltageChart, energyPowerChart;
let voltageData = [];
let timestamps = [];
let energyData = [];
let powerData = [];
let historyData = {};
const MAX_DATA_POINTS = 50;
let isRealtime = true;
let timeRange = 1; // minutes
let currentMode = 'demo'; // Default to demo mode
let currentChartType = 'energy'; // Default chart type

// DOM elements
const voltageValue = document.getElementById('voltage-value');
const passCountValue = document.getElementById('pass-count-value');
const energyValue = document.getElementById('energy-value');
const connectionStatus = document.getElementById('connection-status');
const esp8266Status = document.getElementById('esp8266-status');
const voltageIcon = document.getElementById('voltage-icon');
const passCountIcon = document.getElementById('pass-count-icon');
const energyIcon = document.getElementById('energy-icon');
const realtimeToggle = document.getElementById('realtime-toggle');
const timeRangeSelect = document.getElementById('time-range');
const liveModeBtn = document.getElementById('live-mode-btn');
const demoModeBtn = document.getElementById('demo-mode-btn');
const energyChartTypeBtn = document.getElementById('energy-chart-type');
const peakVoltageValue = document.getElementById('peak-voltage');
const avgEnergyValue = document.getElementById('avg-energy');

// Render simple icons
function renderIcons() {
    voltageIcon.textContent = icons.voltage;
    passCountIcon.textContent = icons.car;
    energyIcon.textContent = icons.battery;

    // Style the icons
    [voltageIcon, passCountIcon, energyIcon].forEach(icon => {
        icon.style.fontSize = '30px';
        icon.style.display = 'flex';
        icon.style.alignItems = 'center';
        icon.style.justifyContent = 'center';
    });
}

// Initialize Chart.js
function initCharts() {
    initVoltageChart();
    initEnergyPowerChart();
}

// Initialize Voltage Chart
function initVoltageChart() {
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
            maintainAspectRatio: false,
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

// Initialize Energy/Power Chart
function initEnergyPowerChart() {
    const ctx = document.getElementById('energy-power-chart').getContext('2d');
    
    const energyGradient = ctx.createLinearGradient(0, 0, 0, 300);
    energyGradient.addColorStop(0, 'rgba(255, 215, 0, 0.3)');
    energyGradient.addColorStop(1, 'rgba(255, 215, 0, 0)');
    
    const powerGradient = ctx.createLinearGradient(0, 0, 0, 300);
    powerGradient.addColorStop(0, 'rgba(255, 99, 132, 0.3)');
    powerGradient.addColorStop(1, 'rgba(255, 99, 132, 0)');
    
    energyPowerChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Energy (J)',
                    data: [],
                    borderColor: '#ffd700',
                    backgroundColor: energyGradient,
                    borderWidth: 2,
                    tension: 0.4,
                    fill: true,
                    hidden: false,
                    pointRadius: 3,
                    pointBackgroundColor: '#ffd700',
                    pointBorderColor: '#112240'
                },
                {
                    label: 'Power (W)',
                    data: [],
                    borderColor: '#ff6384',
                    backgroundColor: powerGradient,
                    borderWidth: 2,
                    tension: 0.4,
                    fill: true,
                    hidden: true,
                    pointRadius: 3,
                    pointBackgroundColor: '#ff6384',
                    pointBorderColor: '#112240'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
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
                    titleColor: '#ffd700',
                    bodyColor: '#e6f1ff',
                    borderColor: '#ffd700',
                    borderWidth: 1,
                    padding: 10
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
                        maxRotation: 0
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
                }
            },
            animation: {
                duration: 300
            }
        }
    });
}

// Format timestamp for chart label
function formatTimestamp(date) {
    if (typeof date === 'string') {
        date = new Date(date);
    }
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

// Update voltage chart with new data
function updateVoltageChart(voltageValue, timestamp) {
    const now = timestamp ? new Date(timestamp) : new Date();
    timestamps.push(now);
    voltageData.push(voltageValue);
    
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

// Update energy/power chart
function updateEnergyPowerChart(energyValue, powerValue, timestamp) {
    const now = timestamp ? new Date(timestamp) : new Date();
    
    // Only keep number of points based on selected time range
    if (energyData.length >= MAX_DATA_POINTS) {
        energyData.shift();
        powerData.shift();
        energyPowerChart.data.labels.shift();
    }
    
    energyData.push(energyValue);
    powerData.push(powerValue);
    
    energyPowerChart.data.labels.push(formatTimestamp(now));
    energyPowerChart.data.datasets[0].data = energyData;
    energyPowerChart.data.datasets[1].data = powerData;
    
    // Update chart visibility based on current selection
    energyPowerChart.data.datasets[0].hidden = (currentChartType !== 'energy');
    energyPowerChart.data.datasets[1].hidden = (currentChartType !== 'power');
    
    // Update chart title based on current type
    const chartTitle = currentChartType === 'energy' ? 'Energy (J)' : 'Power (W)';
    energyPowerChart.data.datasets[0].label = 'Energy (J)';
    energyPowerChart.data.datasets[1].label = 'Power (W)';
    
    energyPowerChart.update('none');
}

// Clear chart data
function clearChart() {
    timestamps = [];
    voltageData = [];
    energyData = [];
    powerData = [];
    voltageChart.data.labels = [];
    voltageChart.data.datasets[0].data = [];
    energyPowerChart.data.labels = [];
    energyPowerChart.data.datasets[0].data = [];
    energyPowerChart.data.datasets[1].data = [];
    voltageChart.update();
    energyPowerChart.update();
}

// Reset all UI values to zero
function resetUIValues() {
    voltageValue.textContent = '0.00';
    passCountValue.textContent = '0';
    energyValue.textContent = '0.0000';
    peakVoltageValue.textContent = '0 V';
    avgEnergyValue.textContent = '0 J';
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
    
    // Get insights from data
    const insights = data.insights || {};
    
    // Update mode buttons to reflect current mode
    updateModeButtons(data.mode || currentMode);
    
    // Update title based on mode
    updateChartTitle(data.mode || currentMode);
    
    // Update only if values have changed
    if (voltageValue.textContent !== formattedVoltage) {
        voltageValue.textContent = formattedVoltage;
        animateValue(voltageValue);
        if (isRealtime && insights.timeSeriesData) {
            // Use the latest timestamp and voltage from the timeseries data if available
            const timestampData = insights.timeSeriesData.timestamps;
            const voltageHistory = insights.timeSeriesData.voltage;
            if (timestampData && voltageHistory && 
                timestampData.length > 0 && voltageHistory.length > 0) {
                
                const lastIndex = timestampData.length - 1;
                updateVoltageChart(voltageHistory[lastIndex], timestampData[lastIndex]);
            } else {
                updateVoltageChart(data.voltage);
            }
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
    
    // Update insights if available
    if (insights) {
        peakVoltageValue.textContent = `${insights.peakVoltage?.toFixed(2) || '0'} V`;
        avgEnergyValue.textContent = `${insights.avgEnergyPerVehicle?.toFixed(6) || '0'} J`;
        
        // Update energy/power chart if timeseries data is available
        if (insights.timeSeriesData && 
            insights.timeSeriesData.timestamps && 
            insights.timeSeriesData.energy &&
            insights.timeSeriesData.power) {
            
            const timestamps = insights.timeSeriesData.timestamps;
            const energy = insights.timeSeriesData.energy;
            const power = insights.timeSeriesData.power;
            
            if (timestamps.length > 0) {
                // Get the last data point to update chart
                const lastIndex = timestamps.length - 1;
                updateEnergyPowerChart(
                    energy[lastIndex], 
                    power[lastIndex], 
                    timestamps[lastIndex]
                );
            }
        }
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

// Process historical data for analysis
function processHistoricalData(data) {
    if (!data || !data.timestamps || data.timestamps.length === 0) {
        console.log('No historical data available');
        return;
    }
    
    historyData = data;
    console.log('Historical data received:', data);
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
            
            // Request historical data
            socket.send(JSON.stringify({
                type: 'getHistory'
            }));
            
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
                } else if (message.type === 'history') {
                    processHistoricalData(message.data);
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

// Chart type toggle
energyChartTypeBtn.addEventListener('click', function() {
    currentChartType = 'energy';
    energyChartTypeBtn.classList.add('active');
    
    energyPowerChart.data.datasets[0].hidden = false;
    energyPowerChart.data.datasets[1].hidden = true;
    energyPowerChart.update();
});

// Initialize the application
function init() {
    console.log('Initializing application...');
    renderIcons();
    initCharts();
    
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
