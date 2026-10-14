const SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const RX_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
const TX_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

export default class StackChanWrapper {
    constructor({ transport = "serial", onConnectionChange = () => { }, onReceive = () => { }, onError = () => { } } = {}) {
        this.transport = transport;
        this.onConnectionChange = onConnectionChange;
        this.onReceive = onReceive;
        this.onError = onError;
        this.connected = false;
        this._encoder = new TextEncoder();
        this._decoder = new TextDecoder();
        this._pendingReceive = "";
        this._sendQueue = Promise.resolve();
        this._onSerialDisconnect = (event) => {
            if (event.target === this._port || event.port === this._port) {
                this.disconnect().catch(this.onError);
            }
        };
        this._onBluetoothDisconnect = () => {
            this.disconnect().catch(this.onError);
        };
        this._onNotification = (event) => this._receive(event.target.value);
    }

    get supported() {
        return this.transport === "serial" ? !!navigator.serial : !!navigator.bluetooth;
    }

    _setConnected(connected) {
        this.connected = connected;
        this.onConnectionChange(connected);
    }

    async connect() {
        if (this.connected) return;
        if (!this.supported) {
            throw new Error(`Web ${this.transport === "serial" ? "Serial" : "Bluetooth"} is not supported. Use Chrome or Edge on HTTPS or localhost.`);
        }

        this._decoder = new TextDecoder();
        this._pendingReceive = "";
        try {
            if (this.transport === "serial") {
                const port = await navigator.serial.requestPort();
                await port.open({ baudRate: 115200 });
                this._port = port;
                this._writer = port.writable.getWriter();
                navigator.serial.addEventListener("disconnect", this._onSerialDisconnect);
                this._setConnected(true);
                this._readTask = this._readSerial();
            } else {
                this._device = await navigator.bluetooth.requestDevice({
                    filters: [{ services: [SERVICE_UUID] }],
                });
                this._device.addEventListener("gattserverdisconnected", this._onBluetoothDisconnect);
                const server = await this._device.gatt.connect();
                const service = await server.getPrimaryService(SERVICE_UUID);
                this._rx = await service.getCharacteristic(RX_UUID);
                this._tx = await service.getCharacteristic(TX_UUID);
                this._tx.addEventListener("characteristicvaluechanged", this._onNotification);
                await this._tx.startNotifications();
                if (!this._device?.gatt.connected) throw new Error("StackChan disconnected during connection.");
                this._setConnected(true);
            }
        } catch (error) {
            await this.disconnect().catch(this.onError);
            throw error;
        }
    }

    _receive(value) {
        this._pendingReceive += this._decoder.decode(value, { stream: true });
        const lines = this._pendingReceive.split(/\r?\n/);
        this._pendingReceive = lines.pop();
        for (const line of lines.filter(Boolean)) {
            let message = line;
            try {
                message = JSON.parse(line);
            } catch {
            }
            this.onReceive(message);
        }
    }

    async _readSerial() {
        const reader = this._port.readable.getReader();
        this._reader = reader;
        try {
            while (this.connected) {
                const { value, done } = await reader.read();
                if (done) break;
                this._receive(value);
            }
        } catch (error) {
            if (this.connected) this.onError(error);
        } finally {
            reader.releaseLock();
            this._reader = null;
            if (this.connected) this.disconnect().catch(this.onError);
        }
    }

    send(data) {
        if (!this.connected) return Promise.reject(new Error("StackChan is not connected."));
        const payload = JSON.stringify({ ...data, command: "control" });
        const writer = this._writer;
        const rx = this._rx;
        const sendTask = this._sendQueue.then(async () => {
            if (!this.connected || writer !== this._writer || rx !== this._rx) {
                throw new Error("StackChan disconnected before sending.");
            }
            if (this.transport === "serial") {
                await writer.write(this._encoder.encode(`${payload}\n`));
            } else {
                await rx.writeValueWithResponse(this._encoder.encode(payload));
            }
        });
        this._sendQueue = sendTask.catch(() => { });
        return sendTask;
    }

    disconnect() {
        if (this._disconnectTask) return this._disconnectTask;
        this._setConnected(false);
        this._disconnectTask = this._close().finally(() => {
            this._disconnectTask = null;
        });
        return this._disconnectTask;
    }

    async _close() {
        try {
            if (this.transport === "serial") {
                navigator.serial?.removeEventListener("disconnect", this._onSerialDisconnect);
                try {
                    await this._reader?.cancel();
                } finally {
                    await this._readTask;
                    await this._sendQueue;
                    this._writer?.releaseLock();
                    if (this._port) await this._port.close();
                }
            } else {
                this._device?.removeEventListener("gattserverdisconnected", this._onBluetoothDisconnect);
                this._tx?.removeEventListener("characteristicvaluechanged", this._onNotification);
                await this._sendQueue;
                if (this._device?.gatt.connected) this._device.gatt.disconnect();
            }
        } finally {
            this._port = null;
            this._writer = null;
            this._reader = null;
            this._readTask = null;
            this._device = null;
            this._rx = null;
            this._tx = null;
            this._pendingReceive = "";
        }
    }
}