#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

// // WiFi credentials
// const char* ssid = "Redmi_12C";
// const char* password = "nthome1092";


const char* ssid = "Tenda_5C30C8";
const char* password = "op898989..";

// WebSocket server details
const char* wsHost = "192.168.0.109";
const int wsPort = 3000;
const char* wsPath = "/";

// Pin definitions
#define PIEZO_ADC_PIN 34

// Voltage measurement constants
const float VOLTAGE_REF = 3.3;
const float ADC_RESOLUTION = 4096.0;
const float VOLTAGE_DIVIDER_RATIO = 3.0;
const float VOLTAGE_THRESHOLD = 1.2;  // Pass detection threshold

// Timing
const unsigned long SAMPLING_INTERVAL = 100;    // in ms
const unsigned long REPORTING_INTERVAL = 1000;  // in ms
const unsigned long VEHICLE_GAP_TIME = 1000;    // ms to debounce vehicle

const int SAMPLES_PER_REPORT = REPORTING_INTERVAL / SAMPLING_INTERVAL;

// Globals
WebSocketsClient webSocket;
unsigned long lastSampleTime = 0;
unsigned long lastReportTime = 0;
unsigned long lastVehicleTime = 0;

bool vehicleDetected = false;
bool wsConnected = false;

int passCount = 0;
float currentVoltage = 0.0;
float voltageSamples[SAMPLES_PER_REPORT];
int sampleIndex = 0;

// Function declarations
void connectToWiFi();
void initWebSocket();
float readVoltage();
void sendData(float voltage, int passes);

void setup() {
  Serial.begin(115200);
  pinMode(PIEZO_ADC_PIN, INPUT);

  connectToWiFi();
  initWebSocket();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectToWiFi();
  } else {
    webSocket.loop();
  }

  unsigned long now = millis();

  if (now - lastSampleTime >= SAMPLING_INTERVAL) {
    lastSampleTime = now;

    float rawVoltage = readVoltage();
    currentVoltage = rawVoltage * VOLTAGE_DIVIDER_RATIO;

    // Ignore garbage readings
    if (isnan(currentVoltage) || currentVoltage < 0.0 || currentVoltage > 50.0) {
      currentVoltage = 0.0;
    }

    voltageSamples[sampleIndex] = currentVoltage;
    sampleIndex = (sampleIndex + 1) % SAMPLES_PER_REPORT;

    // Vehicle detection
    if (currentVoltage > VOLTAGE_THRESHOLD && !vehicleDetected && (now - lastVehicleTime > VEHICLE_GAP_TIME)) {
      vehicleDetected = true;
      lastVehicleTime = now;
      passCount++;
    }

    if (currentVoltage < VOLTAGE_THRESHOLD && vehicleDetected) {
      vehicleDetected = false;
    }
  }

  if (now - lastReportTime >= REPORTING_INTERVAL) {
    lastReportTime = now;

    float avgVoltage = 0;
    for (int i = 0; i < SAMPLES_PER_REPORT; i++) {
      avgVoltage += voltageSamples[i];
    }
    avgVoltage /= SAMPLES_PER_REPORT;

    sendData(avgVoltage, passCount);

    Serial.printf("Voltage: %.2fV | Passes: %d\n", avgVoltage, passCount);
  }
}

float readVoltage() {
  int adcValue = analogRead(PIEZO_ADC_PIN);
  return (adcValue / ADC_RESOLUTION) * VOLTAGE_REF;
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
    Serial.println(" connected!");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println(" failed to connect.");
  }
}

void initWebSocket() {
  webSocket.begin(wsHost, wsPort, wsPath);
  webSocket.setExtraHeaders("x-client-type: esp32");

  webSocket.onEvent([](WStype_t type, uint8_t *payload, size_t length) {
    if (type == WStype_CONNECTED) {
      wsConnected = true;
      Serial.println("WebSocket connected.");
    } else if (type == WStype_DISCONNECTED) {
      wsConnected = false;
      Serial.println("WebSocket disconnected.");
    }
  });

  webSocket.setReconnectInterval(5000);
}

void sendData(float voltage, int passes) {
  if (!wsConnected) return;

  DynamicJsonDocument doc(128);
  doc["voltage"] = voltage;
  doc["passCount"] = passes;
  
  // Calculate energy using E = 0.5 * C * V^2
  const float capacitance = 0.00047; // 470µF in Farads
  float energy = 0.5 * capacitance * voltage * voltage;
  doc["energy"] = energy;
  
  // Calculate estimated LED runtime (assuming 0.1W LED)
  float runtime = energy / 0.1; // Joules / Watts = seconds
  doc["estimatedRuntime"] = runtime;

  String jsonStr;
  serializeJson(doc, jsonStr);
  webSocket.sendTXT(jsonStr);
}
