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
    return new Error(
      `Failed to open serial port. Close other apps/tabs using this device and retry. options=${JSON.stringify(
        options
      )}`
    );
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

  setConnectionOptions(connectionOptions = {}) {
    const nextBaudRate = Math.max(
      1200,
      Number(connectionOptions.baudRate ?? this._connectionOptions.baudRate) ||
        this._connectionOptions.baudRate
    );

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

  async _selectPort({ allowPrompt = true, filters } = {}) {
    if (!this.supported) {
      throw new Error("Web Serial API is not supported in this browser");
    }

    const ports = await navigator.serial.getPorts();
    if (ports.length > 0) {
      if (!filters || filters.length === 0) {
        return ports[0];
      }

      const matchedPort = ports.find((port) => {
        const info = port.getInfo();
        return filters.some((filter) => {
          const vendorMatches =
            filter.usbVendorId == null || info.usbVendorId === filter.usbVendorId;
          const productMatches =
            filter.usbProductId == null || info.usbProductId === filter.usbProductId;
          return vendorMatches && productMatches;
        });
      });

      if (matchedPort) {
        return matchedPort;
      }
    }

    if (!allowPrompt) {
      throw new Error("no previously granted serial ports");
    }

    if (filters && filters.length > 0) {
      return navigator.serial.requestPort({ filters });
    }
    return navigator.serial.requestPort();
  }

  async connect({ allowPrompt = true, filters } = {}) {
    this._log("[Robot] Attempting to connect to serial port...");
    const selectedFilters = filters ?? this._filters;
    const ports = await navigator.serial.getPorts();
    const candidates = [];

    const matchesFilters = (port) => {
      if (!selectedFilters || selectedFilters.length === 0) {
        return true;
      }
      const info = port.getInfo();
      return selectedFilters.some((filter) => {
        const vendorMatches =
          filter.usbVendorId == null || info.usbVendorId === filter.usbVendorId;
        const productMatches =
          filter.usbProductId == null || info.usbProductId === filter.usbProductId;
        return vendorMatches && productMatches;
      });
    };

    for (const port of ports) {
      if (matchesFilters(port)) {
        candidates.push(port);
      }
    }

    if (candidates.length === 0 && allowPrompt) {
      candidates.push(await this._selectPort({ allowPrompt: true, filters: selectedFilters }));
    }

    if (candidates.length === 0) {
      throw new Error("no previously granted serial ports");
    }

    let lastError = null;
    const tryOpenPort = async (port) => {
      await port.open(this._connectionOptions);

      this._port = port;
      this._writer = port.writable.getWriter();
      this._status = SERIAL_STATUS.CONNECTED;
    };

    for (const port of candidates) {
      try {
        await tryOpenPort(port);
        this._log("[Robot] Connected to Robot Serial port:", port);
        return;
      } catch (error) {
        if (isPortAlreadyOpenError(error)) {
          this._port = port;
          this._writer = port.writable.getWriter();
          this._status = SERIAL_STATUS.CONNECTED;
          this._log("[Robot] Connected to Robot Serial port:", port);
          return;
        }
        lastError = error;
      }
    }

    if (allowPrompt) {
      try {
        const promptedPort = await navigator.serial.requestPort(
          selectedFilters && selectedFilters.length > 0 ? { filters: selectedFilters } : undefined
        );
        await tryOpenPort(promptedPort);
        return;
      } catch (error) {
        lastError = error;
      }
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

      const serialObj =
        obj && typeof obj === "object"
          ? { command, ...obj }
          : { command, value: obj };

      const ending = this._resolveLineEnding(lineEnding);
      const payload = `${JSON.stringify(serialObj)}${ending}`;
      await this._writer.ready;
      await this._writer.write(this._textEncoder.encode(payload));
        this._log("[Robot] Serial write completed:", payload);
  }


}
