#include <M5AtomS3.h>
#include <ctype.h>
#include <string.h>

// Port.A 無印 25,21 S3 38,39
// Port.B 無印 23,33 S3 7,8
// Port.C 無印 22,19 S3 5,6

const uint8_t PIN_CLAP = 6;      // 手を叩く（ソレノイド）
const uint8_t PIN_MOUTH = 5;     // 口（ソレノイド）
const uint8_t PIN_FLUID = 39;     // 磁性流体（電磁石）
const uint8_t PIN_EYE = 8;       // 目（LED）
const uint16_t EYE_PWM_FREQ_HZ = 5000;
const uint8_t EYE_PWM_RES_BITS = 8;
const uint8_t EYE_PWM_MAX_DUTY = 255;
const uint16_t EYE_LEVEL_MAX_MS = 1000;

const uint16_t PULSE_CLAP_MS = 40;
const uint16_t PULSE_MOUTH_MOVE_MS = 100;
const uint16_t COOLDOWN_MOUTH_MS = 50;
const uint16_t PULSE_FLUID_MS = 250;
const uint16_t COOLDOWN_FLUID_MS = 100;
const uint16_t JITTER_FLUID_PULSE_MS = 100;
const uint16_t JITTER_FLUID_COOLDOWN_MS = 30;

uint32_t dispColor(uint8_t r, uint8_t g, uint8_t b) {
  return (static_cast<uint32_t>(r) << 16) | (static_cast<uint32_t>(g) << 8) | static_cast<uint32_t>(b);
}

unsigned long clapPulseEndAt = 0;
unsigned long mouthPulseEndAt = 0;
unsigned long fluidPulseEndAt = 0;
unsigned long clapCooldownUntil = 0;
unsigned long mouthCooldownUntil = 0;
unsigned long fluidCooldownUntil = 0;
uint16_t eyeLevelMs = 0;
bool clapPending = false;
bool mouthPending = false;
uint16_t clapPendingDurationMs = PULSE_CLAP_MS;
uint16_t mouthPendingDurationMs = PULSE_MOUTH_MOVE_MS;

const size_t COMMAND_BASE_LEN = 4;     // AXXX
const size_t COMMAND_WITH_SEQ_LEN = 9; // AXXXSXXXX
const uint16_t FRAME_UNIT_MS = 10;
const uint16_t FRAME_MAX_UNITS = 300;  // 3000ms
const size_t RX_BUFFER_SIZE = 64;

char serialRxBuffer[RX_BUFFER_SIZE] = {0};
size_t serialRxLength = 0;

bool isDigits(const char* value, size_t from, size_t length, size_t totalLength) {
  if (from + length > totalLength) {
    return false;
  }

  for (size_t i = from; i < from + length; ++i) {
    const char c = value[i];
    if (c < '0' || c > '9') {
      return false;
    }
  }

  return true;
}

long parseFixedNumber(const char* value, size_t from, size_t length, size_t totalLength) {
  if (!isDigits(value, from, length, totalLength)) {
    return -1;
  }

  long parsed = 0;
  for (size_t i = from; i < from + length; ++i) {
    parsed = (parsed * 10) + (value[i] - '0');
  }
  return parsed;
}

bool isKnownCompactActionCode(char code) {
  return code == 'C' || code == 'M' || code == 'E';
}

uint8_t eyeLevelMsToDuty(uint16_t levelMs) {
  const uint16_t clampedLevelMs = levelMs > EYE_LEVEL_MAX_MS ? EYE_LEVEL_MAX_MS : levelMs;
  return static_cast<uint8_t>((static_cast<uint32_t>(clampedLevelMs) * EYE_PWM_MAX_DUTY) / EYE_LEVEL_MAX_MS);
}

void applyEyeOutput() {
  const uint8_t duty = eyeLevelMsToDuty(eyeLevelMs);
  const uint8_t ledLevel = static_cast<uint8_t>((static_cast<uint16_t>(duty) * 20) / EYE_PWM_MAX_DUTY);
  ledcWrite(PIN_EYE, duty);
  AtomS3.dis.drawpix(duty > 0 ? dispColor(ledLevel, ledLevel, ledLevel) : dispColor(0, 0, 0));
}

void setEyeLevel(uint16_t levelMs) {
  eyeLevelMs = levelMs;
  applyEyeOutput();
}

bool startClapPulse(uint16_t durationMs) {
  const unsigned long now = millis();
  if (now < clapCooldownUntil) {
    return false;
  }

  digitalWrite(PIN_CLAP, HIGH);
  clapPulseEndAt = now + durationMs;
  clapCooldownUntil = now + durationMs;
  return true;
}

bool startMouthPulse(uint16_t durationMs) {
  const unsigned long now = millis();
  if (now < mouthCooldownUntil) {
    return false;
  }

  digitalWrite(PIN_MOUTH, HIGH);
  mouthPulseEndAt = now + durationMs;
  mouthCooldownUntil = mouthPulseEndAt + COOLDOWN_MOUTH_MS;
  return true;
}

uint16_t randomDurationWithJitter(uint16_t baseMs, uint16_t jitterMs) {
  const long minMs = ((long)baseMs - (long)jitterMs) > 1 ? (long)baseMs - (long)jitterMs : 1;
  const long maxMs = (long)baseMs + (long)jitterMs;
  return static_cast<uint16_t>(random(minMs, maxMs + 1));
}

bool startFluidPulse(uint16_t durationMs) {
  const unsigned long now = millis();
  if (now < fluidCooldownUntil) {
    return false;
  }

  const uint16_t randomizedPulseMs = randomDurationWithJitter(durationMs, JITTER_FLUID_PULSE_MS);
  const uint16_t randomizedCooldownMs = randomDurationWithJitter(COOLDOWN_FLUID_MS, JITTER_FLUID_COOLDOWN_MS);
  const unsigned long pulseEndAt = now + randomizedPulseMs;
  digitalWrite(PIN_FLUID, HIGH);
  fluidPulseEndAt = pulseEndAt;
  fluidCooldownUntil = pulseEndAt + randomizedCooldownMs;
  return true;
}

void stopPulsesIfNeeded() {
  const unsigned long now = millis();
  if (clapPulseEndAt > 0 && now >= clapPulseEndAt) {
    digitalWrite(PIN_CLAP, LOW);
    clapPulseEndAt = 0;
  }

  if (mouthPulseEndAt > 0 && now >= mouthPulseEndAt) {
    digitalWrite(PIN_MOUTH, LOW);
    mouthPulseEndAt = 0;
  }

  if (fluidPulseEndAt > 0 && now >= fluidPulseEndAt) {
    digitalWrite(PIN_FLUID, LOW);
    fluidPulseEndAt = 0;
  }
}

void executeCompactCommand(char actionCode, uint16_t valueMs) {
  if (actionCode == 'C') {
    const uint16_t durationMs = valueMs > 0 ? valueMs : PULSE_CLAP_MS;
    if (startClapPulse(durationMs)) {
      startFluidPulse(PULSE_FLUID_MS);
      clapPending = false;
    } else {
      clapPending = true;
      clapPendingDurationMs = durationMs;
    }
    return;
  }

  if (actionCode == 'M') {
    if (valueMs == 0) {
      return;
    }
    if (startMouthPulse(valueMs)) {
      mouthPending = false;
    } else {
      mouthPending = true;
      mouthPendingDurationMs = valueMs;
    }
    return;
  }

  if (actionCode == 'E') {
    setEyeLevel(valueMs);
    return;
  }
}

bool parseCompactCommandFrame(const char* frame, size_t frameLength, char& actionCode, uint16_t& valueMs) {
  if (frameLength != COMMAND_BASE_LEN && frameLength != COMMAND_WITH_SEQ_LEN) {
    return false;
  }

  actionCode = static_cast<char>(toupper(frame[0]));
  if (!isKnownCompactActionCode(actionCode)) {
    return false;
  }

  if (!isDigits(frame, 1, 3, frameLength)) {
    return false;
  }

  const long units = parseFixedNumber(frame, 1, 3, frameLength);
  if (units < 0 || units > FRAME_MAX_UNITS) {
    return false;
  }

  if (frameLength == COMMAND_WITH_SEQ_LEN) {
    if (toupper(frame[4]) != 'S') {
      return false;
    }
    if (!isDigits(frame, 5, 4, frameLength)) {
      return false;
    }
  }

  valueMs = static_cast<uint16_t>(units * FRAME_UNIT_MS);
  return true;
}

void processSerialCommandFrame(const char* frame, size_t frameLength) {
  char actionCode = 0;
  uint16_t valueMs = 0;
  if (!parseCompactCommandFrame(frame, frameLength, actionCode, valueMs)) {
    return;
  }

  executeCompactCommand(actionCode, valueMs);
}

void removeRxPrefix(size_t count) {
  if (count == 0) {
    return;
  }
  if (count >= serialRxLength) {
    serialRxLength = 0;
    return;
  }

  memmove(serialRxBuffer, serialRxBuffer + count, serialRxLength - count);
  serialRxLength -= count;
}

void appendRxChar(char c) {
  if (serialRxLength < RX_BUFFER_SIZE) {
    serialRxBuffer[serialRxLength++] = c;
    return;
  }

  memmove(serialRxBuffer, serialRxBuffer + 1, RX_BUFFER_SIZE - 1);
  serialRxBuffer[RX_BUFFER_SIZE - 1] = c;
}

void processPendingCommands() {
  const unsigned long now = millis();

  if (clapPending && now >= clapCooldownUntil) {
    if (startClapPulse(clapPendingDurationMs)) {
      startFluidPulse(PULSE_FLUID_MS);
      clapPending = false;
    }
  }

  if (mouthPending && now >= mouthCooldownUntil) {
    if (startMouthPulse(mouthPendingDurationMs)) {
      mouthPending = false;
    }
  }
}

void pollSerialInput() {
  while (Serial.available() > 0) {
    const char c = static_cast<char>(Serial.read());
    if (c == '\r' || c == '\n' || c == ' ' || c == '\t') {
      continue;
    }

    appendRxChar(c);

    while (serialRxLength >= COMMAND_BASE_LEN) {
      const char actionCode = static_cast<char>(toupper(serialRxBuffer[0]));
      if (!isKnownCompactActionCode(actionCode)) {
        removeRxPrefix(1);
        continue;
      }

      if (!isDigits(serialRxBuffer, 1, 3, serialRxLength)) {
        removeRxPrefix(1);
        continue;
      }

      size_t frameLen = COMMAND_BASE_LEN;
      if (serialRxLength >= 5 && toupper(serialRxBuffer[4]) == 'S') {
        if (serialRxLength < COMMAND_WITH_SEQ_LEN) {
          break;
        }
        if (!isDigits(serialRxBuffer, 5, 4, serialRxLength)) {
          removeRxPrefix(1);
          continue;
        }
        frameLen = COMMAND_WITH_SEQ_LEN;
      }

      if (serialRxLength < frameLen) {
        break;
      }

      processSerialCommandFrame(serialRxBuffer, frameLen);
      removeRxPrefix(frameLen);
    }

    if (serialRxLength > COMMAND_WITH_SEQ_LEN * 4) {
      removeRxPrefix(serialRxLength - COMMAND_WITH_SEQ_LEN);
    }
  }
}

void showBootColor() {
  AtomS3.Display.fillScreen(TFT_GREEN);
}

void setup() {
  auto cfg = M5.config();
  AtomS3.begin(cfg, true);
  randomSeed((unsigned long)micros());
  Serial.begin(115200);
  delay(100);

  pinMode(PIN_CLAP, OUTPUT);
  pinMode(PIN_MOUTH, OUTPUT);
  pinMode(PIN_FLUID, OUTPUT);
  ledcAttach(PIN_EYE, EYE_PWM_FREQ_HZ, EYE_PWM_RES_BITS);

  digitalWrite(PIN_CLAP, LOW);
  digitalWrite(PIN_MOUTH, LOW);
  digitalWrite(PIN_FLUID, LOW);
  setEyeLevel(0);

  Serial.println("[boot] AtomS3R ready");
  showBootColor();
}

void loop() {
  AtomS3.update();
  pollSerialInput();
  stopPulsesIfNeeded();
  processPendingCommands();
}
