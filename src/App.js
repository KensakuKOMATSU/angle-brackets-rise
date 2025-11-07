import { useEffect, useCallback, useState, useRef } from 'react';
import AudioVisualizer from './components/audio-visualizer'

import './App.css';


function App() {
  const [ _lyrics, setLyrics ] = useState([])
  const _trackRef = useRef(null);
  const _videoRef = useRef(null);
  const _called = useRef( false )
  const _visualizerRef = useRef()

const _setOnCueChangeEventForVMT = useCallback(() => {
  const trackElements = document.querySelectorAll('track[kind="metadata"]');
  const defaultColor = 'rgb(129, 140, 248)'; // 薄い紫色 (Indigo-300)

  for (const trackElement of trackElements) {
    const forValue = trackElement.getAttribute('for');

    if (forValue && trackElement.track) {
      trackElement.addEventListener('cuechange', async () => {
        const activeCues = trackElement.track.activeCues;
        if (activeCues && activeCues.length > 0) {
          const currentCue = activeCues[0]; // obtain DataCue

          if (currentCue.type === 'org.webvmt.example.lighting') {
            console.log(forValue, currentCue.value)
            _visualizerRef.current.updateColor( forValue, currentCue.value )
            
            //  drawLight({ lightId: forValue, ...currentCue.value, text: JSON.stringify(currentCue.value, null, 2) });
            //  if( dmx.connected ) {
            //      const dmxData = datacue2dmx(forValue, currentCue.value);
            //      dmx.update(dmxData);
            //      await dmx.send();
            //      log( JSON.stringify( dmxData ) );
            //  }
          }
        } else {
          console.log(forValue, 'no active cues')
          _visualizerRef.current.updateColor( forValue, { color: defaultColor } )
          //  _colorObj.current = { ..._colorObj.current, [forValue]: defaultColor }
          //initLight(forValue);
          //if( dmx.connected ) {
          //    dmx.clear();
          //    await dmx.send();
          //    log( 'No active cue. DMX cleared.' );
          //}
        }
      })
      _visualizerRef.current.updateColor( forValue, { color: defaultColor } )
      //initLight(forValue);
    }
  }
}, [])


  useEffect(() => {
    if( _trackRef.current ) {
      // to prevent called twice.
      if( _called.current ) return
      _called.current = true

      // set oncuechange event for VTT
      _trackRef.current.oncuechange = function() {
        const cues = _trackRef.current.track.activeCues;

        if( cues.length === 0 ) {
          setLyrics([])
        } else {
          setLyrics(cues[ cues.length - 1 ].text.split("\n"))
        }
      };

      ( async () => {
        // set loadVmtFiles & 
        await window._loadVmtFiles();
        _setOnCueChangeEventForVMT();
      })();
    }
  }, [ _setOnCueChangeEventForVMT ])

  return (
    <div className="App">
      <main>
        <div className="App-content">
          <div className="header">
            <h1>Angle Brackets Rise</h1>
          </div>
          <div className="media-controller">
            <video style={{width: "50vw"}} controls ref={_videoRef}>
              <source src="/assets/angle_brackets_rise.m4a" type="audio/mpeg" />
              <track ref={_trackRef} src="/assets/lyric.vtt" kind="subtitles" srcLang="en" label="English" default />
              <track src="/assets/dmx-left.vmt" kind="metadata" for="left" default/>
              <track src="/assets/dmx-right.vmt" kind="metadata" for="right" default/>
            </video>
          </div>
          <div className="lyric">
            { _lyrics.map( (line, key) => (
              <div key={key}>{line}</div>
            ))}
          </div>
          <AudioVisualizer videoElem={_videoRef.current} ref={ _visualizerRef } />
        </div>
      </main>
    </div>
  );
}

export default App;
