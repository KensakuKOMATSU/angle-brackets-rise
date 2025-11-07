//const map = {
//    1: "pan", 2: "tilt", 3: "dimmer", 4: "red", 5: "green", 6: "blue", 7: "white", 8: "speed"
//};

const map = {
    1: "red", 2: "green", 3: "blue", 4: "pan"
}

export const colors = [
    'rgb(0, 119, 204)',
    'rgb(255, 127, 0)'
]

export const dmxConfigs = [
    { id: 0, name: "light0", start_address: 1, map },
    { id: 1, name: "light1", start_address: 10, map },
]