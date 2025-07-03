const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

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
  voltage: 0,
  passCount: 0, 
  energy: 0,
  estimatedRuntime: 0,
  mode: 'demo' // Add mode field to indicate data source
};

// Power insights data
let powerInsights = {
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

// Battery specifications
const BATTERY_CAPACITY = 4800; // mAh
const BATTERY_VOLTAGE = 3.7; // V
const BATTERY_ENERGY_CAPACITY = BATTERY_VOLTAGE * BATTERY_CAPACITY / 1000 * 3600; // Joules

// Track connected clients and ESP8266
const webClients = new Set();
let esp8266Client = null;
let esp8266LastSeen = null;

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)){
  fs.mkdirSync(logsDir);
}

// Logger function for ESP32 data
function logESP32Data(data) {
  const timestamp = new Date().toISOString();
  const logData = {
    timestamp,
    ...data
  };
  
  const logFilePath = path.join(logsDir, `esp32_data_${new Date().toISOString().split('T')[0]}.log`);
  fs.appendFile(
    logFilePath, 
    JSON.stringify(logData) + '\n', 
    err => {
      if (err) console.error('Error writing to log file:', err);
    }
  );
  
  console.log('ESP32 DATA RECEIVED:', JSON.stringify(logData));
}

// Function to generate random fluctuations for demo data
function generateDemoData() {
  const now = Date.now();
  const timeDelta = (now - powerInsights.lastUpdateTime) / 1000; // seconds
  
  // Simulate voltage fluctuation between 2V and 7.2V
  latestData.voltage = Math.max(2.0, Math.min(7.2, latestData.voltage + (Math.random() - 0.5) * 0.5));
  
  // Occasionally increment pass count (about 20% of the time)
  if (Math.random() < 0.2) {
    latestData.passCount++;
    
    // Bigger energy spike when vehicle passes (adjusted for 470µF capacitor)
    const energyGain = 0.00006 + Math.random() * 0.00009;  // Smaller energy gain for 470µF
    latestData.energy += energyGain;
    powerInsights.totalEnergy += energyGain;
  }
  
  // Calculate energy using E = 0.5 * C * V^2 (470µF capacitor)
  const capacitance = 0.00047; // 470µF in Farads
  latestData.energy = 0.5 * capacitance * Math.pow(latestData.voltage, 2);
  
  // Calculate estimated runtime based on energy (LED power ~0.1W)
  const ledPower = 0.1; // Watts
  latestData.estimatedRuntime = latestData.energy / ledPower;
  
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

// Broadcast status update to all web clients
function broadcastStatus() {
  const statusMessage = JSON.stringify({
    type: 'status',
    // Update to use ESP32 naming
    esp32Connected: esp8266Client !== null && esp8266Client.readyState === WebSocket.OPEN,
    esp32LastSeen: esp8266LastSeen,
    // Keep original names for backward compatibility
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
  
  // Determine if this is ESP32/ESP8266 or web client based on User-Agent or a custom header
  const userAgent = req.headers['user-agent'] || '';
  const isESP = userAgent.includes('ESP8266') || 
                userAgent.includes('ESP32') || 
                req.headers['x-client-type'] === 'esp8266' || 
                req.headers['x-client-type'] === 'esp32';
  
  if (isESP) {
    console.log('ESP32 device connected');
    esp8266Client = ws;
    esp8266LastSeen = new Date();
    
    // Reset energy when ESP first connects
    if (latestData.mode !== 'live') {
      powerInsights.totalEnergy = 0;
      latestData.energy = 0;
    }
    
    // Mark as live mode when ESP connects
    latestData.mode = 'live';
    
    // Notify all web clients about ESP connection
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
    
    // Send current status
    const statusMessage = JSON.stringify({
      type: 'status',
      esp32Connected: esp8266Client !== null && esp8266Client.readyState === WebSocket.OPEN,
      esp32LastSeen: esp8266LastSeen
    });
    ws.send(statusMessage);
  }
  
  // Handle messages from clients
  ws.on('message', (message) => {
    try {
      const parsedMessage = JSON.parse(message);
      
      if (isESP) {
        // Log ESP32 data
        logESP32Data(parsedMessage);
        
        // Handle ESP32 data
        if (parsedMessage.voltage !== undefined && parsedMessage.passCount !== undefined) {
          
          esp8266LastSeen = new Date();
          
          // Capture previous values for calculations
          const prevPassCount = latestData.passCount || 0;
          const prevEnergy = latestData.energy || 0;
          const now = Date.now();
          const timeDelta = (now - powerInsights.lastUpdateTime) / 1000; // seconds
          
          // Calculate energy using capacitor formula if not provided
          const capacitance = 0.00047; // 470µF in Farads
          const calculatedEnergy = 0.5 * capacitance * Math.pow(parsedMessage.voltage, 2);
          
          // Update latest data
          latestData = {
            voltage: parsedMessage.voltage,
            passCount: parsedMessage.passCount,
            energy: parsedMessage.energy || calculatedEnergy,
            estimatedRuntime: parsedMessage.estimatedRuntime || (calculatedEnergy / 0.1),
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
          
          console.log('Received data from ESP32:', latestData);
          
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
          }
        }
      }
    } catch (e) {
      console.error('Error parsing message:', e);
    }
  });
  
  ws.on('close', () => {
    if (isESP) {
      console.log('ESP32 disconnected');
      esp8266Client = null;
      
      // Switch back to demo mode when ESP32 disconnects
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
    if (isESP) {
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

// Check ESP32 connection health every 30 seconds
setInterval(() => {
  if (esp8266Client && esp8266LastSeen) {
    const timeSinceLastSeen = Date.now() - esp8266LastSeen.getTime();
    if (timeSinceLastSeen > 60000) { // 1 minute timeout
      console.log('ESP32 timeout detected');
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
