// ByebyeworldWrapper class for managing generic Web Serial communication
import device_setting from "../device-setting.json";

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

const clapper_setting = device_setting.find((d) => d.type === "clapper") || {};
const DEFAULT_FILTERS = clapper_setting ? clapper_setting.filters : [];

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
    } else {
      this.setFilters(DEFAULT_FILTERS);
      console.log("[Robot] Using default filters:", this._filters);
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

    const selectedFilters = filters ?? this._filters;

    // 1. setting.jsonで指定しているポート番号と接続しているポートを照合->既に接続許可されているポートがあればそれを使用
    if (selectedFilters && selectedFilters.length > 0) {
      const existingPorts = await navigator.serial.getPorts();
      for (const port of existingPorts) {
        if (!this._isExcludedPort(port, excludePortInfos)) {
          const info = port.getInfo();
          const matches = selectedFilters.some((filter) => {
            const vendorMatch = filter.usbVendorId == null || filter.usbVendorId === info.usbVendorId;
            const productMatch = filter.usbProductId == null || filter.usbProductId === info.usbProductId;
            return vendorMatch && productMatch;
          });
          if (matches) {
            this._log("[Robot] Found previously granted port matching filters:", info);
            return port;
          }
        }
      }
    }

    // 2. 既存ポートがない場合、ユーザにプロンプトを表示
    if (!allowPrompt) {
      throw new Error("no previously granted serial ports");
    }

    if (selectedFilters && selectedFilters.length > 0) {
      const port = await navigator.serial.requestPort({ filters: selectedFilters });
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
    if (this._writer) {
      await this._writer.releaseLock();
      this._writer = null;
    }

    if (this._port) {
      await this._port.close();
      this._port = null;
    }

    this._status = SERIAL_STATUS.IDLE;
  }

  async clap(obj, { lineEnding } = {}) {
    // console.log("[Robot] Sending CLAP action with payload:", obj);
    await this.sendCommand("clap", obj, { lineEnding });
  }

  async mouth(obj, { lineEnding } = {}) {
    // console.log("[Robot] Sending MOUTH action with payload:", obj);
    await this.sendCommand("mouth", obj, { lineEnding });
  }

  async eye(obj, { lineEnding } = {}) {
    // console.log("[Robot] Sending EYE action with payload:", obj);
    await this.sendCommand("eye", obj, { lineEnding });
  }

  async sendCommand(command, obj, { lineEnding } = {}) {
    this._log(`[Robot] Sending command: ${command} with payload:`, obj);

    if (!this._writer) {
      throw new Error("serial not connected");
    }

    const serialObj = obj && typeof obj === "object" ? { command, ...obj } : { command, value: obj };

    const ending = this._resolveLineEnding(lineEnding);
    const payload = `${JSON.stringify(serialObj)}${ending}`;
    await this._writer.ready;
    await this._writer.write(this._textEncoder.encode(payload));
    this._log("[Robot] Serial write completed:", payload);
  }
}
