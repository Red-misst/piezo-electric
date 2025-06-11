const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

// Initialize Express app
const app = express();
const server = http.createServer(app);

// Serve static files from public folder
app.use(express.static(path.join(__dirname, 'public')));

// Initialize WebSocket server
const wss = new WebSocket.Server({ 
  server,
  clientTracking: true
});

// Store the latest data
let latestData = {
  voltage: 3.2,
  passCount: 24, 
  energy: 0.0123,
  estimatedRuntime: 45.6,
  mode: 'demo' // Add mode field to indicate data source
};

// Power insights data
let powerInsights = {
  totalEnergy: 0.0123,
  avgEnergyPerVehicle: 0.000512,
  peakVoltage: 3.9,
  power: 0.0025,  // Watts
  batteryChargePercent: 0.34, // 0-1 scale
  lastUpdateTime: Date.now(),
  timestamps: [],
  voltageHistory: [],
  energyHistory: [],
  powerHistory: []
};

// Battery specifications
const BATTERY_CAPACITY = 4800; // mAh
const BATTERY_VOLTAGE = 3.7; // V
const BATTERY_ENERGY_CAPACITY = BATTERY_VOLTAGE * BATTERY_CAPACITY / 1000 * 3600; // Joules

// Track connected clients and ESP8266
const webClients = new Set();
let esp8266Client = null;
let esp8266LastSeen = null;

// Historical data storage - limit to last 24 hours with 5-minute intervals
const HISTORY_MAX_POINTS = 288; // 24 hours * 12 points per hour (5-minute intervals)
const historyData = {
  timestamps: [],
  voltage: [],
  energy: [],
  power: [],
  passCount: []
};

// Function to generate random fluctuations for demo data
function generateDemoData() {
  const now = Date.now();
  const timeDelta = (now - powerInsights.lastUpdateTime) / 1000; // seconds
  
  // Simulate voltage fluctuation between 2.8V and 3.6V
  latestData.voltage = Math.max(2.8, Math.min(3.6, latestData.voltage + (Math.random() - 0.5) * 0.2));
  
  // Occasionally increment pass count (about 20% of the time)
  if (Math.random() < 0.2) {
    latestData.passCount++;
    
    // Bigger energy spike when vehicle passes
    const energyGain = 0.0008 + Math.random() * 0.0012;
    latestData.energy += energyGain;
    powerInsights.totalEnergy += energyGain;
  }
  
  // Slowly decrease energy (battery drain simulation)
  latestData.energy = Math.max(0, latestData.energy - 0.0001);
  
  // Calculate estimated runtime based on energy (arbitrary formula)
  latestData.estimatedRuntime = latestData.energy * 4000;
  
  // Update power insights
  powerInsights.avgEnergyPerVehicle = latestData.passCount > 0 ? 
    powerInsights.totalEnergy / latestData.passCount : 0;
  
  powerInsights.peakVoltage = Math.max(powerInsights.peakVoltage, latestData.voltage);
  
  // Calculate power: change in energy over time
  powerInsights.power = timeDelta > 0 ? latestData.energy / timeDelta : 0;
  
  // Calculate battery charge percentage
  powerInsights.batteryChargePercent = Math.min(1, Math.max(0, 
    powerInsights.totalEnergy / BATTERY_ENERGY_CAPACITY));
  
  // Update timestamps for history
  const currentTime = new Date();
  powerInsights.timestamps.push(currentTime);
  powerInsights.voltageHistory.push(latestData.voltage);
  powerInsights.energyHistory.push(latestData.energy);
  powerInsights.powerHistory.push(powerInsights.power);
  
  // Limit history arrays to last 50 points
  if (powerInsights.timestamps.length > 50) {
    powerInsights.timestamps.shift();
    powerInsights.voltageHistory.shift();
    powerInsights.energyHistory.shift();
    powerInsights.powerHistory.shift();
  }
  
  powerInsights.lastUpdateTime = now;
  
  // Update historical data (every 5 minutes)
  updateHistoricalData();
  
  // Round values to reasonable precision
  latestData.voltage = parseFloat(latestData.voltage.toFixed(2));
  latestData.energy = parseFloat(latestData.energy.toFixed(4));
  latestData.estimatedRuntime = parseFloat(latestData.estimatedRuntime.toFixed(1));
  latestData.mode = 'demo'; // Always mark demo data
  
  // Add power insights to latest data
  const combinedData = {
    ...latestData,
    insights: {
      totalEnergy: parseFloat(powerInsights.totalEnergy.toFixed(4)),
      avgEnergyPerVehicle: parseFloat(powerInsights.avgEnergyPerVehicle.toFixed(6)),
      peakVoltage: parseFloat(powerInsights.peakVoltage.toFixed(2)),
      power: parseFloat(powerInsights.power.toFixed(6)),
      batteryChargePercent: parseFloat(powerInsights.batteryChargePercent.toFixed(2)),
      timeSeriesData: {
        timestamps: powerInsights.timestamps.map(t => t.toISOString()),
        voltage: powerInsights.voltageHistory,
        energy: powerInsights.energyHistory,
        power: powerInsights.powerHistory
      }
    }
  };
  
  return combinedData;
}

// Update historical data at 5-minute intervals
function updateHistoricalData() {
  const now = new Date();
  
  // Only update every 5 minutes
  if (historyData.timestamps.length === 0 || 
      (now - new Date(historyData.timestamps[historyData.timestamps.length-1])) >= 5*60*1000) {
    
    historyData.timestamps.push(now.toISOString());
    historyData.voltage.push(latestData.voltage);
    historyData.energy.push(latestData.energy);
    historyData.power.push(powerInsights.power);
    historyData.passCount.push(latestData.passCount);
    
    // Limit history to HISTORY_MAX_POINTS
    if (historyData.timestamps.length > HISTORY_MAX_POINTS) {
      historyData.timestamps.shift();
      historyData.voltage.shift();
      historyData.energy.shift();
      historyData.power.shift();
      historyData.passCount.shift();
    }
  }
}

// Broadcast status update to all web clients
function broadcastStatus() {
  const statusMessage = JSON.stringify({
    type: 'status',
    esp8266Connected: esp8266Client !== null && esp8266Client.readyState === WebSocket.OPEN,
    esp8266LastSeen: esp8266LastSeen
  });
  
  webClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(statusMessage);
    }
  });
}

// WebSocket server handling
wss.on('connection', (ws, req) => {
  console.log('Client connected from:', req.socket.remoteAddress);
  
  // Determine if this is ESP8266 or web client based on User-Agent or a custom header
  const userAgent = req.headers['user-agent'] || '';
  const isESP8266 = userAgent.includes('ESP8266') || req.headers['x-client-type'] === 'esp8266';
  
  if (isESP8266) {
    console.log('ESP8266 device connected');
    esp8266Client = ws;
    esp8266LastSeen = new Date();
    
    // Reset energy when ESP8266 first connects
    if (latestData.mode !== 'live') {
      powerInsights.totalEnergy = 0;
      latestData.energy = 0;
    }
    
    // Mark as live mode when ESP8266 connects
    latestData.mode = 'live';
    
    // Notify all web clients about ESP8266 connection
    broadcastStatus();
  } else {
    console.log('Web client connected');
    webClients.add(ws);
    
    // Send current data and status to newly connected web client
    const dataToSend = latestData.mode === 'demo' ? generateDemoData() : 
      {
        ...latestData,
        insights: {
          totalEnergy: parseFloat(powerInsights.totalEnergy.toFixed(4)),
          avgEnergyPerVehicle: parseFloat(powerInsights.avgEnergyPerVehicle.toFixed(6)),
          peakVoltage: parseFloat(powerInsights.peakVoltage.toFixed(2)),
          power: parseFloat(powerInsights.power.toFixed(6)),
          batteryChargePercent: parseFloat(powerInsights.batteryChargePercent.toFixed(2)),
          timeSeriesData: {
            timestamps: powerInsights.timestamps.map(t => t.toISOString()),
            voltage: powerInsights.voltageHistory,
            energy: powerInsights.energyHistory,
            power: powerInsights.powerHistory
          }
        }
      };
    
    ws.send(JSON.stringify({ type: 'data', data: dataToSend }));
    
    // Send historical data
    ws.send(JSON.stringify({
      type: 'history',
      data: historyData
    }));
    
    // Send current status
    const statusMessage = JSON.stringify({
      type: 'status',
      esp8266Connected: esp8266Client !== null && esp8266Client.readyState === WebSocket.OPEN,
      esp8266LastSeen: esp8266LastSeen
    });
    ws.send(statusMessage);
  }
  
  // Handle messages from clients
  ws.on('message', (message) => {
    try {
      const parsedMessage = JSON.parse(message);
      
      if (isESP8266) {
        // Handle ESP8266 data
        if (parsedMessage.voltage !== undefined && 
            parsedMessage.passCount !== undefined &&
            parsedMessage.energy !== undefined &&
            parsedMessage.estimatedRuntime !== undefined) {
          
          esp8266LastSeen = new Date();
          
          // Capture previous values for calculations
          const prevPassCount = latestData.passCount || 0;
          const prevEnergy = latestData.energy || 0;
          const now = Date.now();
          const timeDelta = (now - powerInsights.lastUpdateTime) / 1000; // seconds
          
          // Update latest data
          latestData = {
            ...parsedMessage,
            mode: 'live'
          };
          
          // Calculate energy gain and update total
          const energyGain = Math.max(0, latestData.energy - prevEnergy);
          powerInsights.totalEnergy += energyGain;
          
          // Update power insights
          powerInsights.avgEnergyPerVehicle = latestData.passCount > 0 ? 
            powerInsights.totalEnergy / latestData.passCount : 0;
          
          powerInsights.peakVoltage = Math.max(powerInsights.peakVoltage, latestData.voltage);
          
          // Calculate power: change in energy over time
          powerInsights.power = timeDelta > 0 ? energyGain / timeDelta : 0;
          
          // Calculate battery charge percentage
          powerInsights.batteryChargePercent = Math.min(1, Math.max(0, 
            powerInsights.totalEnergy / BATTERY_ENERGY_CAPACITY));
          
          // Update timestamps for history
          const currentTime = new Date();
          powerInsights.timestamps.push(currentTime);
          powerInsights.voltageHistory.push(latestData.voltage);
          powerInsights.energyHistory.push(latestData.energy);
          powerInsights.powerHistory.push(powerInsights.power);
          
          // Limit history arrays to last 50 points
          if (powerInsights.timestamps.length > 50) {
            powerInsights.timestamps.shift();
            powerInsights.voltageHistory.shift();
            powerInsights.energyHistory.shift();
            powerInsights.powerHistory.shift();
          }
          
          powerInsights.lastUpdateTime = now;
          
          // Update historical data (every 5 minutes)
          updateHistoricalData();
          
          console.log('Received data from ESP8266:', latestData);
          
          // Add power insights to data before broadcasting
          const dataToSend = {
            ...latestData,
            insights: {
              totalEnergy: parseFloat(powerInsights.totalEnergy.toFixed(4)),
              avgEnergyPerVehicle: parseFloat(powerInsights.avgEnergyPerVehicle.toFixed(6)),
              peakVoltage: parseFloat(powerInsights.peakVoltage.toFixed(2)),
              power: parseFloat(powerInsights.power.toFixed(6)),
              batteryChargePercent: parseFloat(powerInsights.batteryChargePercent.toFixed(2)),
              timeSeriesData: {
                timestamps: powerInsights.timestamps.map(t => t.toISOString()),
                voltage: powerInsights.voltageHistory,
                energy: powerInsights.energyHistory,
                power: powerInsights.powerHistory
              }
            }
          };
          
          // Broadcast to all web clients
          broadcastData(dataToSend);
        }
      } else {
        // Handle web client messages
        if (parsedMessage.type === 'mode') {
          console.log(`Web client requested mode switch to: ${parsedMessage.mode}`);
          
          if (parsedMessage.mode === 'live') {
            // Reset data when switching to live mode (unless ESP8266 is connected)
            if (!esp8266Client || esp8266Client.readyState !== WebSocket.OPEN) {
              latestData = {
                voltage: 0,
                passCount: 0,
                energy: 0,
                estimatedRuntime: 0,
                mode: 'live'
              };
              
              powerInsights = {
                totalEnergy: 0,
                avgEnergyPerVehicle: 0,
                peakVoltage: 0,
                power: 0,
                batteryChargePercent: 0,
                lastUpdateTime: Date.now(),
                timestamps: [],
                voltageHistory: [],
                energyHistory: [],
                powerHistory: []
              };
            } else {
              latestData.mode = 'live';
            }
          } else {
            latestData.mode = 'demo';
            // Keep existing demo values, don't reset
          }
          
          // Send immediate response to mode change request
          ws.send(JSON.stringify({
            type: 'mode_change',
            mode: latestData.mode
          }));
          
          // If switching to live mode and no ESP8266, send reset data
          if (parsedMessage.mode === 'live' && (!esp8266Client || esp8266Client.readyState !== WebSocket.OPEN)) {
            const dataToSend = {
              ...latestData,
              insights: {
                totalEnergy: parseFloat(powerInsights.totalEnergy.toFixed(4)),
                avgEnergyPerVehicle: parseFloat(powerInsights.avgEnergyPerVehicle.toFixed(6)),
                peakVoltage: parseFloat(powerInsights.peakVoltage.toFixed(2)),
                power: parseFloat(powerInsights.power.toFixed(6)),
                batteryChargePercent: parseFloat(powerInsights.batteryChargePercent.toFixed(2)),
                timeSeriesData: {
                  timestamps: powerInsights.timestamps.map(t => t.toISOString()),
                  voltage: powerInsights.voltageHistory,
                  energy: powerInsights.energyHistory,
                  power: powerInsights.powerHistory
                }
              }
            };
            ws.send(JSON.stringify({ type: 'data', data: dataToSend }));
          }
        } else if (parsedMessage.type === 'getHistory') {
          // Client requested historical data
          ws.send(JSON.stringify({
            type: 'history',
            data: historyData
          }));
        }
      }
    } catch (e) {
      console.error('Error parsing message:', e);
    }
  });
  
  ws.on('close', () => {
    if (isESP8266) {
      console.log('ESP8266 disconnected');
      esp8266Client = null;
      
      // Switch back to demo mode when ESP8266 disconnects
      latestData.mode = 'demo';
      
      // Notify all web clients
      broadcastStatus();
    } else {
      console.log('Web client disconnected');
      webClients.delete(ws);
    }
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    if (isESP8266) {
      esp8266Client = null;
      broadcastStatus();
    } else {
      webClients.delete(ws);
    }
  });
});

// Broadcast data to all connected web clients
function broadcastData(data) {
  const message = JSON.stringify({ type: 'data', data: data });
  webClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Demo mode - send simulated data every 2 seconds
const DEMO_MODE = true;
let demoInterval = null;

function startDemoMode() {
  if (demoInterval) {
    clearInterval(demoInterval);
  }
  
  demoInterval = setInterval(() => {
    // Only send demo data if we're in demo mode
    if (latestData.mode === 'demo') {
      const demoData = generateDemoData();
      broadcastData(demoData);
    }
  }, 2000);
  
  console.log('Demo mode started');
}

// Check ESP8266 connection health every 30 seconds
setInterval(() => {
  if (esp8266Client && esp8266LastSeen) {
    const timeSinceLastSeen = Date.now() - esp8266LastSeen.getTime();
    if (timeSinceLastSeen > 60000) { // 1 minute timeout
      console.log('ESP8266 timeout detected');
      esp8266Client = null;
      latestData.mode = 'demo';
      broadcastStatus();
    }
  }
}, 30000);

// Initialize demo mode
if (DEMO_MODE) {
  startDemoMode();
}

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Piezoelectric monitor server running on port ${PORT}`);
  console.log(`Demo mode: ${DEMO_MODE ? 'enabled' : 'disabled'}`);
  console.log(`WebSocket server listening for connections...`);
});
