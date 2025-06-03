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

// Track connected clients and ESP8266
const webClients = new Set();
let esp8266Client = null;
let esp8266LastSeen = null;

// Function to generate random fluctuations for demo data
function generateDemoData() {
  // Simulate voltage fluctuation between 2.8V and 3.6V
  latestData.voltage = Math.max(2.8, Math.min(3.6, latestData.voltage + (Math.random() - 0.5) * 0.2));
  
  // Occasionally increment pass count (about 20% of the time)
  if (Math.random() < 0.2) {
    latestData.passCount++;
    
    // Bigger energy spike when vehicle passes
    latestData.energy += 0.0008 + Math.random() * 0.0012;
  }
  
  // Slowly decrease energy (battery drain simulation)
  latestData.energy = Math.max(0, latestData.energy - 0.0001);
  
  // Calculate estimated runtime based on energy (arbitrary formula)
  latestData.estimatedRuntime = latestData.energy * 4000;
  
  // Round values to reasonable precision
  latestData.voltage = parseFloat(latestData.voltage.toFixed(2));
  latestData.energy = parseFloat(latestData.energy.toFixed(4));
  latestData.estimatedRuntime = parseFloat(latestData.estimatedRuntime.toFixed(1));
  latestData.mode = 'demo'; // Always mark demo data
  
  return latestData;
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
    
    // Mark as live mode when ESP8266 connects
    latestData.mode = 'live';
    
    // Notify all web clients about ESP8266 connection
    broadcastStatus();
  } else {
    console.log('Web client connected');
    webClients.add(ws);
    
    // Send current data and status to newly connected web client
    ws.send(JSON.stringify({ type: 'data', data: latestData }));
    
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
          parsedMessage.mode = 'live';
          latestData = parsedMessage;
          
          console.log('Received data from ESP8266:', latestData);
          
          // Broadcast to all web clients
          broadcastData();
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
            ws.send(JSON.stringify({ type: 'data', data: latestData }));
          }
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
function broadcastData() {
  const data = JSON.stringify({ type: 'data', data: latestData });
  webClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
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
      generateDemoData();
      broadcastData();
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
