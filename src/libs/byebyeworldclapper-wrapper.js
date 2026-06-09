// ByebyeworldWrapper class for managing generic Web Serial communication

const SERIAL_STATUS = {
  IDLE: "idle",
  CONNECTED: "connected",
};

const DEFAULT_CONNECTION_OPTIONS = {
  baudRate: 115200,
  dataBits: 8,
  stopBits: 1,
  parity: "none",
  flowControl: "none",
};

const DEFAULT_LINE_ENDING = "lf";

function toPortInfoKey(info) {
  if (!info || (info.usbVendorId == null && info.usbProductId == null)) {
    return null;
  }
  return `${info.usbVendorId ?? "*"}:${info.usbProductId ?? "*"}`;
}

function normalizeError(error) {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}

function isPortAlreadyOpenError(error) {
  const msg = String(error?.message || error).toLowerCase();
  return msg.includes("already open");
}

function withConnectionContext(error, options) {
  const normalized = normalizeError(error);
  const msg = String(normalized.message || "");
  const lowered = msg.toLowerCase();

  if (lowered.includes("failed to open serial port") || lowered.includes("networkerror")) {
    return new Error(`Failed to open serial port. Close other apps/tabs using this device and retry. options=${JSON.stringify(options)}`);
  }

  return normalized;
}

export default class ByebyeworldWrapper {
  _port = null;
  _writer = null;
  _status = SERIAL_STATUS.IDLE;
  _debug = false;
  _textEncoder = new TextEncoder();
  _connectionOptions = { ...DEFAULT_CONNECTION_OPTIONS };
  _lineEnding = DEFAULT_LINE_ENDING;
  _filters = [];

  constructor({ connectionOptions, lineEnding, filters } = {}) {
    if (connectionOptions) {
      this.setConnectionOptions(connectionOptions);
    }
    if (lineEnding) {
      this.setLineEnding(lineEnding);
    }
    if (filters) {
      this.setFilters(filters);
    }
  }

  get status() {
    return this._status;
  }

  get connected() {
    return this._status === SERIAL_STATUS.CONNECTED;
  }

  get supported() {
    return !!navigator.serial;
  }

  get connectionOptions() {
    return { ...this._connectionOptions };
  }

  get lineEnding() {
    return this._lineEnding;
  }

  get portInfo() {
    return this._port?.getInfo?.() ?? null;
  }

  get port() {
    return this._port;
  }

  setConnectionOptions(connectionOptions = {}) {
    const nextBaudRate = Math.max(1200, Number(connectionOptions.baudRate ?? this._connectionOptions.baudRate) || this._connectionOptions.baudRate);

    this._connectionOptions = {
      ...this._connectionOptions,
      ...connectionOptions,
      baudRate: nextBaudRate,
    };
  }

  setLineEnding(lineEnding = DEFAULT_LINE_ENDING) {
    this._lineEnding = lineEnding === "crlf" ? "crlf" : lineEnding === "none" ? "none" : "lf";
  }

  setFilters(filters = []) {
    this._filters = Array.isArray(filters) ? filters : [];
  }

  setDebug(enabled = false) {
    this._debug = Boolean(enabled);
  }

  _log(...args) {
    if (this._debug) {
      console.log(...args);
    }
  }

  _warn(...args) {
    if (this._debug) {
      console.warn(...args);
    }
  }

  _resolveLineEnding(lineEnding = this._lineEnding) {
    return lineEnding === "crlf" ? "\r\n" : lineEnding === "lf" ? "\n" : "";
  }

  _isExcludedPort(port, excludePortInfos = []) {
    if (!Array.isArray(excludePortInfos) || excludePortInfos.length === 0) {
      return false;
    }

    const portKey = toPortInfoKey(port?.getInfo?.());
    if (!portKey) {
      return false;
    }

    return excludePortInfos.some((info) => toPortInfoKey(info) === portKey);
  }

  async _selectPort({ allowPrompt = true, filters, excludePortInfos = [] } = {}) {
    if (!this.supported) {
      throw new Error("Web Serial API is not supported in this browser");
    }

    const grantedPorts = await navigator.serial.getPorts();
    console.log("Granted serial ports:", grantedPorts);
    for( const port of grantedPorts) {
      const info = port.getInfo?.();
      console.log("Port info:", info);
      if( info.usbVendorId === 12346 && info.usbProductId === 4097) {
        console.log("Found matching port:", port);
        return port;
      }
    }
    // const availableGrantedPort = grantedPorts.find((port) => !this._isExcludedPort(port, excludePortInfos));
    // if (availableGrantedPort) {
    //  return availableGrantedPort;
    // }

    if (!allowPrompt) {
      throw new Error("no previously granted serial ports");
    }

    if (filters && filters.length > 0) {
      const port = await navigator.serial.requestPort({ filters });
      if (this._isExcludedPort(port, excludePortInfos)) {
        throw new Error("Selected port is already used by another serial connection");
      }
      return port;
    }
    const port = await navigator.serial.requestPort();
    if (this._isExcludedPort(port, excludePortInfos)) {
      throw new Error("Selected port is already used by another serial connection");
    }
    return port;
  }

  async connect({ allowPrompt = true, filters, excludePortInfos = [] } = {}) {
    if (this.connected) {
      return;
    }

    console.log("connect() called with options:", { allowPrompt, filters, excludePortInfos });
    this._log("[Robot] Attempting to connect to serial port...");
    const selectedFilters = filters ?? this._filters;
    const tryOpenPort = async (port) => {
      if (this._isExcludedPort(port, excludePortInfos)) {
        throw new Error("Skipping excluded serial port");
      }

      await port.open(this._connectionOptions);

      this._port = port;
      this._writer = port.writable.getWriter();
      this._status = SERIAL_STATUS.CONNECTED;
    };

    const maxPromptAttempts = allowPrompt ? 3 : 1;
    let lastError = null;

    for (let attempt = 0; attempt < maxPromptAttempts; attempt += 1) {
      let port;
      try {
        port = await this._selectPort({
          allowPrompt,
          filters: selectedFilters,
          excludePortInfos,
        });
      } catch (error) {
        lastError = error;
        break;
      }

      try {
        await tryOpenPort(port);
        this._log("[Robot] Connected to Robot Serial port:", port);
        return;
      } catch (error) {
        lastError = error;
        if (isPortAlreadyOpenError(error) && attempt < maxPromptAttempts - 1) {
          this._warn("[Robot] Selected port is busy. Please choose another port.");
          continue;
        }
        break;
      }
    }

    if (isPortAlreadyOpenError(lastError)) {
      throw new Error("Selected port is already in use by another connection. Choose the other serial device.");
    }

    throw withConnectionContext(lastError || new Error("serial connection failed"), this._connectionOptions);
  }

  async disconnect() {
    this._log("[Robot] Disconnecting from serial port...");
    let disconnectError = null;

    if (this._writer) {
      try {
        this._writer.releaseLock();
      } catch (error) {
        disconnectError = disconnectError || normalizeError(error);
      } finally {
        this._writer = null;
      }
    }

    if (this._port) {
      try {
        await this._port.close();
      } catch (error) {
        disconnectError = disconnectError || normalizeError(error);
      } finally {
        this._port = null;
      }
    }

    this._status = SERIAL_STATUS.IDLE;

    if (disconnectError) {
      throw disconnectError;
    }
  }

  async clap(obj, { lineEnding } = {}) {
    await this._sendCommand("clap", obj, { lineEnding });
  }

  async mouth(obj, { lineEnding } = {}) {
    await this._sendCommand("mouth", obj, { lineEnding });
  }

  async eye(obj, { lineEnding } = {}) {
    await this._sendCommand("eye", obj, { lineEnding });
  }

  _resolveMouthAction(obj) {
    const raw = typeof obj === "string"
      ? obj
      : obj?.action ?? obj?.type ?? obj?.mode ?? "move";

    switch (String(raw).toLowerCase()) {
      case "move":
      case "mouth_move":
        return "mouth_move";
      case "small":
      case "mouth_small":
        return "mouth_small";
      case "large":
      case "mouth_large":
        return "mouth_large";
      default:
        break;
    }

    const normalized = String(raw);
    if (/^mouth_\d+$/.test(normalized)) {
      return normalized;
    }

    throw new Error(`Unsupported mouth action: ${raw}`);
  }

  _resolveEyeAction(obj) {
    const raw = typeof obj === "string"
      ? obj
      : obj?.action;

    const normalized = String(raw).toLowerCase().trim();
    if (/^eye_\d+$/.test(normalized)) {
      const level = Math.max(0, Math.min(100, Number(normalized.slice("eye_".length)) || 0));
      return `eye_${level}`;
    }
    throw new Error(`Unsupported eye action: ${raw}`);
  }

  _resolveAction(command, obj) {
    switch (command) {
      case "clap":
        return "clap";
      case "mouth_move":
      case "mouth_small":
      case "mouth_large":
        return command;
      case "mouth":
        return this._resolveMouthAction(obj);
      case "eye":
        return this._resolveEyeAction(obj);
      default:
        if (/^eye_\d+$/.test(String(command).toLowerCase())) {
          return this._resolveEyeAction(command);
        }
        return command;
    }
  }

  _buildPayload(command, action, obj) {
    if (obj && typeof obj === "object") {
      return { command, ...obj, action };
    }

    return obj === undefined ? { command, action } : { command, action, value: obj };
  }

  _padNumber(value, width) {
    const parsed = Number.isFinite(Number(value)) ? Number(value) : 0;
    const normalized = Math.max(0, Math.floor(parsed));
    return String(normalized).padStart(width, "0").slice(-width);
  }

  _toFrameActionCode(action) {
    switch (action) {
      case "clap":
        return "C";
      case "mouth_move":
        return "M";
      case "mouth_small":
        return "M";
      case "mouth_large":
        return "M";
      default:
        if (/^mouth_\d+$/.test(action)) {
          return "M";
        }
        if (/^eye_\d+$/.test(String(action).toLowerCase())) {
          return "E";
        }
        throw new Error(`Unsupported action for fixed frame: ${action}`);
    }
  }

  _resolveDurationMs(action) {
    switch (action) {
      case "clap":
        return 40;
      case "mouth_move":
        return 100;
      case "mouth_small":
        return 250;
      case "mouth_large":
        return 500;
      default:
        if (/^mouth_\d+$/.test(action)) {
          return Number(String(action).slice("mouth_".length)) || 0;
        }
        if (/^eye_\d+$/.test(String(action).toLowerCase())) {
          const level = Math.max(0, Math.min(100, Number(String(action).slice("eye_".length)) || 0));
          return level * 10;
        }
        throw new Error(`Unsupported action duration: ${action}`);
    }
  }

  _toFixedFrame(action, obj) {
    const actionCode = this._toFrameActionCode(action);
    const durationMs = this._resolveDurationMs(action);
    if (durationMs < 0 || durationMs > 3000) {
      throw new Error(`Duration must be between 0ms and 3000ms: ${durationMs}`);
    }

    const units = Math.round(durationMs / 10);
    const body = `${actionCode}${this._padNumber(units, 3)}`;

    const hasSeq = obj && typeof obj === "object" && obj.seq != null && Number.isFinite(Number(obj.seq));
    if (!hasSeq) {
      return body;
    }

    const seq = Number(obj.seq);
    return `${body}S${this._padNumber(seq, 4)}`;
  }

  async _sendCommand(command, obj, { lineEnding } = {}) {
    this._log(`[Robot] Sending command: ${command} with payload:`, obj);

    if (!this._writer) {
      throw new Error("serial not connected");
    }

    const action = this._resolveAction(command, obj);
    const frame = this._toFixedFrame(action, obj);
    const ending = this._resolveLineEnding(lineEnding);
    const payload = `${frame}${ending}`;
    await this._writer.ready;
    await this._writer.write(this._textEncoder.encode(payload));
    this._log("[Robot] Serial write completed:", payload);
  }
}
