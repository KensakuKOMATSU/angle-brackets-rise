const ENTTEC_PRO_DMX_STARTCODE = 0x00
const ENTTEC_PRO_START_OF_MSG = 0x7e
const ENTTEC_PRO_END_OF_MSG = 0xe7
const ENTTEC_PRO_SEND_DMX_RQ = 0x06

const UNIVERSE_LENGTH = 513 

const lengthLSB = UNIVERSE_LENGTH & 0xff;          // 下位8ビット (Least Significant Byte)
const lengthMSB = (UNIVERSE_LENGTH >> 8) & 0xff;   // 上位8ビット (Most Significant Byte)

// ヘッダー部分を Uint8Array で定義
const HEADER = new Uint8Array([
    ENTTEC_PRO_START_OF_MSG,
    ENTTEC_PRO_SEND_DMX_RQ,
    lengthLSB, // データ長 LSB
    lengthMSB, // データ長 MSB
    ENTTEC_PRO_DMX_STARTCODE,
]);

const END_BYTE = new Uint8Array([ENTTEC_PRO_END_OF_MSG]);

const STATUS = {
    IDLE: 'idle',
    CONNECTED: 'connected',
};

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
    _filters = [{ vendorId: 1027 }]; // ENTTECのベンダーID
    _interfaceNumber = 0;
    _endpointNumber = 2;
    _dmxArray = new Uint8Array(UNIVERSE_LENGTH - 1); // DMXデータ部分（512バイト）
    _status = STATUS.IDLE;
    _timer;

    //constructor() {
    //}

    get status() {
        return this._status;
    }

    get connected() {
        return this._status === STATUS.CONNECTED;
    }

    get supported() {
        return !!navigator.usb;
    }

    async connect() {
        try {
            if( !this.supported ) {
                throw new Error("WebUSB is not supported in this browser.");
            }
            this._device = await navigator.usb.requestDevice({ filters: this._filters });
            await this._device.open();
            const configurationValue = this._device.configuration ? this._device.configuration.configurationValue : 1;
            await this._device.selectConfiguration(configurationValue);
            await this._device.claimInterface(this._interfaceNumber);
            const out = this._device.configuration.interfaces[0].alternate.endpoints.find( item => item.direction === 'out' );
            this._endpointNumber = out.endpointNumber;

            // initialize DMX data to zeros
            this.send();

            this._status = STATUS.CONNECTED;

            // Start the periodic sending of DMX data
            this._timer = setInterval(() => {
                this.send();
            }, 250); // 250msごとにDMXデータを送信
        } catch (err) {
            if( this._timer ) {
                clearInterval(this._timer);
                this._timer = null;
            }
            throw err;
        }
    }

    async disconnect() {
        if (this._device && this._device.opened) {
            // Stop the periodic sending of DMX data
            if( this._timer ) {
                clearInterval(this._timer);
                this._timer = null;
            }

            // reset DMX data to zeros before disconnecting
            this.clear();
            await this.send();
            await this._device.close();
            this._device = null;
            this._status = STATUS.IDLE;
        }
    }

    /**
     * 
     * @param {object} dmxData  - e.g. {1: 255, 2: 128, ...}
     */
    update( dmxData ) {
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
        if (!this._device || !this._device.opened) {
            throw new Error("Device is not connected");
        }

        try {
            const dataToSend = concatUint8Arrays([HEADER, this._dmxArray, END_BYTE]);
            await this._device.transferOut(this._endpointNumber, dataToSend);
            return this._dmxArray;
        } catch (err) {
            throw err;
        }
    }

    test() {
        console.log("DMXWrapper test method called");
    }
}