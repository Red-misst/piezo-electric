#include <ESP8266WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

// WiFi credentials
const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

// WebSocket server details
const char* websocket_host = "192.168.1.100"; // Change to your server IP
const int websocket_port = 3000;
const char* websocket_path = "/";

// Hardware pins
const int ANALOG_PIN = A0;
const int INTERRUPT_PIN = D2;
const int LED_PIN = LED_BUILTIN;

// Constants
const float CAPACITOR_VALUE = 470e-6; // 470µF in Farads
const float LED_POWER = 0.12; // 120mW total power consumption
const float VOLTAGE_DIVIDER_RATIO = 2.0; // Adjust based on your voltage divider
const unsigned long SEND_INTERVAL = 2000; // 2 seconds

// Global variables
volatile int passCount = 0;
float voltage = 0.0;
float energy = 0.0;
float estimatedRuntime = 0.0;
unsigned long lastSendTime = 0;
bool ledState = false;

WebSocketsClient webSocket;

void setup() {
  Serial.begin(115200);
  Serial.println("\nESP8266 Piezoelectric Monitor Starting...");
  
  // Initialize pins
  pinMode(INTERRUPT_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH); // LED off (inverted logic)
  
  // Setup interrupt for vehicle pass detection
  attachInterrupt(digitalPinToInterrupt(INTERRUPT_PIN), vehiclePassISR, FALLING);
  
  // Connect to WiFi
  connectToWiFi();
  
  // Initialize WebSocket
  webSocket.begin(websocket_host, websocket_port, websocket_path);
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);
  
  Serial.println("Setup complete!");
}

void loop() {
  webSocket.loop();
  
  // Check WiFi connection
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi disconnected, reconnecting...");
    connectToWiFi();
  }
  
  // Read and process sensor data
  readVoltage();
  calculateEnergy();
  calculateRuntime();
  
  // Send data every 2 seconds
  if (millis() - lastSendTime >= SEND_INTERVAL) {
    sendSensorData();
    lastSendTime = millis();
  }
  
  delay(100);
}

void ICACHE_RAM_ATTR vehiclePassISR() {
  passCount++;
  ledState = !ledState;
  digitalWrite(LED_PIN, ledState ? LOW : HIGH); // Blink LED (inverted logic)
}

void connectToWiFi() {
  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.print("WiFi connected! IP address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println();
    Serial.println("WiFi connection failed!");
  }
}

void readVoltage() {
  int analogValue = analogRead(ANALOG_PIN);
  // Convert ADC reading to voltage (ESP8266 ADC is 10-bit, 0-1024 for 0-1V)
  float adcVoltage = (analogValue / 1024.0);
  // Account for voltage divider
  voltage = adcVoltage * VOLTAGE_DIVIDER_RATIO;
}

void calculateEnergy() {
  // E = 0.5 * C * V^2
  energy = 0.5 * CAPACITOR_VALUE * voltage * voltage;
}

void calculateRuntime() {
  // Runtime in seconds = Energy / Power
  if (LED_POWER > 0) {
    estimatedRuntime = energy / LED_POWER;
  } else {
    estimatedRuntime = 0;
  }
}

void sendSensorData() {
  if (!webSocket.isConnected()) {
    Serial.println("WebSocket not connected, skipping data send");
    return;
  }
  
  // Create JSON object
  StaticJsonDocument<200> doc;
  doc["voltage"] = voltage;
  doc["passCount"] = passCount;
  doc["energy"] = energy;
  doc["estimatedRuntime"] = estimatedRuntime;
  
  String jsonString;
  serializeJson(doc, jsonString);
  
  webSocket.sendTXT(jsonString);
  
  Serial.println("Sent: " + jsonString);
  Serial.printf("Voltage: %.3fV, Passes: %d, Energy: %.6fJ, Runtime: %.2fs\n", 
                voltage, passCount, energy, estimatedRuntime);
}

void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch(type) {
    case WStype_DISCONNECTED:
      Serial.println("WebSocket Disconnected!");
      break;
      
    case WStype_CONNECTED:
      Serial.printf("WebSocket Connected to: %s\n", payload);
      break;
      
    case WStype_TEXT:
      Serial.printf("WebSocket received: %s\n", payload);
      break;
      
    case WStype_ERROR:
      Serial.println("WebSocket Error!");
      break;
      
    default:
      break;
  }
}
