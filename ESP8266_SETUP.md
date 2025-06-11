# ESP8266 Hardware Setup Guide

This guide provides detailed instructions for setting up the ESP8266-based piezoelectric energy harvesting circuit and connecting it to the monitoring system.

## Hardware Requirements

### Components List
- ESP8266 NodeMCU or Wemos D1 Mini
- 10× Piezoelectric disc transducers (27mm diameter)
- DB107 Bridge Rectifier (or 4× 1N4007 diodes)
- 470µF capacitor (25V or higher rating)
- MT3608 DC-DC Boost Converter module
- 5V 18650 battery shield (with charging circuit)
- 18650 Li-ion battery (recommended: 3.7V, 4800mAh)
- 220Ω resistors (5-10×)
- 10kΩ resistor (2×)
- 100kΩ resistor (1×)
- 47kΩ resistor (1×)
- Tactile push button
- 5mm LEDs (5× for demonstration)
- Breadboard and jumper wires
- Perfboard and solder (for final assembly)
- Enclosure (weatherproof if used outdoors)

### Tools Required
- Soldering iron and solder
- Wire cutters/strippers
- Multimeter
- USB cable for ESP8266 programming
- Drill and bits (for enclosure)

## Circuit Diagram

```
                                      +-----+
                                      | USB |
                                      +--+--+
                                         |
                                     +---+---+
+----------+     +--------+          |       |
|Piezo     |     |        |          |Charging|
|Array     +---->+ Bridge +--------->+Circuit |
|(10x27mm) |     |Rectifier|         |       |
+----------+     +----+---+          +---+---+
                      |                  |
                      |                  |
                 +----+------+      +----+----+
                 |           |      |         |
                 | Capacitor |      | 18650   |
                 | 470µF/25V |      | Battery |
                 |           |      |         |
                 +----+------+      +----+----+
                      |                  |
                      |                  |
                 +----+------+           |
                 |           |           |
                 |  MT3608   |           |
                 |  Boost    |           |
                 | Converter |           |
                 |           |           |
                 +----+------+           |
                      |                  |
                      +-------+----------+
                              |
                              |
                         +----+----+
                         |         |
                         | ESP8266 |
                         |         |
                         +----+----+
                              |
                      +-------+--------+
                      |                |
                  +---+---+        +---+---+
                  | ADC   |        | GPIO  |
                  | A0    |        | D2    |
                  +---+---+        +---+---+
                      |                |
             Voltage Divider       Tactile Button
             (100kΩ/47kΩ)          with 10kΩ
                                  pull-up resistor
```

## Assembly Instructions

### Step 1: Piezoelectric Array

1. Connect all piezoelectric discs in parallel:
   - Join all positive (center) terminals together
   - Join all negative (outer) terminals together
   - Test output with multimeter when tapping the discs

2. Add rectifier circuit:
   - Connect piezo positive to AC input of bridge rectifier
   - Connect piezo negative to other AC input of bridge rectifier
   - DC+ output will go to capacitor positive
   - DC- output will go to ground

### Step 2: Energy Storage Circuit

1. Connect the capacitor:
   - Positive terminal to rectifier's DC+ output
   - Negative terminal to ground

2. Connect boost converter:
   - Input terminals to capacitor (observe polarity)
   - Adjust output to 5V using trim potentiometer
   - Measure with multimeter to confirm 5V output

3. Battery charging circuit:
   - Connect boost converter output to battery shield's input
   - Connect battery to shield (observe polarity!)

### Step 3: ESP8266 Circuit

1. Power connections:
   - Connect ESP8266 VIN pin to battery shield's output (5V)
   - Connect ESP8266 GND to common ground

2. Voltage monitoring:
   - Create voltage divider with 100kΩ and 47kΩ resistors
   - Connect divider input to capacitor
   - Connect divider output to ESP8266 A0 pin

3. Vehicle detection switch:
   - Connect tactile button between D2 and GND
   - Add 10kΩ pull-up resistor between D2 and 3.3V
   - This simulates vehicle detection for testing

4. Status LED array:
   - Connect 5 LEDs with 220Ω current-limiting resistors
   - Connect to GPIO pins D1, D5, D6, D7, D8
   - These will visualize power status and vehicle counts

## ESP8266 Firmware Setup

### Prerequisites
1. Install Arduino IDE (1.8.x or newer)
2. Add ESP8266 board support:
   - Go to Preferences → Additional Board Manager URLs
   - Add: `http://arduino.esp8266.com/stable/package_esp8266com_index.json`
   - Go to Tools → Board → Boards Manager
   - Search for ESP8266 and install

3. Required libraries:
   - ESP8266WiFi
   - WebSocketsClient
   - ArduinoJson (version 6.x)
   - EEPROM

### Firmware Configuration

1. Open `piezo_harvester.ino` in Arduino IDE
2. Update WiFi credentials:
   ```cpp
   const char* ssid = "YOUR_WIFI_SSID";
   const char* password = "YOUR_WIFI_PASSWORD";
   ```

3. Set WebSocket server address:
   ```cpp
   const char* wsHost = "192.168.1.100";  // Replace with your server IP
   const int wsPort = 3000;
   ```

4. Configure hardware pins if your connections differ:
   ```cpp
   const int PIEZO_ADC_PIN = A0;
   const int VEHICLE_DETECT_PIN = D2;
   const int PIEZO_POWER_PIN = D1;
   const int STATUS_LED_PIN = LED_BUILTIN;
   ```

5. Adjust voltage divider ratio if needed:
   ```cpp
   const float VOLTAGE_DIVIDER_RATIO = 3.0; // (R1+R2)/R2
   ```

6. Upload firmware:
   - Select correct board (NodeMCU 1.0 or Wemos D1 Mini)
   - Select correct port
   - Click Upload

## Testing and Calibration

### Initial Testing
1. Connect ESP8266 via USB cable
2. Open Serial Monitor (115200 baud)
3. Check for "System initialization complete" message
4. Verify WiFi connection and WebSocket status

### Piezo Testing
1. Tap on piezoelectric discs and observe voltage readings
2. Press the tactile button to simulate vehicle passes
3. Verify counter increments and LED status changes

### System Calibration
1. Measure actual voltage with multimeter at capacitor
2. Compare with reading shown in Serial Monitor
3. Adjust `VOLTAGE_DIVIDER_RATIO` if needed
4. Measure time to charge capacitor from empty
5. Record peak voltage achieved when tapping discs

## Installation Tips

### Indoor Testing
- Mount piezo discs on a sturdy surface
- Tap with consistent force to simulate vehicle passes
- Use USB power during initial setup and testing

### Outdoor Deployment
- Waterproof all connections with heat shrink and silicone
- Mount piezo elements in protective housing under speed bump
- Secure enclosure to prevent movement or water ingress
- Position antenna for optimal WiFi signal strength

### Troubleshooting
- **No voltage reading**: Check piezo connections and rectifier
- **Low voltage output**: Add more piezo elements in parallel
- **WiFi connection issues**: Check signal strength, try external antenna
- **Battery not charging**: Verify boost converter output is stable at 5V
- **Data transmission failures**: Check WebSocket server address and port

## Energy Efficiency Considerations

- ESP8266 deep sleep mode can be enabled between readings
- Adjust sampling and reporting intervals based on battery levels
- Consider adding a small solar panel for supplemental charging
- Use GPIO interrupts for vehicle detection rather than continuous polling
- Monitor battery voltage and implement low power safeguards
