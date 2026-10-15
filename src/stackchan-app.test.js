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
  ["StackChan-Serial", 1],
])("receiving sensor events on %s sends the heart expression and smile", async (label, expectedSends) => {
  await renderApp();
  fireEvent.click(screen.getByRole("switch", { name: label }));
  await waitFor(() => expect(screen.getByRole("switch", { name: label })).toBeChecked());
  const wrapper = StackChanWrapper.mock.results[0].value;
  act(() => wrapper.onReceive({ type: "events", events: { touch_front: 1 } }));
  await waitFor(() => expect(wrapper.send).toHaveBeenCalledTimes(expectedSends));
  if (expectedSends) expect(wrapper.send).toHaveBeenCalledWith({ expression: "happy_heart", mouth: { type: "smile" } });
});

test.each(["StackChan-BT", "StackChan-Serial"])("%s ignores connection-ready and inactive sensor messages", async (label) => {
  await renderApp();
  fireEvent.click(screen.getByRole("switch", { name: label }));
  await waitFor(() => expect(screen.getByRole("switch", { name: label })).toBeChecked());
  const wrapper = StackChanWrapper.mock.results[0].value;
  act(() => {
    wrapper.onReceive({ ready: true, mode: "serial" });
    wrapper.onReceive({ type: "events", events: { touch_front: 0, touch_middle: 0, touch_back: 0, touch_click: 0, shake: 0 } });
    wrapper.onReceive({ ok: true, expression: "neutral" });
  });
  expect(wrapper.send).not.toHaveBeenCalled();
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
    wrapper.onReceive({ type: "events", events: { shake: 0 } });
    wrapper.connected = false;
    wrapper.onReceive({ type: "events", events: { touch_front: 1 } });
  });
  expect(wrapper.send).not.toHaveBeenCalled();
});

test.each(["StackChan-BT", "StackChan-Serial"])("%s keeps the reaction for three seconds after the last event and restores the latest VMT appearance", async (label) => {
  const { container, unmount } = await renderApp();
  const faceTrack = container.querySelector('track[src="/assets/stackchan_face.vmt"]');
  const mouthTrack = container.querySelector('track[src="/assets/stackchan_mouth.vmt"]');
  faceTrack.track.activeCues = [{ type: "org.webvmt.example.stackchan", value: { expression: "sleepy" } }];
  mouthTrack.track.activeCues = [{ type: "org.webvmt.example.stackchan", value: { mouth: { type: "open", open_ratio: 30 } } }];
  fireEvent.click(screen.getByRole("switch", { name: label }));
  await waitFor(() => expect(screen.getByRole("switch", { name: label })).toBeChecked());
  const wrapper = StackChanWrapper.mock.results[0].value;
  wrapper.send.mockClear();
  jest.useFakeTimers();
  try {
    act(() => wrapper.onReceive({ type: "events", events: { touch_front: 1 } }));
    expect(wrapper.send).toHaveBeenLastCalledWith({ expression: "happy_heart", mouth: { type: "smile" } });
    act(() => jest.advanceTimersByTime(1000));
    faceTrack.track.activeCues = [{ type: "org.webvmt.example.stackchan", value: { expression: "neutral" } }];
    mouthTrack.track.activeCues = [{ type: "org.webvmt.example.stackchan", value: { mouth: { type: "open", open_ratio: 100 } } }];
    await act(async () => {
      fireEvent(faceTrack, new Event("cuechange"));
      fireEvent(mouthTrack, new Event("cuechange"));
    });
    expect(wrapper.send).toHaveBeenCalledTimes(1);
    const moveTrack = container.querySelector('track[src="/assets/stackchan_move.vmt"]');
    const movement = { servo: { x: 0, y: 30, duration: 1000 } };
    moveTrack.track.activeCues = [{ type: "org.webvmt.example.stackchan", value: movement }];
    await act(async () => fireEvent(moveTrack, new Event("cuechange")));
    expect(wrapper.send).toHaveBeenLastCalledWith(movement);
    act(() => wrapper.onReceive({ type: "events", events: { touch_middle: 1 } }));
    act(() => wrapper.onReceive({ ok: true, expression: "happy_heart", mouth: "smile" }));
    act(() => jest.advanceTimersByTime(2999));
    expect(wrapper.send).toHaveBeenCalledTimes(3);
    act(() => jest.advanceTimersByTime(1));
    expect(wrapper.send).toHaveBeenCalledTimes(4);
    expect(wrapper.send).toHaveBeenLastCalledWith({ expression: "neutral", mouth: { type: "open", open_ratio: 100 } });
    await act(async () => fireEvent(mouthTrack, new Event("cuechange")));
    expect(wrapper.send).toHaveBeenLastCalledWith({ mouth: { type: "open", open_ratio: 100 } });
  } finally {
    unmount();
    jest.useRealTimers();
  }
});

test.each(["disconnect", "unmount"])("reaction restoration is cancelled on %s", async (action) => {
  const { unmount } = await renderApp();
  fireEvent.click(screen.getByRole("switch", { name: "StackChan-Serial" }));
  await waitFor(() => expect(screen.getByRole("switch", { name: "StackChan-Serial" })).toBeChecked());
  const wrapper = StackChanWrapper.mock.results[0].value;
  jest.useFakeTimers();
  try {
    act(() => wrapper.onReceive({ type: "events", events: { touch_front: 1 } }));
    if (action === "unmount") {
      unmount();
    } else {
      act(() => { wrapper.connected = false; wrapper.onConnectionChange(false); });
      wrapper.connected = true;
    }
    act(() => jest.advanceTimersByTime(3000));
    expect(wrapper.send).toHaveBeenCalledTimes(1);
  } finally {
    unmount();
    jest.useRealTimers();
  }
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
