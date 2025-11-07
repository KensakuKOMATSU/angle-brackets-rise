import { dmxConfigs } from "../conf/default.js";

const objConfigId = {
    "right": 0,
    "left": 1
}

/**
 * converts a data cue to DMX data
 * 
 * @param {string} lightId - e.g. "left", "right"
 * @param {Object} value - cue value object e.g. { pan: 90, tilt: 45, dimmer: 255, color: "rgb(255, 0, 0)" }
 * @returns {Object} DMX data object { channelNumber: value, ... }
 */
export const datacue2dmx = ( lightId, value ) => {
    const dmxData = {};
    const id = objConfigId[lightId];

    const dmxConfig = dmxConfigs.find( config => config.id === id );
    const startAddress = dmxConfig.start_address;
    const map = dmxConfig.map;

    for (const [channelOffset, name] of Object.entries(map)) {
        let channelNumber = startAddress + (channelOffset - 1);
        let channelValue = 0;

        if (name === 'pan' || name === 'tilt' || name === 'dimmer' || name === 'white' || name === 'speed') {
            channelValue = value[name] || 0;
        } else if (name === 'red') {
            const rgb = value.color.match(/\d+/g).map(Number);
            channelValue = rgb[0] || 0;
        } else if (name === 'green') {
            const rgb = value.color.match(/\d+/g).map(Number);
            channelValue = rgb[1] || 0;
        } else if (name === 'blue') {
            const rgb = value.color.match(/\d+/g).map(Number);
            channelValue = rgb[2] || 0;
        }

        dmxData[channelNumber] = channelValue;
    }
    return dmxData;
}

