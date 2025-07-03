let socket = null;
let isConnected = false;
let esp32Connected = false;
let voltageChart = null;
let energyChart = null;
let currentMode = 'demo';

// Initialize connection
function initializeWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    socket = new WebSocket(wsUrl);
    
    socket.onopen = function() {
        console.log('Connected to server');
        isConnected = true;
        updateConnectionStatus(true);
    };
    
    socket.onmessage = function(event) {
        try {
            const message = JSON.parse(event.data);
            
            if (message.type === 'data') {
                updateDashboard(message.data);
            } else if (message.type === 'status') {
                esp32Connected = message.esp32Connected || message.esp8266Connected; // Support both for backward compatibility
                updateESP32Status(esp32Connected);
            } else if (message.type === 'mode_change') {
                currentMode = message.mode;
                console.log(`Mode changed to: ${currentMode}`);
            }
        } catch (e) {
            console.error('Error parsing message:', e);
        }
    };
    
    socket.onclose = function() {
        console.log('Disconnected from server');
        isConnected = false;
        esp32Connected = false;
        updateConnectionStatus(false);
        updateESP32Status(false);
        
        // Attempt to reconnect after 3 seconds
        setTimeout(initializeWebSocket, 3000);
    };
    
    socket.onerror = function(error) {
        console.error('WebSocket error:', error);
    };
}

// Update connection status indicator
function updateConnectionStatus(connected) {
    const statusElement = document.getElementById('connection-status');
    if (connected) {
        statusElement.textContent = 'Server: Connected';
        statusElement.className = 'connected';
    } else {
        statusElement.textContent = 'Server: Disconnected';
        statusElement.className = 'disconnected';
    }
}

// Update ESP32 status indicator
function updateESP32Status(connected) {
    const statusElement = document.getElementById('esp32-status');
    if (connected) {
        statusElement.textContent = 'ESP32: Connected';
        statusElement.className = 'connected';
        currentMode = 'live';
    } else {
        statusElement.textContent = 'ESP32: Disconnected';
        statusElement.className = 'disconnected';
        if (currentMode === 'live') {
            currentMode = 'demo';
        }
    }
}

// Update dashboard with new data
function updateDashboard(data) {
    // Update voltage
    const voltageElement = document.getElementById('voltage-value');
    voltageElement.textContent = data.voltage.toFixed(2);
    animateValueUpdate(voltageElement);
    
    // Update pass count
    const passCountElement = document.getElementById('pass-count-value');
    passCountElement.textContent = data.passCount;
    animateValueUpdate(passCountElement);
    
    // Update energy
    const energyElement = document.getElementById('energy-value');
    energyElement.textContent = data.energy.toFixed(4);
    animateValueUpdate(energyElement);
    
    // Update charts if they exist
    if (data.insights && data.insights.timeSeriesData) {
        if (voltageChart) {
            updateVoltageChart(data.insights.timeSeriesData);
        }
        if (energyChart) {
            updateEnergyChart(data.insights.timeSeriesData);
        }
    }
}

// Animate value updates
function animateValueUpdate(element) {
    element.classList.add('updated');
    setTimeout(() => {
        element.classList.remove('updated');
    }, 1000);
}

// Initialize voltage chart
function initializeVoltageChart() {
    const ctx = document.getElementById('voltage-chart').getContext('2d');
    
    voltageChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Voltage (V)',
                data: [],
                borderColor: '#64ffda',
                backgroundColor: 'rgba(100, 255, 218, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: {
                        color: '#e6f1ff'
                    }
                }
            },
            scales: {
                x: {
                    display: true,
                    title: {
                        display: true,
                        text: 'Time',
                        color: '#e6f1ff'
                    },
                    ticks: {
                        color: '#a8b2d1',
                        callback: function(value, index) {
                            // Show only every 5th label to avoid crowding
                            return index % 5 === 0 ? this.getLabelForValue(value) : '';
                        }
                    },
                    grid: {
                        color: 'rgba(168, 178, 209, 0.1)'
                    }
                },
                y: {
                    display: true,
                    title: {
                        display: true,
                        text: 'Voltage (V)',
                        color: '#e6f1ff'
                    },
                    ticks: {
                        color: '#a8b2d1'
                    },
                    grid: {
                        color: 'rgba(168, 178, 209, 0.1)'
                    },
                    min: 0
                }
            },
            elements: {
                point: {
                    radius: 2,
                    hoverRadius: 4
                }
            }
        }
    });
}

// Initialize energy chart
function initializeEnergyChart() {
    const ctx = document.getElementById('energy-chart').getContext('2d');
    
    energyChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Energy (J)',
                data: [],
                borderColor: '#ffd700',
                backgroundColor: 'rgba(255, 215, 0, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: {
                        color: '#e6f1ff'
                    }
                }
            },
            scales: {
                x: {
                    display: true,
                    title: {
                        display: true,
                        text: 'Time',
                        color: '#e6f1ff'
                    },
                    ticks: {
                        color: '#a8b2d1',
                        callback: function(value, index) {
                            // Show only every 5th label to avoid crowding
                            return index % 5 === 0 ? this.getLabelForValue(value) : '';
                        }
                    },
                    grid: {
                        color: 'rgba(168, 178, 209, 0.1)'
                    }
                },
                y: {
                    display: true,
                    title: {
                        display: true,
                        text: 'Energy (J)',
                        color: '#e6f1ff'
                    },
                    ticks: {
                        color: '#a8b2d1'
                    },
                    grid: {
                        color: 'rgba(168, 178, 209, 0.1)'
                    },
                    min: 0
                }
            },
            elements: {
                point: {
                    radius: 2,
                    hoverRadius: 4
                }
            }
        }
    });
}

// Update voltage chart with new data
function updateVoltageChart(timeSeriesData) {
    if (!voltageChart || !timeSeriesData) return;
    
    const timestamps = timeSeriesData.timestamps.map(ts => {
        const date = new Date(ts);
        return date.toLocaleTimeString();
    });
    
    voltageChart.data.labels = timestamps;
    voltageChart.data.datasets[0].data = timeSeriesData.voltage;
    voltageChart.update('none'); // No animation for real-time updates
}

// Update energy chart with new data
function updateEnergyChart(timeSeriesData) {
    if (!energyChart || !timeSeriesData) return;
    
    const timestamps = timeSeriesData.timestamps.map(ts => {
        const date = new Date(ts);
        return date.toLocaleTimeString();
    });
    
    energyChart.data.labels = timestamps;
    energyChart.data.datasets[0].data = timeSeriesData.energy;
    energyChart.update('none'); // No animation for real-time updates
}

// Add icons to widgets
function addWidgetIcons() {
    // Voltage icon (⚡)
    document.getElementById('voltage-icon').innerHTML = '⚡';
    
    // Pass count icon (🚗)
    document.getElementById('pass-count-icon').innerHTML = '🚗';
    
    // Energy icon (🔋)
    document.getElementById('energy-icon').innerHTML = '🔋';
}

// Initialize everything when page loads
document.addEventListener('DOMContentLoaded', function() {
    console.log('ESP32 Piezoelectric Monitor initialized');
    
    // Add icons to widgets
    addWidgetIcons();
    
    // Initialize charts
    initializeVoltageChart();
    initializeEnergyChart();
    
    // Initialize WebSocket connection
    initializeWebSocket();
    
    // Real-time toggle functionality for voltage chart
    const realtimeToggle = document.getElementById('realtime-toggle');
    if (realtimeToggle) {
        realtimeToggle.addEventListener('click', function() {
            // This button is now just for display, real-time is always active
            console.log('Real-time mode is always active when ESP32 is connected');
        });
    }
    
    // Real-time toggle functionality for energy chart
    const energyRealtimeToggle = document.getElementById('energy-realtime-toggle');
    if (energyRealtimeToggle) {
        energyRealtimeToggle.addEventListener('click', function() {
            // This button is now just for display, real-time is always active
            console.log('Energy chart real-time mode is always active when ESP32 is connected');
        });
    }
});

// Handle page visibility changes to maintain connection
document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
        // Page is hidden, consider reducing update frequency
        console.log('Page hidden');
    } else {
        // Page is visible, ensure connection is active
        console.log('Page visible');
        if (!isConnected) {
            initializeWebSocket();
        }
    }
});