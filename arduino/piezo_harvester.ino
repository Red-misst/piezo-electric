/**
 * Piezoelectric Energy Harvesting Monitoring System
 * 
 * This firmware runs on an ESP8266 to measure voltage output from 
 * piezoelectric elements, calculate energy harvested, and transmit
 * the data to a Node.js server via WebSockets.
 */

#include <ESP8266WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <EEPROM.h>

// WiFi credentials - replace with your network info
const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

// WebSocket server settings
const char* wsHost = "192.168.1.100";  // Replace with your server IP
const int wsPort = 3000;
const char* wsPath = "/";

// Pin definitions
const int PIEZO_ADC_PIN = A0;         // Analog input for voltage measurement
const int VEHICLE_DETECT_PIN = D2;    // Digital input for vehicle detection
const int PIEZO_POWER_PIN = D1;       // Digital output to control piezo system
const int STATUS_LED_PIN = LED_BUILTIN; // Built-in LED for status indication

// System constants
const float VOLTAGE_REF = 3.3;        // ADC reference voltage
const float ADC_RESOLUTION = 1024.0;  // ESP8266 has 10-bit ADC (0-1023)
const float VOLTAGE_DIVIDER_RATIO = 3.0; // Voltage divider ratio (R1+R2)/R2
const float CAPACITOR_VALUE = 6800e-6; // Total capacitance: 2× 3400μF in parallel = 6800μF
const float LED_POWER_CONSUMPTION = 0.15; // LED power in watts (150mW)

// Vehicle detection constants
const unsigned long DEBOUNCE_TIME = 100;  // Debounce time in ms
const float VOLTAGE_THRESHOLD = 0.5;     // Threshold for vehicle detection in volts

// Data collection & reporting
const unsigned long SAMPLING_INTERVAL = 100;  // Sample every 100ms
const unsigned long REPORTING_INTERVAL = 2000; // Report every 2s
const int SAMPLES_PER_REPORT = REPORTING_INTERVAL / SAMPLING_INTERVAL;

// EEPROM constants
const int EEPROM_PASS_COUNT_ADDR = 0;
const int EEPROM_ENERGY_ADDR = 4;

// Global variables
volatile unsigned long lastDebounceTime = 0;
volatile bool vehiclePassing = false;
unsigned long lastSampleTime = 0;
unsigned long lastReportTime = 0;
unsigned long connectionAttemptTime = 0;
bool wsConnected = false;

// Sensor data
int passCount = 0;
float currentVoltage = 0.0;
float peakVoltage = 0.0;
float energyHarvested = 0.0;
float totalEnergy = 0.0;
float estimatedRuntime = 0.0;

// Buffers for averaging
float voltageSamples[SAMPLES_PER_REPORT];
int sampleIndex = 0;

// WebSocket client
WebSocketsClient webSocket;

// Forward declarations
void saveDataToEEPROM();
void loadDataFromEEPROM();
float calculateEnergy(float voltage);
float calculateRuntime(float energy);

void ICACHE_RAM_ATTR vehicleDetectionISR() {
  // Debounce logic
  unsigned long currentTime = millis();
  if (currentTime - lastDebounceTime > DEBOUNCE_TIME) {
    vehiclePassing = true;
    passCount++;
    digitalWrite(STATUS_LED_PIN, LOW); // LED on (active low)
    lastDebounceTime = currentTime;
  }
}

void setup() {
  // Initialize serial communication
  Serial.begin(115200);
  Serial.println("\n\nPiezoelectric Energy Harvesting Monitor");
  Serial.println("======================================");
  Serial.println("Using dual 3400μF capacitors in parallel (6800μF total)");

  // Initialize pins
  pinMode(PIEZO_ADC_PIN, INPUT);
  pinMode(VEHICLE_DETECT_PIN, INPUT_PULLUP);
  pinMode(PIEZO_POWER_PIN, OUTPUT);
  pinMode(STATUS_LED_PIN, OUTPUT);
  
  digitalWrite(PIEZO_POWER_PIN, HIGH); // Enable piezo circuit
  digitalWrite(STATUS_LED_PIN, HIGH);  // LED off initially (active low)
  
  // Initialize EEPROM and load saved data
  EEPROM.begin(512);
  loadDataFromEEPROM();
  
  // Setup interrupt for vehicle detection
  attachInterrupt(digitalPinToInterrupt(VEHICLE_DETECT_PIN), vehicleDetectionISR, FALLING);
  
  // Initialize WebSocket client
  initWebSocket();
  
  // Connect to WiFi
  connectToWiFi();
  
  Serial.println("System initialization complete");
}

void loop() {
  // Handle WiFi connection
  if (WiFi.status() != WL_CONNECTED) {
    unsigned long currentTime = millis();
    if (currentTime - connectionAttemptTime > 30000) { // Try reconnecting every 30 seconds
      connectionAttemptTime = currentTime;
      connectToWiFi();
    }
  } else {
    webSocket.loop(); // Process WebSocket events
  }
  
  // Sample voltage at regular intervals
  if (millis() - lastSampleTime >= SAMPLING_INTERVAL) {
    lastSampleTime = millis();
    
    // Read and calculate voltage
    float rawVoltage = readVoltage();
    currentVoltage = rawVoltage * VOLTAGE_DIVIDER_RATIO;
    
    // Store in sample buffer
    voltageSamples[sampleIndex] = currentVoltage;
    sampleIndex = (sampleIndex + 1) % SAMPLES_PER_REPORT;
    
    // Check for peak voltage
    if (currentVoltage > peakVoltage) {
      peakVoltage = currentVoltage;
    }
    
    // Check for vehicle passing based on voltage spike
    if (currentVoltage > VOLTAGE_THRESHOLD && !vehiclePassing) {
      vehiclePassing = true;
      passCount++;
      
      // Calculate energy from this pass
      float passEnergy = calculateEnergy(currentVoltage);
      energyHarvested += passEnergy;
      totalEnergy += passEnergy;
      
      digitalWrite(STATUS_LED_PIN, LOW); // LED on
    } else if (currentVoltage < VOLTAGE_THRESHOLD && vehiclePassing) {
      vehiclePassing = false;
      digitalWrite(STATUS_LED_PIN, HIGH); // LED off
    }
  }
  
  // Report data at regular intervals
  if (millis() - lastReportTime >= REPORTING_INTERVAL) {
    lastReportTime = millis();
    
    // Calculate average voltage
    float avgVoltage = 0;
    for (int i = 0; i < SAMPLES_PER_REPORT; i++) {
      avgVoltage += voltageSamples[i];
    }
    avgVoltage /= SAMPLES_PER_REPORT;
    
    // Calculate runtime
    estimatedRuntime = calculateRuntime(totalEnergy);
    
    // Send data to server
    sendData(avgVoltage, passCount, totalEnergy, estimatedRuntime);
    
    // Save data to EEPROM every 10 reports (20 seconds)
    static int reportCount = 0;
    if (++reportCount >= 10) {
      saveDataToEEPROM();
      reportCount = 0;
    }
    
    // Debug output
    Serial.printf("Voltage: %.2fV, Peak: %.2fV, Passes: %d, Energy: %.6fJ, Runtime: %.1fs\n",
                  avgVoltage, peakVoltage, passCount, totalEnergy, estimatedRuntime);
  }
}

float readVoltage() {
  // Read raw ADC value
  int adcValue = analogRead(PIEZO_ADC_PIN);
  
  // Convert to voltage (ESP8266 ADC is 10-bit, 0-1023 for 0-3.3V)
  float voltage = (adcValue / ADC_RESOLUTION) * VOLTAGE_REF;
  
  return voltage;
}

float calculateEnergy(float voltage) {
  // E = 0.5 * C * V^2
  return 0.5 * CAPACITOR_VALUE * voltage * voltage;
}

float calculateRuntime(float energy) {
  // Runtime (s) = Energy (J) / Power (W)
  if (LED_POWER_CONSUMPTION > 0) {
    return energy / LED_POWER_CONSUMPTION;
  }
  return 0;
}

void connectToWiFi() {
  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi ");
  Serial.print(ssid);
  Serial.print(" ");
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println(" connected!");
    Serial.print("IP address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println(" connection failed!");
  }
}

void initWebSocket() {
  webSocket.begin(wsHost, wsPort, wsPath);
  webSocket.onEvent(onWebSocketEvent);
  webSocket.setReconnectInterval(5000); // Try reconnecting every 5 seconds
}

void onWebSocketEvent(WStype_t type, uint8_t *payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      wsConnected = false;
      Serial.println("WebSocket disconnected");
      break;
      
    case WStype_CONNECTED:
      wsConnected = true;
      Serial.printf("WebSocket connected to %s\n", payload);
      // Send device identifier with custom header
      webSocket.sendTXT("{\"type\":\"identify\",\"device\":\"ESP8266\"}");
      break;
      
    case WStype_TEXT:
      Serial.printf("WebSocket received: %s\n", payload);
      handleWebSocketMessage(payload, length);
      break;
      
    case WStype_ERROR:
      Serial.println("WebSocket error");
      break;
  }
}

void handleWebSocketMessage(uint8_t *payload, size_t length) {
  // Parse JSON message
  DynamicJsonDocument doc(256);
  DeserializationError error = deserializeJson(doc, payload, length);
  
  if (error) {
    Serial.println("JSON parsing error");
    return;
  }
  
  // Handle commands from server
  if (doc.containsKey("command")) {
    String command = doc["command"];
    
    if (command == "reset") {
      // Reset counters
      passCount = 0;
      energyHarvested = 0;
      totalEnergy = 0;
      peakVoltage = 0;
      saveDataToEEPROM();
      
      // Acknowledge reset
      webSocket.sendTXT("{\"type\":\"ack\",\"action\":\"reset\",\"status\":\"success\"}");
      
    } else if (command == "status") {
      // Send immediate status update
      sendData(currentVoltage, passCount, totalEnergy, estimatedRuntime);
    }
  }
}

void sendData(float voltage, int passes, float energy, float runtime) {
  if (!wsConnected) {
    return; // Skip if not connected
  }
  
  // Create JSON document
  DynamicJsonDocument doc(256);
  
  doc["voltage"] = voltage;
  doc["passCount"] = passes;
  doc["energy"] = energy;
  doc["estimatedRuntime"] = runtime;
  
  // Serialize JSON to string
  String jsonString;
  serializeJson(doc, jsonString);
  
  // Send via WebSocket
  webSocket.sendTXT(jsonString);
}

void loadDataFromEEPROM() {
  // Read pass count (4 bytes)
  EEPROM.get(EEPROM_PASS_COUNT_ADDR, passCount);
  
  // Read total energy (4 bytes float)
  EEPROM.get(EEPROM_ENERGY_ADDR, totalEnergy);
  
  // Validate data (basic sanity check)
  if (passCount < 0 || passCount > 1000000) {
    passCount = 0; // Reset if corrupted
  }
  
  if (totalEnergy < 0 || totalEnergy > 1000) {
    totalEnergy = 0; // Reset if corrupted
  }
  
  Serial.printf("Loaded from EEPROM: Passes=%d, Energy=%.6fJ\n", passCount, totalEnergy);
}

void saveDataToEEPROM() {
  // Write pass count
  EEPROM.put(EEPROM_PASS_COUNT_ADDR, passCount);
  
  // Write total energy
  EEPROM.put(EEPROM_ENERGY_ADDR, totalEnergy);
  
  // Commit changes to EEPROM
  if (EEPROM.commit()) {
    Serial.println("EEPROM data saved successfully");
  } else {
    Serial.println("EEPROM save failed");
  }
}
