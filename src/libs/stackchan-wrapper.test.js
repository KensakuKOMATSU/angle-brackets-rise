import { TextDecoder, TextEncoder } from "util";
import StackChanWrapper from "./stackchan-wrapper";

const serviceUuid = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const rxUuid = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
const txUuid = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";
const decoder = new TextDecoder();
const encoder = new TextEncoder();

beforeAll(() => {
    global.TextEncoder = TextEncoder;
    global.TextDecoder = TextDecoder;
});

afterEach(() => {
    delete navigator.serial;
    delete navigator.bluetooth;
});

function mockSerial() {
    let finishRead;
    const reader = {
        read: jest.fn(() => new Promise((resolve) => { finishRead = resolve; })),
        cancel: jest.fn(async () => finishRead?.({ done: true })),
        releaseLock: jest.fn(),
    };
    const writer = { write: jest.fn(async () => { }), releaseLock: jest.fn() };
    const port = {
        open: jest.fn(async () => { }),
        close: jest.fn(async () => { }),
        readable: { getReader: () => reader },
        writable: { getWriter: () => writer },
    };
    navigator.serial = Object.assign(new EventTarget(), { requestPort: jest.fn(async () => port) });
    return { port, reader, writer, receive: (text) => finishRead({ value: encoder.encode(text), done: false }) };
}

function mockBluetooth() {
    const rx = { writeValueWithResponse: jest.fn(async () => { }) };
    const tx = Object.assign(new EventTarget(), { startNotifications: jest.fn(async () => { }) });
    const service = { getCharacteristic: jest.fn(async (uuid) => uuid === rxUuid ? rx : tx) };
    const server = { getPrimaryService: jest.fn(async () => service) };
    const device = new EventTarget();
    device.gatt = {
        connected: false,
        connect: jest.fn(async () => { device.gatt.connected = true; return server; }),
        disconnect: jest.fn(() => {
            device.gatt.connected = false;
            device.dispatchEvent(new Event("gattserverdisconnected"));
        }),
    };
    navigator.bluetooth = { requestDevice: jest.fn(async () => device) };
    return { device, rx, tx, service, server };
}

test("Serial sends VMT data as newline-delimited control JSON and releases its streams", async () => {
    const { port, reader, writer } = mockSerial();
    const onConnectionChange = jest.fn();
    const wrapper = new StackChanWrapper({ onConnectionChange });
    await wrapper.connect();
    const data = { mouth: { type: "open", open_ratio: 100 } };
    await wrapper.send(data);
    expect(port.open).toHaveBeenCalledWith({ baudRate: 115200 });
    expect(decoder.decode(writer.write.mock.calls[0][0])).toBe(`${JSON.stringify({ ...data, command: "control" })}\n`);
    expect(data).not.toHaveProperty("command");
    await wrapper.disconnect();
    expect(reader.cancel).toHaveBeenCalled();
    expect(reader.releaseLock).toHaveBeenCalled();
    expect(writer.releaseLock).toHaveBeenCalled();
    expect(port.close).toHaveBeenCalled();
    expect(onConnectionChange.mock.calls).toEqual([[true], [false]]);
});

test("Serial reconstructs split responses and preserves non-JSON log lines", async () => {
    const serial = mockSerial();
    const onReceive = jest.fn();
    const wrapper = new StackChanWrapper({ onReceive });
    await wrapper.connect();
    serial.receive('{"ok":');
    await Promise.resolve();
    serial.receive('true}\r\nready\n');
    await Promise.resolve();
    expect(onReceive.mock.calls).toEqual([[{ ok: true }], ["ready"]]);
    await wrapper.disconnect();
});

test("Bluetooth uses the reference UART service and serializes simultaneous VMT commands", async () => {
    const { rx, tx, server, service } = mockBluetooth();
    const wrapper = new StackChanWrapper({ transport: "bluetooth" });
    await wrapper.connect();
    expect(navigator.bluetooth.requestDevice).toHaveBeenCalledWith({ filters: [{ services: [serviceUuid] }] });
    expect(server.getPrimaryService).toHaveBeenCalledWith(serviceUuid);
    expect(service.getCharacteristic.mock.calls).toEqual([[rxUuid], [txUuid]]);
    expect(tx.startNotifications).toHaveBeenCalled();
    let finishWrite;
    rx.writeValueWithResponse.mockImplementationOnce(() => new Promise((resolve) => { finishWrite = resolve; }));
    const first = wrapper.send({ expression: "happy" });
    const second = wrapper.send({ servo: { x: 0, y: 45, duration: 100 } });
    await Promise.resolve();
    expect(rx.writeValueWithResponse).toHaveBeenCalledTimes(1);
    finishWrite();
    await Promise.all([first, second]);
    expect(rx.writeValueWithResponse.mock.calls.map(([value]) => JSON.parse(decoder.decode(value)))).toEqual([
        { command: "control", expression: "happy" },
        { command: "control", servo: { x: 0, y: 45, duration: 100 } },
    ]);
    expect(decoder.decode(rx.writeValueWithResponse.mock.calls[0][0])).not.toContain("\n");
    await wrapper.disconnect();
});

test("Bluetooth reconstructs notification frames and reports unexpected disconnection", async () => {
    const { device, tx } = mockBluetooth();
    const onReceive = jest.fn();
    const onConnectionChange = jest.fn();
    const wrapper = new StackChanWrapper({ transport: "bluetooth", onReceive, onConnectionChange });
    await wrapper.connect();
    for (const text of ['{"ok":', 'true}\n']) {
        const event = new Event("characteristicvaluechanged");
        tx.value = new DataView(encoder.encode(text).buffer);
        tx.dispatchEvent(event);
    }
    expect(onReceive).toHaveBeenCalledWith({ ok: true });
    device.gatt.disconnect();
    expect(wrapper.connected).toBe(false);
    expect(onConnectionChange).toHaveBeenLastCalledWith(false);
    await wrapper.disconnect();
});

test("failed Bluetooth setup disconnects the partially opened connection", async () => {
    const { device, tx } = mockBluetooth();
    tx.startNotifications.mockRejectedValueOnce(new Error("notifications failed"));
    const wrapper = new StackChanWrapper({ transport: "bluetooth" });
    await expect(wrapper.connect()).rejects.toThrow("notifications failed");
    expect(device.gatt.disconnect).toHaveBeenCalled();
    expect(wrapper.connected).toBe(false);
});

test("a failed send does not block subsequent cues", async () => {
    const { rx } = mockBluetooth();
    const wrapper = new StackChanWrapper({ transport: "bluetooth" });
    await wrapper.connect();
    rx.writeValueWithResponse.mockRejectedValueOnce(new Error("write failed"));
    await expect(wrapper.send({ expression: "happy" })).rejects.toThrow("write failed");
    await expect(wrapper.send({ expression: "neutral" })).resolves.toBeUndefined();
    await wrapper.disconnect();
});

test("unsupported browsers and disconnected sends fail explicitly", async () => {
    const wrapper = new StackChanWrapper();
    expect(wrapper.supported).toBe(false);
    await expect(wrapper.connect()).rejects.toThrow("Web Serial is not supported");
    await expect(wrapper.send({ expression: "happy" })).rejects.toThrow("not connected");
});