

class DataCue extends VTTCue {
  _value;
  _type;
  constructor( startTime, endTime, value, type ) {
    super( startTime, endTime, JSON.stringify( value ) );
    this._value = value;
    this._type = type;
  }
  get value() {
    return this._value
  }
  get type() {
    return this._type;
  }
}

/**
 * type VmtData = {
 *   startTime: number; // start time（in seconds. double)
 *   endTime: number; // end time（in seconds. double)
 *   data: object; // VMT data object 
 *   type: string; // VMT data type (e.g., "org.webvmt.lighting-example")
 * };
 * 
 */

// track タグの src 属性で設定された vmt ファイルを読み込む関数
/**
 * 
 * @returns {Map<string, VmtData[]>} mapVmt - Map to store VMT data by 'for' attribute value
 */
const loadVmtFiles = async () => {
  const mapVmt = new Map();

  const videos = document.querySelectorAll('video');

  let called = 0
  for( const video of videos ) {
  //videos.forEach(video => {
    const tracks = video.querySelectorAll('track[kind="metadata"]');

    //tracks.forEach( async (track) => {
    for( const track of tracks ) {
      const vmtFile = track.src;
      // obtain for attribute from track element
      const forValue = track.getAttribute('for');

      // Fetch the VMT file
      try {
        const data = await fetch(vmtFile)
          .then(response => response.text())
        //console.log( data )

        const vmtData = parseVmtFile(data);
        mapVmt.set(forValue, vmtData);
      } catch( e ) {
        console.error(`Error loading VMT file: ${vmtFile}`, e);
      }
    }
  }
  return mapVmt;
};

/**
 * 
 * Function to parse VMT file content
 * The VMT file format is expected to have lines like:
 * ```
 * 00:00:07.000 --> 00:00:09.500
 * { "sync":
 *     { "type": "org.webvmt.lighting-example", "id": "light1", "data":
 *         { "pan": 32, "tilt": 160, "dimmer": 255, "color": "rgb( 0, 0, 255 )" }
 *     }
 * }
 * ```
 * @param {string} data - VMT file content as a string
 * @returns {VmtData[]} vmtDatas - Array of VMT data objects
 */
const parseVmtFile = (data) => {
  // load each line of the VMT file
    const vmtLines = data.split('\n');

    const vmtDatas = [];
    vmtLines.forEach((line, index) => {
      // Find the line with time information  
      const timeMatch = line.match(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2})\.(\d{3})/);
      if (timeMatch) {
            const startTime = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3]) + parseInt(timeMatch[4]) / 1000;
            const endTime = parseInt(timeMatch[5]) * 3600 + parseInt(timeMatch[6]) * 60 + parseInt(timeMatch[7]) + parseInt(timeMatch[8]) / 1000;
            // 次の行から 空白行までの行を読み取る
            const arr = []
            while( index + 1 < vmtLines.length && vmtLines[index + 1].trim() !== '') {
                index++;
                arr.push( vmtLines[index].trim() );
            }
            const jsonStr = arr.join("");
            try {
                const jsonData = JSON.parse(jsonStr);
                // jsonData の sync プロパティが存在する場合は、sync データを抽出
                if (jsonData.sync && jsonData.sync.data && jsonData.sync.type ) {
                  if( typeof jsonData.sync.data === 'object' ) {
                    vmtDatas.push( { startTime, endTime, data: jsonData.sync.data, type: jsonData.sync.type })
                  }
                } else {
                  if( typeof jsonData === 'object' ) {
                    vmtDatas.push( { startTime, endTime, ...jsonData });
                  }
                }
            } catch( e ) {
                console.warn(`Error parsing JSON at line ${index + 1}:`, e);
                console.warn('JSON String:', jsonStr);
            }
        }
    })
    return vmtDatas;
};

async function _loadVmtFiles() {
  const mapVmt = await loadVmtFiles();

  for( const [key, vmtDatas] of mapVmt.entries()) {
    const trackElem = document.querySelector(`track[for="${key}"]`);
    if( trackElem && Array.isArray(vmtDatas) && vmtDatas.length > 0 ) {
      for( const vmtData of vmtDatas ) {
        if( typeof vmtData === 'object' && vmtData.startTime !== undefined && vmtData.endTime !== undefined && vmtData.data !== undefined ) {
          const cue = new DataCue(vmtData.startTime, vmtData.endTime, vmtData.data, vmtData.type);
          cue.onenter = () => {
            //console.log(`Cue entered: %o, type: %s`, cue.value, cue.type);
          };
          cue.onexit = () => {
            //console.log(`Cue exited: %o, type: %s`, cue.value, cue.type);
          };
          trackElem.track.addCue(cue);
        }
      }
    }
  }
}

// start loading VMT files when the window loads
//window.addEventListener('DOMContentLoaded', async () => {
//    await _loadVmtFiles();
//})