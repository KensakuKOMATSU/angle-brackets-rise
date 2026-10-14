#include <Arduino.h>
#include <ArduinoJson.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <M5StackChan.h>
#include <Preferences.h>
#include <USB.h>

namespace
{

  constexpr uint32_t kModeSelectDurationMs = 5000;
  constexpr size_t kMaxMessageLength = 512;
  constexpr size_t kBleNotificationChunkSize = 20;
  constexpr char kBleServiceUuid[] = "6E400001-B5A3-F393-E0A9-E50E24DCCA9E";
  constexpr char kBleRxUuid[] = "6E400002-B5A3-F393-E0A9-E50E24DCCA9E";
  constexpr char kBleTxUuid[] = "6E400003-B5A3-F393-E0A9-E50E24DCCA9E";
  constexpr uint32_t kBlinkIntervalMs = 5000;
  constexpr uint32_t kBlinkDurationMs = 150;
  constexpr uint32_t kImuSampleIntervalMs = 20;
  constexpr uint32_t kShakeCooldownMs = 700;
  constexpr uint32_t kShakeActiveDurationMs = 300;
  constexpr uint32_t kServoShakeSettleMs = 700;
  constexpr float kShakeDeltaThresholdG = 1.0f;

  enum class ControlMode : uint8_t
  {
    Serial = 0,
    Bluetooth = 1,
  };

  struct ControlPacket
  {
    char payload[kMaxMessageLength];
  };

  struct MotionJob
  {
    float startX = 0;
    float startY = 30;
    float targetX = 0;
    float targetY = 30;
    uint32_t startedAt = 0;
    uint32_t duration = 500;
    uint32_t lastUpdate = 0;
    bool active = false;
  };

  struct FaceState
  {
    String expression = "neutral";
    String mouthType = "open";
    uint8_t mouthOpenRatio = 0;
  };

  ControlMode selectedMode = ControlMode::Serial;
  ControlMode runningMode = ControlMode::Serial;
  Preferences preferences;
  BLECharacteristic *bleTxCharacteristic = nullptr;
  QueueHandle_t bleQueue = nullptr;
  MotionJob motionJob;
  FaceState faceState;
  char serialBuffer[kMaxMessageLength];
  size_t serialBufferLength = 0;
  uint32_t bootStartedAt = 0;
  uint32_t lastModeCountdownSecond = UINT32_MAX;
  bool modeStarted = false;
  bool modeTouchActive = false;
  uint32_t nextBlinkAt = 0;
  uint32_t blinkStartedAt = 0;
  bool blinkActive = false;
  uint8_t previousTouchLevels[3] = {};
  uint16_t pendingTouchPresses[3] = {};
  uint16_t pendingTouchClicks = 0;
  bool shakeActive = false;
  bool shakeStateChanged = false;
  bool servoShakeSuppressionActive = false;
  uint32_t servoShakeSuppressionUntil = 0;
  bool restoreAutoAngleSyncWhenIdle = false;
  uint32_t lastImuSampleAt = 0;
  uint32_t lastShakeAt = 0;
  float previousAccelX = 0;
  float previousAccelY = 0;
  float previousAccelZ = 0;
  bool hasPreviousAccel = false;

  uint32_t durationProgress(uint32_t elapsed, uint32_t duration)
  {
    if (duration == 0 || elapsed >= duration)
    {
      return 1000;
    }
    return static_cast<uint32_t>((static_cast<uint64_t>(elapsed) * 1000) / duration);
  }

  void drawThickLine(int16_t x0, int16_t y0, int16_t x1, int16_t y1)
  {
    auto &display = M5StackChan.Display();
    display.drawLine(x0, y0 - 1, x1, y1 - 1, TFT_WHITE);
    display.drawLine(x0, y0, x1, y1, TFT_WHITE);
    display.drawLine(x0, y0 + 1, x1, y1 + 1, TFT_WHITE);
  }

  void drawHeartOutline(int16_t centerX, int16_t centerY)
  {
    auto &display = M5StackChan.Display();
    const int16_t x[] = {0, -9, -12, -12, -8, -3, 0, 3, 8, 12, 12, 9, 0};
    const int16_t y[] = {12, 5, 1, -5, -11, -11, -6, -11, -11, -5, 1, 5, 12};
    for (size_t index = 0; index < 12; ++index)
    {
      drawThickLine(centerX + x[index], centerY + y[index],
                    centerX + x[index + 1], centerY + y[index + 1]);
    }
  }

  bool hasRoundEyes()
  {
    return faceState.expression == "neutral" || faceState.expression == "sad" ||
           faceState.expression == "angry" ||
           faceState.expression == "surprised";
  }

  void beginFaceAnimation()
  {
    const uint32_t now = millis();
    nextBlinkAt = now + kBlinkIntervalMs;
    blinkActive = false;
  }

  void drawEyes()
  {
    auto &display = M5StackChan.Display();
    constexpr int16_t leftEyeX = 90;
    constexpr int16_t rightEyeX = 230;
    constexpr int16_t eyeY = 110;
    const int16_t eyeRadius = faceState.expression == "surprised" ? 21 : 7;

    if (faceState.expression == "happy_heart")
    {
      drawHeartOutline(leftEyeX, eyeY);
      drawHeartOutline(rightEyeX, eyeY);
    }
    else if (faceState.expression == "sleepy")
    {
      display.fillRect(leftEyeX - 8, eyeY - 1, 16, 3, TFT_WHITE);
      display.fillRect(rightEyeX - 8, eyeY - 1, 16, 3, TFT_WHITE);
    }
    else if (faceState.expression == "happy")
    {
      drawThickLine(leftEyeX - 9, eyeY + 3, leftEyeX - 4, eyeY - 2);
      drawThickLine(leftEyeX - 4, eyeY - 2, leftEyeX + 4, eyeY - 2);
      drawThickLine(leftEyeX + 4, eyeY - 2, leftEyeX + 9, eyeY + 3);
      drawThickLine(rightEyeX - 9, eyeY + 3, rightEyeX - 4, eyeY - 2);
      drawThickLine(rightEyeX - 4, eyeY - 2, rightEyeX + 4, eyeY - 2);
      drawThickLine(rightEyeX + 4, eyeY - 2, rightEyeX + 9, eyeY + 3);
    }
    else if (faceState.expression == "dizzy")
    {
      drawThickLine(leftEyeX - 6, eyeY - 6, leftEyeX + 6, eyeY + 6);
      drawThickLine(leftEyeX + 6, eyeY - 6, leftEyeX - 6, eyeY + 6);
      drawThickLine(rightEyeX - 6, eyeY - 6, rightEyeX + 6, eyeY + 6);
      drawThickLine(rightEyeX + 6, eyeY - 6, rightEyeX - 6, eyeY + 6);
    }
    else if (blinkActive && hasRoundEyes())
    {
      display.fillRect(leftEyeX - eyeRadius, eyeY - 1, eyeRadius * 2, 3, TFT_WHITE);
      display.fillRect(rightEyeX - eyeRadius, eyeY - 1, eyeRadius * 2, 3, TFT_WHITE);
    }
    else
    {
      display.fillCircle(leftEyeX, eyeY, eyeRadius, TFT_WHITE);
      display.fillCircle(rightEyeX, eyeY, eyeRadius, TFT_WHITE);
    }

    if (faceState.expression == "angry")
    {
      drawThickLine(leftEyeX - 12, eyeY - 27, leftEyeX + 12, eyeY - 23);
      drawThickLine(rightEyeX - 12, eyeY - 23, rightEyeX + 12, eyeY - 27);
    }
    else if (faceState.expression == "sad")
    {
      drawThickLine(leftEyeX - 12, eyeY - 24, leftEyeX + 12, eyeY - 27);
      drawThickLine(rightEyeX - 12, eyeY - 27, rightEyeX + 12, eyeY - 24);
    }
  }

  void drawMouth()
  {
    auto &display = M5StackChan.Display();
    const int16_t mouthCenterX = 160;
    const int16_t mouthCenterY = 180;
    if (faceState.mouthType == "closed")
    {
      display.fillRect(mouthCenterX - 25, mouthCenterY - 1, 50, 3, TFT_WHITE);
    }
    else if (faceState.mouthType == "smile")
    {
      display.drawLine(mouthCenterX - 22, mouthCenterY - 5,
                       mouthCenterX - 11, mouthCenterY + 7, TFT_WHITE);
      display.drawLine(mouthCenterX - 11, mouthCenterY + 7,
                       mouthCenterX + 11, mouthCenterY + 7, TFT_WHITE);
      display.drawLine(mouthCenterX + 11, mouthCenterY + 7,
                       mouthCenterX + 22, mouthCenterY - 5, TFT_WHITE);
    }
    else
    {
      if (faceState.mouthType == "round")
      {
        const int16_t radius = 3 + faceState.mouthOpenRatio / 12;
        display.fillCircle(mouthCenterX, mouthCenterY, radius, TFT_WHITE);
      }
      else
      {
        constexpr int16_t mouthWidth = 50;
        const int16_t mouthHeight = 3 + (30 * faceState.mouthOpenRatio) / 100;
        display.fillRect(mouthCenterX - mouthWidth / 2, mouthCenterY - mouthHeight / 2,
                         mouthWidth, mouthHeight, TFT_WHITE);
      }
    }
  }

  void drawFace()
  {
    auto &display = M5StackChan.Display();
    display.fillScreen(TFT_BLACK);
    drawEyes();
    drawMouth();
  }

  void updateFaceAnimation()
  {
    const uint32_t now = millis();
    bool redraw = false;

    if (static_cast<int32_t>(now - nextBlinkAt) >= 0)
    {
      do
      {
        nextBlinkAt += kBlinkIntervalMs;
      } while (static_cast<int32_t>(now - nextBlinkAt) >= 0);

      if (hasRoundEyes())
      {
        blinkActive = true;
        blinkStartedAt = now;
        redraw = true;
      }
    }

    if (blinkActive && now - blinkStartedAt >= kBlinkDurationMs)
    {
      blinkActive = false;
      redraw = true;
    }

    if (redraw)
    {
      auto &display = M5StackChan.Display();
      const int16_t eyeHalfWidth = faceState.expression == "surprised" ? 24 : 16;
      display.fillRect(90 - eyeHalfWidth, 70, eyeHalfWidth * 2, 76, TFT_BLACK);
      display.fillRect(230 - eyeHalfWidth, 70, eyeHalfWidth * 2, 76, TFT_BLACK);
      drawEyes();
    }
  }

  void drawModeSelector()
  {
    auto &display = M5StackChan.Display();
    display.fillScreen(0x10A2);
    display.setTextDatum(middle_center);
    display.setTextColor(TFT_WHITE, 0x10A2);
    display.setTextSize(2);
    display.drawString("StackChan Control", 160, 42);
    display.setTextSize(1);
    display.drawString("Select connection mode", 160, 76);

    const uint16_t serialColor = selectedMode == ControlMode::Serial ? 0x05E0 : 0x39C7;
    const uint16_t bleColor = selectedMode == ControlMode::Bluetooth ? 0x05E0 : 0x39C7;
    display.fillRoundRect(18, 105, 136, 76, 10, serialColor);
    display.fillRoundRect(166, 105, 136, 76, 10, bleColor);
    display.setTextColor(TFT_WHITE);
    display.setTextSize(2);
    display.drawString("Web Serial", 86, 143);
    display.drawString("Bluetooth", 234, 143);
  }

  void drawModeCountdown(uint32_t remainingSecond)
  {
    auto &display = M5StackChan.Display();
    display.fillRect(80, 192, 160, 30, 0x10A2);
    display.setTextDatum(middle_center);
    display.setTextColor(TFT_WHITE, 0x10A2);
    display.setTextSize(1);
    display.drawString("Auto start in " + String(remainingSecond) + " sec", 160, 207);
  }

  void sendReply(const JsonDocument &reply)
  {
    String output;
    serializeJson(reply, output);
    if (runningMode == ControlMode::Serial)
    {
      Serial.println(output);
    }
    else if (bleTxCharacteristic != nullptr)
    {
      output += '\n';
      const uint8_t *bytes = reinterpret_cast<const uint8_t *>(output.c_str());
      for (size_t offset = 0; offset < output.length(); offset += kBleNotificationChunkSize)
      {
        const size_t chunkLength = min(kBleNotificationChunkSize, output.length() - offset);
        bleTxCharacteristic->setValue(bytes + offset, chunkLength);
        bleTxCharacteristic->notify();
        if (offset + chunkLength < output.length())
        {
          delay(10);
        }
      }
    }
  }

  void sendError(const char *message)
  {
    JsonDocument reply;
    reply["ok"] = false;
    reply["error"] = message;
    sendReply(reply);
  }

  void incrementEventCount(uint16_t &count)
  {
    if (count < UINT16_MAX)
    {
      ++count;
    }
  }

  bool hasPendingSensorEvents()
  {
    return pendingTouchPresses[0] > 0 || pendingTouchPresses[1] > 0 ||
           pendingTouchPresses[2] > 0 || pendingTouchClicks > 0 || shakeStateChanged;
  }

  void sendSensorEvents();

  void updateSensorEvents()
  {
    const auto &intensities = M5StackChan.TouchSensor.getIntensities();
    for (size_t index = 0; index < 3; ++index)
    {
      const uint8_t isTouched = intensities[index] > 0;
      if (isTouched && !previousTouchLevels[index])
      {
        incrementEventCount(pendingTouchPresses[index]);
      }
      previousTouchLevels[index] = isTouched;
    }
    if (M5StackChan.TouchSensor.wasClicked())
    {
      incrementEventCount(pendingTouchClicks);
    }
    const uint32_t now = millis();
    if (servoShakeSuppressionActive &&
        static_cast<int32_t>(now - servoShakeSuppressionUntil) >= 0)
    {
      servoShakeSuppressionActive = false;
    }
    if (shakeActive && now - lastShakeAt >= kShakeActiveDurationMs)
    {
      shakeActive = false;
      shakeStateChanged = true;
    }
    if (now - lastImuSampleAt >= kImuSampleIntervalMs)
    {
      lastImuSampleAt = now;
      float accelX = 0;
      float accelY = 0;
      float accelZ = 0;
      if (M5.Imu.getAccel(&accelX, &accelY, &accelZ))
      {
        if (hasPreviousAccel && !motionJob.active && !servoShakeSuppressionActive &&
            now - lastShakeAt >= kShakeCooldownMs)
        {
          const float deltaX = accelX - previousAccelX;
          const float deltaY = accelY - previousAccelY;
          const float deltaZ = accelZ - previousAccelZ;
          if (sqrtf(deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ) >= kShakeDeltaThresholdG)
          {
            if (!shakeActive)
            {
              shakeActive = true;
              shakeStateChanged = true;
            }
            lastShakeAt = now;
          }
        }
        previousAccelX = accelX;
        previousAccelY = accelY;
        previousAccelZ = accelZ;
        hasPreviousAccel = true;
      }
      else
      {
        hasPreviousAccel = false;
      }
    }

    if (hasPendingSensorEvents())
    {
      sendSensorEvents();
    }
  }

  void sendSensorEvents()
  {
    JsonDocument reply;
    reply["type"] = "events";
    JsonObject events = reply["events"].to<JsonObject>();
    events["touch_front"] = pendingTouchPresses[0];
    events["touch_middle"] = pendingTouchPresses[1];
    events["touch_back"] = pendingTouchPresses[2];
    events["touch_click"] = pendingTouchClicks;
    events["shake"] = shakeActive ? 1 : 0;
    sendReply(reply);
    memset(pendingTouchPresses, 0, sizeof(pendingTouchPresses));
    pendingTouchClicks = 0;
    shakeStateChanged = false;
  }

  bool isKnownExpression(const char *expression)
  {
    return strcmp(expression, "neutral") == 0 || strcmp(expression, "happy") == 0 ||
           strcmp(expression, "happy_heart") == 0 || strcmp(expression, "sad") == 0 ||
           strcmp(expression, "angry") == 0 || strcmp(expression, "surprised") == 0 ||
           strcmp(expression, "sleepy") == 0 || strcmp(expression, "dizzy") == 0;
  }

  void scheduleMotion(float targetX, float targetY, uint32_t duration)
  {
    const uint32_t now = millis();
    M5StackChan.Motion.setAutoAngleSyncEnabled(false);
    restoreAutoAngleSyncWhenIdle = true;
    if (motionJob.active)
    {
      const float progress = min(1.0f, static_cast<float>(now - motionJob.startedAt) /
                                           static_cast<float>(motionJob.duration));
      motionJob.startX += (motionJob.targetX - motionJob.startX) * progress;
      motionJob.startY += (motionJob.targetY - motionJob.startY) * progress;
    }
    else
    {
      motionJob.startX = M5StackChan.Motion.getCurrentXAngle() / 10.0f;
      motionJob.startY = M5StackChan.Motion.getCurrentYAngle() / 10.0f;
    }
    motionJob.targetX = targetX;
    motionJob.targetY = targetY;
    motionJob.startedAt = now;
    motionJob.duration = duration;
    motionJob.lastUpdate = 0;
    motionJob.active = true;
    servoShakeSuppressionActive = true;
    servoShakeSuppressionUntil = now + duration + kServoShakeSettleMs;
    hasPreviousAccel = false;
  }

  void processControlPayload(const char *payload)
  {
    JsonDocument command;
    const DeserializationError parseError = deserializeJson(command, payload);
    if (parseError || !command["command"].is<const char *>())
    {
      sendError("invalid command; command name is required");
      return;
    }
    const char *commandName = command["command"].as<const char *>();
    if (strcmp(commandName, "sensors") == 0)
    {
      sendSensorEvents();
      return;
    }
    if (strcmp(commandName, "control") != 0)
    {
      sendError("unknown command");
      return;
    }

    float targetX = motionJob.targetX;
    float targetY = motionJob.targetY;
    uint32_t duration = 500;
    bool hasMotion = false;
    if (!command["servo"].isNull())
    {
      JsonObjectConst servo = command["servo"].as<JsonObjectConst>();
      if (servo.isNull())
      {
        sendError("servo must be an object");
        return;
      }
      if (!servo["x"].isNull())
      {
        if (!servo["x"].is<float>())
        {
          sendError("servo.x must be a number");
          return;
        }
        targetX = servo["x"].as<float>();
        hasMotion = true;
      }
      if (!servo["y"].isNull())
      {
        if (!servo["y"].is<float>())
        {
          sendError("servo.y must be a number");
          return;
        }
        targetY = servo["y"].as<float>();
        hasMotion = true;
      }
      if (!servo["duration"].isNull())
      {
        if (!servo["duration"].is<uint32_t>())
        {
          sendError("servo.duration must be a positive integer");
          return;
        }
        duration = servo["duration"].as<uint32_t>();
        if (duration > 60000)
        {
          sendError("servo.duration must be between 0 and 60000 ms");
          return;
        }
      }
      if (targetX < -128 || targetX > 128 || targetY < 5 || targetY > 85)
      {
        sendError("servo range is x=-128..128 and y=5..85 degrees");
        return;
      }
    }

    String nextExpression = faceState.expression;
    if (!command["expression"].isNull())
    {
      if (!command["expression"].is<const char *>())
      {
        sendError("expression must be a string");
        return;
      }
      const char *expression = command["expression"].as<const char *>();
      if (!isKnownExpression(expression))
      {
        sendError("unknown expression");
        return;
      }
      nextExpression = expression;
    }

    String nextMouthType = faceState.mouthType;
    uint8_t nextMouthRatio = faceState.mouthOpenRatio;
    if (!command["mouth"].isNull())
    {
      JsonObjectConst mouth = command["mouth"].as<JsonObjectConst>();
      if (mouth.isNull())
      {
        sendError("mouth must be an object");
        return;
      }
      if (!mouth["type"].isNull())
      {
        if (!mouth["type"].is<const char *>())
        {
          sendError("mouth.type must be a string");
          return;
        }
        const char *mouthType = mouth["type"].as<const char *>();
        if (strcmp(mouthType, "closed") != 0 && strcmp(mouthType, "open") != 0 &&
            strcmp(mouthType, "smile") != 0 && strcmp(mouthType, "round") != 0)
        {
          sendError("mouth.type must be closed, open, smile, or round");
          return;
        }
        nextMouthType = mouthType;
      }
      if (!mouth["open_ratio"].isNull())
      {
        if (!mouth["open_ratio"].is<uint8_t>() || mouth["open_ratio"].as<uint8_t>() > 100)
        {
          sendError("mouth.open_ratio must be between 0 and 100");
          return;
        }
        nextMouthRatio = mouth["open_ratio"].as<uint8_t>();
      }
    }

    faceState.expression = nextExpression;
    faceState.mouthType = nextMouthType;
    faceState.mouthOpenRatio = nextMouthRatio;
    if (hasMotion)
    {
      scheduleMotion(targetX, targetY, duration);
    }
    drawFace();

    JsonDocument reply;
    reply["ok"] = true;
    reply["x"] = targetX;
    reply["y"] = targetY;
    reply["expression"] = faceState.expression;
    reply["mouth"] = faceState.mouthType;
    sendReply(reply);
  }

  class BleRxCallbacks : public BLECharacteristicCallbacks
  {
    void onWrite(BLECharacteristic *characteristic) override
    {
      const String value = characteristic->getValue();
      if (value.isEmpty() || value.length() >= kMaxMessageLength || bleQueue == nullptr)
      {
        return;
      }
      ControlPacket packet{};
      memcpy(packet.payload, value.c_str(), value.length());
      xQueueSend(bleQueue, &packet, 0);
    }
  };

  class BleServerCallbacks : public BLEServerCallbacks
  {
    void onDisconnect(BLEServer *) override
    {
      BLEDevice::startAdvertising();
    }
  };

  void startBluetooth()
  {
    bleQueue = xQueueCreate(4, sizeof(ControlPacket));
    BLEDevice::init("StackChan-Control");
    BLEDevice::setMTU(256);
    BLEServer *server = BLEDevice::createServer();
    server->setCallbacks(new BleServerCallbacks());
    BLEService *service = server->createService(kBleServiceUuid);
    BLECharacteristic *rx = service->createCharacteristic(
        kBleRxUuid, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
    rx->setCallbacks(new BleRxCallbacks());
    bleTxCharacteristic = service->createCharacteristic(
        kBleTxUuid, BLECharacteristic::PROPERTY_NOTIFY | BLECharacteristic::PROPERTY_READ);
    service->start();
    BLEDevice::getAdvertising()->addServiceUUID(kBleServiceUuid);
    BLEDevice::getAdvertising()->start();
  }

  void startMode(ControlMode mode)
  {
    runningMode = mode;
    modeStarted = true;
    beginFaceAnimation();
    if (runningMode == ControlMode::Serial)
    {
      Serial.begin(115200);
      drawFace();
      Serial.println("{\"ready\":true,\"mode\":\"serial\"}");
    }
    else
    {
      startBluetooth();
      drawFace();
    }
  }

  void handleModeSelection()
  {
    M5StackChan.update();
    const uint32_t elapsed = millis() - bootStartedAt;
    const uint32_t remaining = elapsed >= kModeSelectDurationMs ? 0 : kModeSelectDurationMs - elapsed;
    const uint32_t remainingSecond = (remaining + 999) / 1000;
    if (remainingSecond != lastModeCountdownSecond)
    {
      drawModeCountdown(remainingSecond);
      lastModeCountdownSecond = remainingSecond;
    }

    auto &display = M5StackChan.Display();
    int16_t touchX = 0;
    int16_t touchY = 0;
    const bool touching = display.getTouch(&touchX, &touchY);
    if (touching && !modeTouchActive)
    {
      const ControlMode previousMode = selectedMode;
      if (touchX < display.width() / 2)
      {
        selectedMode = ControlMode::Serial;
      }
      else
      {
        selectedMode = ControlMode::Bluetooth;
      }
      if (selectedMode != previousMode)
      {
        preferences.putUChar("mode", static_cast<uint8_t>(selectedMode));
        drawModeSelector();
        drawModeCountdown(remainingSecond);
      }
    }
    modeTouchActive = touching;

    if (elapsed >= kModeSelectDurationMs)
    {
      startMode(selectedMode);
    }
  }

  void readSerialCommands()
  {
    while (Serial.available() > 0)
    {
      const char incoming = static_cast<char>(Serial.read());
      if (incoming == '\n' || incoming == '\r')
      {
        if (serialBufferLength > 0)
        {
          serialBuffer[serialBufferLength] = '\0';
          processControlPayload(serialBuffer);
          serialBufferLength = 0;
        }
      }
      else if (serialBufferLength < sizeof(serialBuffer) - 1)
      {
        serialBuffer[serialBufferLength++] = incoming;
      }
      else
      {
        serialBufferLength = 0;
        sendError("JSON line exceeds 511 bytes");
      }
    }
  }

  void updateMotion()
  {
    if (!motionJob.active)
    {
      if (restoreAutoAngleSyncWhenIdle && !M5StackChan.Motion.isMoving())
      {
        M5StackChan.Motion.setAutoAngleSyncEnabled(true);
        restoreAutoAngleSyncWhenIdle = false;
      }
      return;
    }
    const uint32_t now = millis();
    if (motionJob.lastUpdate != 0 && now - motionJob.lastUpdate < 20)
    {
      return;
    }
    motionJob.lastUpdate = now;
    const float progress = static_cast<float>(durationProgress(now - motionJob.startedAt,
                                                               motionJob.duration)) /
                           1000.0f;
    const float x = motionJob.startX + (motionJob.targetX - motionJob.startX) * progress;
    const float y = motionJob.startY + (motionJob.targetY - motionJob.startY) * progress;
    M5StackChan.Motion.move(static_cast<int>(lroundf(x * 10)),
                            static_cast<int>(lroundf(y * 10)), 1000);
    if (progress >= 1.0f)
    {
      motionJob.active = false;
    }
  }

} // namespace

void setup()
{
  USB.productName("StackChan Control");
  Serial.begin(115200);
  M5StackChan.begin();
  preferences.begin("stackchan", false);
  selectedMode = preferences.getUChar("mode", 0) == 1
                     ? ControlMode::Bluetooth
                     : ControlMode::Serial;
  motionJob.startX = M5StackChan.Motion.getCurrentXAngle() / 10.0f;
  motionJob.startY = constrain(M5StackChan.Motion.getCurrentYAngle() / 10.0f, 5, 85);
  motionJob.targetX = motionJob.startX;
  motionJob.targetY = motionJob.startY;
  bootStartedAt = millis();
  drawModeSelector();
  drawModeCountdown((kModeSelectDurationMs + 999) / 1000);
  lastModeCountdownSecond = (kModeSelectDurationMs + 999) / 1000;
}

void loop()
{
  M5StackChan.update();
  if (!modeStarted)
  {
    handleModeSelection();
    return;
  }

  updateSensorEvents();

  if (runningMode == ControlMode::Serial)
  {
    readSerialCommands();
  }
  else
  {
    ControlPacket packet{};
    while (xQueueReceive(bleQueue, &packet, 0) == pdTRUE)
    {
      processControlPayload(packet.payload);
    }
  }
  updateFaceAnimation();
  updateMotion();
  delay(2);
}