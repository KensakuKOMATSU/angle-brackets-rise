# Angle Brackets Rise

Web based time aligment synchronization demo for media and lighting device.

This demo is for special song, `Angle Brackets Rise`, which was for 'Kobe Developer Meetup' - related event of TPAC 2025 in Kobe.

In this demonstration, I'm using WebVMT/DataCue API extension for WebVTT which is under propsing state in WICG, W3C.
My current activity is to apply lighting device control signal in it. For example, DMX device.

## demo

* https://song4kobedevmeetup.netlify.app/

> please note that only ENTTEC DMX USB PRO is supported. Most cases, you need to change dmx setting as well. ( do not use WinUSB driver for windows )
> This demo uses Web Serial API which means chrome and edge is now suppoted.

## StackChan

The bottom switches `StackChan-Serial` and `StackChan-BT` connect independently.
Use Chrome or Edge with the relevant Web Serial / Web Bluetooth API available,
on HTTPS or localhost. Select the StackChan serial port or BLE device when
turning its switch on. Turning it off disconnects. The existing keyboard
shortcuts are unchanged; connect StackChan using its own switch.

Playback sends the active JSON data from these metadata tracks:

* `public/assets/stackchan_mouth.vmt`: `mouth` (`type`, `open_ratio`, 0-100).
* `public/assets/stackchan_move.vmt`: `servo` (`x`, `y`, `duration`).
* `public/assets/stackchan_face.vmt`: `expression`.

Use `sync.type: "org.webvmt.example.stackchan"` and put the control fields in
`sync.data`. The wrapper adds `command: "control"` without changing the cue.
Both enabled transports receive the same control JSON. Active cues are also
sent when connecting during playback. Each transport queues writes so
simultaneous mouth, movement and expression cues do not overlap BLE operations.

Serial uses 115200bps and a trailing LF, matching the reference controller.
Bluetooth uses the Nordic UART service `6e400001-b5a3-f393-e0a9-e50e24dcca9e`,
RX `6e400002-b5a3-f393-e0a9-e50e24dcca9e` with `writeValueWithResponse` (no LF),
and TX `6e400003-b5a3-f393-e0a9-e50e24dcca9e` notifications for reception.
Newline-delimited responses are reassembled and logged in the browser console
as `StackChan serial RX` / `StackChan bluetooth RX`; connection and send errors
also appear below the switches. The implementation is in
`src/libs/stackchan-wrapper.js`.

---
&copy; Kensaku Komatsu.
