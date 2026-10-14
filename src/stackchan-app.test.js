import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App";
import StackChanWrapper from "./libs/stackchan-wrapper";

jest.mock("./libs/stackchan-wrapper");
jest.mock("./components/audio-visualizer", () => {
  const React = require("react");
  return React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({ updateColor: jest.fn() }));
    return null;
  });
});
jest.mock("./components/stars", () => {
  const React = require("react");
  return React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({ setColor: jest.fn() }));
    return null;
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  window._loadVmtFiles = jest.fn(async () => {
    for (const trackElement of document.querySelectorAll('track[kind="metadata"]')) {
      Object.defineProperty(trackElement, "track", {
        configurable: true,
        value: { activeCues: [] },
      });
    }
  });
  StackChanWrapper.mockImplementation((options) => {
    const wrapper = {
      ...options,
      connected: false,
      connect: jest.fn(async () => {
        wrapper.connected = true;
        wrapper.onConnectionChange(true);
      }),
      disconnect: jest.fn(async () => {
        wrapper.connected = false;
        wrapper.onConnectionChange(false);
      }),
      send: jest.fn(async () => { }),
    };
    return wrapper;
  });
});

async function renderApp() {
  const result = render(<App />);
  await act(async () => { });
  return result;
}

test("renders both StackChan switches and all three metadata tracks", async () => {
  const { container } = await renderApp();
  expect(screen.getByRole("switch", { name: "StackChan-Serial" })).not.toBeChecked();
  expect(screen.getByRole("switch", { name: "StackChan-BT" })).not.toBeChecked();
  for (const part of ["mouth", "move", "face"]) {
    expect(container.querySelector(`track[src="/assets/stackchan_${part}.vmt"]`)).toHaveAttribute("kind", "metadata");
  }
});

test("sends mouth, movement and expression cues to both connected transports only", async () => {
  const { container } = await renderApp();
  for (const label of ["StackChan-Serial", "StackChan-BT"]) {
    fireEvent.click(screen.getByRole("switch", { name: label }));
    await waitFor(() => expect(screen.getByRole("switch", { name: label })).toBeChecked());
  }
  const wrappers = StackChanWrapper.mock.results.map((result) => result.value);
  expect(StackChanWrapper.mock.calls.map(([options]) => options.transport)).toEqual(["serial", "bluetooth"]);
  const commands = [
    ["mouth", { mouth: { type: "open", open_ratio: 100 } }],
    ["move", { servo: { x: 0, y: 45, duration: 100 } }],
    ["face", { expression: "happy" }],
  ];
  for (const [part, value] of commands) {
    const trackElement = container.querySelector(`track[src="/assets/stackchan_${part}.vmt"]`);
    Object.defineProperty(trackElement.track, "activeCues", {
      configurable: true,
      value: [{ type: "org.webvmt.example.stackchan", value }],
    });
    await act(async () => { fireEvent(trackElement, new Event("cuechange")); });
    for (const wrapper of wrappers) expect(wrapper.send).toHaveBeenLastCalledWith(value);
  }
  fireEvent.click(screen.getByRole("switch", { name: "StackChan-BT" }));
  await waitFor(() => expect(screen.getByRole("switch", { name: "StackChan-BT" })).not.toBeChecked());
  const faceTrack = container.querySelector('track[src="/assets/stackchan_face.vmt"]');
  await act(async () => { fireEvent(faceTrack, new Event("cuechange")); });
  expect(wrappers[0].send).toHaveBeenCalledTimes(4);
  expect(wrappers[1].send).toHaveBeenCalledTimes(3);
});

test("connection synchronizes active cues and unexpected disconnection turns the switch off", async () => {
  const { container } = await renderApp();
  const faceTrack = container.querySelector('track[src="/assets/stackchan_face.vmt"]');
  Object.defineProperty(faceTrack.track, "activeCues", {
    configurable: true,
    value: [{ type: "org.webvmt.example.stackchan", value: { expression: "neutral" } }],
  });
  fireEvent.click(screen.getByRole("switch", { name: "StackChan-Serial" }));
  await waitFor(() => expect(screen.getByRole("switch", { name: "StackChan-Serial" })).toBeChecked());
  const wrapper = StackChanWrapper.mock.results[0].value;
  expect(wrapper.send).toHaveBeenCalledWith({ expression: "neutral" });
  act(() => { wrapper.connected = false; wrapper.onConnectionChange(false); });
  expect(screen.getByRole("switch", { name: "StackChan-Serial" })).not.toBeChecked();
});

test.each([
  ["StackChan-BT", 1],
  ["StackChan-Serial", 0],
])("receiving sensor events on %s sends the heart expression only over Bluetooth", async (label, expectedSends) => {
  await renderApp();
  fireEvent.click(screen.getByRole("switch", { name: label }));
  await waitFor(() => expect(screen.getByRole("switch", { name: label })).toBeChecked());
  const wrapper = StackChanWrapper.mock.results[0].value;
  act(() => wrapper.onReceive({ type: "events", events: { touch_front: 1 } }));
  await waitFor(() => expect(wrapper.send).toHaveBeenCalledTimes(expectedSends));
  if (expectedSends) expect(wrapper.send).toHaveBeenCalledWith({ expression: "happy_heart", mouth: { type: "smile" } });
});

test("Bluetooth command replies and notifications after disconnection do not trigger heart commands", async () => {
  await renderApp();
  fireEvent.click(screen.getByRole("switch", { name: "StackChan-BT" }));
  await waitFor(() => expect(screen.getByRole("switch", { name: "StackChan-BT" })).toBeChecked());
  const wrapper = StackChanWrapper.mock.results[0].value;
  act(() => {
    wrapper.onReceive({ ok: true, expression: "happy_heart" });
    wrapper.onReceive({ ok: true, expression: "neutral" });
    wrapper.onReceive({ ok: false, error: "invalid command" });
    wrapper.connected = false;
    wrapper.onReceive({ type: "events", events: { touch_front: 1 } });
  });
  expect(wrapper.send).not.toHaveBeenCalled();
});

test("connection errors leave the switch off and are displayed", async () => {
  const consoleError = jest.spyOn(console, "error").mockImplementation(() => { });
  StackChanWrapper.mockImplementationOnce(() => ({
    connected: false,
    connect: jest.fn(async () => { throw new Error("Connection cancelled"); }),
    disconnect: jest.fn(async () => { }),
  }));
  await renderApp();
  fireEvent.click(screen.getByRole("switch", { name: "StackChan-BT" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("StackChan-BT: Connection cancelled");
  expect(screen.getByRole("switch", { name: "StackChan-BT" })).not.toBeChecked();
  consoleError.mockRestore();
});
