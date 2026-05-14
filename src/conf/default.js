// set dmx map for your dmx device.
const map = {
    1: "pan", 2: "tilt", 3: "dimmer", 4: "red", 5: "green", 6: "blue", 7: "white", 8: "speed"
};

// set dmx configs for your dmx device.
export const dmxConfigs = [
    { id: 0, name: "light0", start_address: 1, map },
    { id: 1, name: "light1", start_address: 10, map },
]