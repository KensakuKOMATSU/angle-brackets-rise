// DMXWrapper class for managing DMX communication with ENTTEC DMX USB Pro using Web Serial API

import device_setting from "../device-setting.json";

const ENTTEC_PRO_DMX_STARTCODE = 0x00;
const ENTTEC_PRO_START_OF_MSG = 0x7e;
const ENTTEC_PRO_END_OF_MSG = 0xe7;
const ENTTEC_PRO_SEND_DMX_RQ = 0x06;

const UNIVERSE_LENGTH = 513;

const lengthLSB = UNIVERSE_LENGTH & 0xff; // 下位8ビット (Least Significant Byte)
const lengthMSB = (UNIVERSE_LENGTH >> 8) & 0xff; // 上位8ビット (Most Significant Byte)

//ヘッダー部分を Uint8Array で定義
const HEADER = new Uint8Array([
  ENTTEC_PRO_START_OF_MSG,
  ENTTEC_PRO_SEND_DMX_RQ,
  lengthLSB, // データ長 LSB
  lengthMSB, // データ長 MSB
  ENTTEC_PRO_DMX_STARTCODE,
]);

const END_BYTE = new Uint8Array([ENTTEC_PRO_END_OF_MSG]);

const STATUS = {
  IDLE: "idle",
  CONNECTED: "connected",
};

// const PRODUCT_ID = 24_577; // Product ID for ENTTEC DMX USB Pro
// const VENDOR_ID = 1_027; // Vendor ID for ENTTEC

/**
 * 複数の Uint8Array を結合する
 * @param {Uint8Array[]} arrays - 結合する Uint8Array の配列
 * @returns {Uint8Array} 結合された Uint8Array
 */
function concatUint8Arrays(arrays) {
  let totalLength = 0;
  for (const arr of arrays) {
    totalLength += arr.length;
  }

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

export default class DMXWrapper {
  _device = null;
  _dmxArray = new Uint8Array(UNIVERSE_LENGTH - 1); // DMXデータ部分（512バイト）
  _status = STATUS.IDLE;
  _writer = null;
  _timer;
  _autoSelectGrantedPorts = false;

  get status() {
    return this._status;
  }

  get connected() {
    return this._status === STATUS.CONNECTED;
  }

  // check if Web Serial API is supported
  get supported() {
    return !!navigator.serial;
  }

  setAutoSelectGrantedPorts(enabled = false) {
    this._autoSelectGrantedPorts = Boolean(enabled);
  }

  async connectToDMX() {
    const dmx_setting = device_setting.find((f) => f.type === "dmx");
    if (!dmx_setting) {
      throw new Error("DMX device filter is not defined in device_setting.json");
    }
    try {
      if (this._autoSelectGrantedPorts) {
        const ports = await navigator.serial.getPorts({
          filters: dmx_setting.filters,
        });
        if (ports.length > 0) {
          const _port = ports.find((port) => dmx_setting.filters.some((filter) => port.getInfo().usbVendorId === filter.usbVendorId && port.getInfo().usbProductId === filter.usbProductId));
          if (_port) {
            console.log("Found existing port:", _port);
            return _port;
          } else {
            console.warn("No existing ENTTEC DMX USB Pro port found. Prompting user to select a port.");
          }
        }
      }

      const port = await navigator.serial.requestPort({
        filters: dmx_setting.filters,
      });
      if (dmx_setting.filters.some((filter) => port.getInfo().usbVendorId === filter.usbVendorId && port.getInfo().usbProductId === filter.usbProductId)) {
        console.log("Selected port:", port);
        return port;
      } else {
        throw new Error("Selected device is not an ENTTEC DMX USB Pro.");
      }
    } catch (err) {
      throw err;
    }
  }

  async connect() {
    try {
      const port = await this.connectToDMX();

      await port.open({ baudRate: 250_000, stopBits: 2, dataBits: 8, parity: "none" });
      this._writer = port.writable.getWriter();
      this._device = port;

      if (!this.supported) {
        throw new Error("WebUSB is not supported in this browser.");
      }

      // initialize DMX data to zeros
      this.send();

      this._status = STATUS.CONNECTED;

      // Start the periodic sending of DMX data
      this._timer = setInterval(() => {
        this.send();
      }, 250); // 250msごとにDMXデータを送信
    } catch (err) {
      if (this._timer) {
        clearInterval(this._timer);
        this._timer = null;
      }
      throw err;
    }
  }

  async disconnect() {
    if (this._device || this._device.opened || this._device.connected) {
      // Stop the periodic sending of DMX data
      if (this._timer) {
        clearInterval(this._timer);
        this._timer = null;
      }

      // reset DMX data to zeros before disconnecting
      this.clear();
      await this.send();
      await this._writer.releaseLock();
      await this._device.close();
      this._writer = null;
      this._device = null;
      this._status = STATUS.IDLE;
    }
  }

  /**
   *
   * @param {object} dmxData  - e.g. {1: 255, 2: 128, ...}
   */
  update(dmxData) {
    for (const [channel, value] of Object.entries(dmxData)) {
      const ch = parseInt(channel);
      if (ch >= 1 && ch <= 512) {
        this._dmxArray[ch - 1] = value;
      }
    }
  }

  clear() {
    this._dmxArray.fill(0);
  }

  /**
   *
   * @param {object} dmxData  - e.g. {1: 255, 2: 128, ...}
   */
  async send() {
    if (!this._device || !(this._device.opened || this._device.connected)) {
      throw new Error("Device is not connected");
    }

    try {
      const dataToSend = concatUint8Arrays([HEADER, this._dmxArray, END_BYTE]);
      await this._writer.ready;
      await this._writer.write(dataToSend);
      return this._dmxArray;
    } catch (err) {
      throw err;
    }
  }

  test() {
    console.log("DMXWrapper test method called");
  }
}
