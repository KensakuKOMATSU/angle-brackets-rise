import { useEffect, useCallback, useState, useRef } from "react";
import AudioVisualizer from "./components/audio-visualizer";
import Stars from "./components/stars";

import DMXWrapper from "./libs/dmx-wrapper";
import { datacue2dmx } from "./libs/datacue2dmx";

import ByebyeworldWrapper from "./libs/byebyeworldclapper-wrapper";

import device_setting from "./device-setting.json";

import { Switch, Button } from "antd";

import "./App.css";

function App() {
  const CURSOR_HIDE_DELAY_MS = 2000;

  const [_lyrics, setLyrics] = useState([]);
  const _trackRef = useRef(null);
  const _videoRef = useRef(null);
  const _replayTimeoutRef = useRef(null);
  const _cursorHideTimeoutRef = useRef(null);
  const _called = useRef(false);
  const _visualizerRef = useRef();
  const _starsLeftRef = useRef();
  const _starsRightRef = useRef();
  const _dmxRef = useRef(null);
  const _handleRobotRef = useRef(null);

  const [_isVideoPlayed, setIsVideoPlayed] = useState(false);
  const [_isSwitchToggled, setIsSwitchToggled] = useState(false);
  const [_isClapperOn, setIsClapperOn] = useState(false);
  const [_isCursorVisible, setIsCursorVisible] = useState(true);

  const _resetCursorTimer = useCallback(() => {
    setIsCursorVisible(true);
    if (_cursorHideTimeoutRef.current) {
      clearTimeout(_cursorHideTimeoutRef.current);
    }

    _cursorHideTimeoutRef.current = setTimeout(() => {
      setIsCursorVisible(false);
    }, CURSOR_HIDE_DELAY_MS);
  }, [CURSOR_HIDE_DELAY_MS]);

  const _toggleClapper = useCallback(async (checked) => {
    console.log("Clapper Switch", checked);

    if (!_handleRobotRef.current) {
      _handleRobotRef.current = new ByebyeworldWrapper({
        filters: device_setting.find((f) => f.type === "clapper")?.filters,
      });
    }

    if (checked && _handleRobotRef.current.connected) {
      setIsClapperOn(true);
      return;
    }

    if (!checked && !_handleRobotRef.current.connected) {
      setIsClapperOn(false);
      return;
    }

    if (checked) {
      // 接続してから、スイッチをオンにする
      await _handleRobotRef.current
        .connect()
        .then(() => {
          console.log("Clapper Connected");
          setIsClapperOn(true);
        })
        .catch((err) => {
          setIsClapperOn(false);
          console.error("Clapper Connection Error:", err);
          return;
        });
    } else {
      // 切断してから、スイッチをオフにする
      await _handleRobotRef.current
        .disconnect()
        .then(() => {
          setIsClapperOn(false);
        })
        .catch((err) => {
          setIsClapperOn(true);
          console.error("Clapper Disconnection Error:", err);
          return;
        });
    }
  }, []);

  const _toggleDMX = useCallback(async (checked) => {
    console.log("DMX Switch", checked);
    if (!_dmxRef.current) {
      _dmxRef.current = new DMXWrapper();
    }

    if (checked && _dmxRef.current.connected) {
      setIsSwitchToggled(true);
      return;
    }

    if (!checked && !_dmxRef.current.connected) {
      setIsSwitchToggled(false);
      return;
    }

    if (checked) {
      await _dmxRef.current
        .connect()
        .then(() => {
          setIsSwitchToggled(true);
        })
        .catch((err) => {
          setIsSwitchToggled(false);
          console.error("DMX Connection Error:", err);
          return;
        });
    } else {
      await _dmxRef.current
        .disconnect()
        .then(() => {
          setIsSwitchToggled(false);
        })
        .catch((err) => {
          setIsSwitchToggled(true);
          console.error("DMX Disconnection Error:", err);
          return;
        });
    }
  }, []);

  const _pauseMusic = useCallback(async () => {
    if (_videoRef.current && !_videoRef.current.paused) {
      _videoRef.current.pause();
    }
  }, []);

  const _setOnCueChangeEventForVMT = useCallback(() => {
    const trackElements = document.querySelectorAll('track[kind="metadata"]');
    const defaultColor = "rgb(129, 140, 248)"; // 薄い紫色 (Indigo-300)

    for (const trackElement of trackElements) {
      const forValue = trackElement.getAttribute("for");

      if (forValue && trackElement.track) {
        trackElement.addEventListener("cuechange", async () => {
          const activeCues = trackElement.track.activeCues;
          if (activeCues && activeCues.length > 0) {
            const currentCue = activeCues[activeCues.length - 1]; // obtain DataCue

            if (currentCue.type === "org.webvmt.example.lighting") {
              //_visualizerRef.current.updateColor( forValue, currentCue.value )
              console.log("Current Cue for", forValue, ":", currentCue.value);
              if (forValue === "left") {
                _starsLeftRef.current.setColor(currentCue.value.color);
              } else if (forValue === "right") {
                _starsRightRef.current.setColor(currentCue.value.color);
              }

              if (_dmxRef.current && _dmxRef.current.connected) {
                const dmxData = datacue2dmx(forValue, currentCue.value);
                _dmxRef.current.update(dmxData);
                await _dmxRef.current.send();
              }
            } else if (currentCue.type === "org.webvmt.example.byebyeworldclapper") {
              console.log("Current Cue for", forValue, ":", currentCue.value);
              if (_handleRobotRef.current && _handleRobotRef.current.connected) {
                _handleRobotRef.current?.[forValue]?.(currentCue.value);
              }
            }
          } else {
            //_visualizerRef.current.updateColor( forValue, { color: defaultColor } )
            console.log("No active cues for", forValue, ". Reverting to default color.");
            const defaultColor = "#666"; // 薄い紫色 (Indigo-300)
            if (forValue === "left") {
              _starsLeftRef.current.setColor(defaultColor);
            } else if (forValue === "right") {
              _starsRightRef.current.setColor(defaultColor);
            }
            if (_dmxRef.current && _dmxRef.current.connected) {
              // _dmxRef.current.clear();
              // await _dmxRef.current.send();
            }
          }
        });
        _visualizerRef.current.updateColor(forValue, { color: defaultColor });

        _videoRef.current.addEventListener("play", async () => {
          setIsVideoPlayed(true);
        });
        _videoRef.current.addEventListener("pause", async () => {
          setIsVideoPlayed(false);
        });
      }
    }
  }, []);

  useEffect(() => {
    if (_trackRef.current) {
      // to prevent called twice.
      if (_called.current) return;
      _called.current = true;

      // set oncuechange event for VTT
      _trackRef.current.oncuechange = function () {
        const cues = _trackRef.current.track.activeCues;

        if (cues.length === 0) {
          setLyrics([]);
        } else {
          setLyrics(cues[cues.length - 1].text.split("\n"));
        }
      };

      (async () => {
        // set loadVmtFiles &
        await window._loadVmtFiles();
        _setOnCueChangeEventForVMT();
      })();
    }
  }, [_setOnCueChangeEventForVMT]);

  useEffect(() => {
    return () => {
      if (_replayTimeoutRef.current) {
        clearTimeout(_replayTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const onUserActivity = () => {
      _resetCursorTimer();
    };

    _resetCursorTimer();
    window.addEventListener("mousemove", onUserActivity);
    window.addEventListener("mousedown", onUserActivity);
    window.addEventListener("wheel", onUserActivity);
    window.addEventListener("touchstart", onUserActivity);

    return () => {
      window.removeEventListener("mousemove", onUserActivity);
      window.removeEventListener("mousedown", onUserActivity);
      window.removeEventListener("wheel", onUserActivity);
      window.removeEventListener("touchstart", onUserActivity);
      if (_cursorHideTimeoutRef.current) {
        clearTimeout(_cursorHideTimeoutRef.current);
      }
    };
  }, [_resetCursorTimer]);

  useEffect(() => {
    const onKeyDown = async (event) => {
      const tagName = event.target?.tagName;
      const isTypingTarget =
        tagName === "INPUT" ||
        tagName === "TEXTAREA" ||
        event.target?.isContentEditable;
      if (isTypingTarget) return;

      const key = event.key.toLowerCase();
      if (key === "c") {
        await Promise.all([_toggleClapper(true), _toggleDMX(true)]);
      } else if (key === "r") {
        await Promise.all([_toggleClapper(false), _toggleDMX(false), _pauseMusic()]);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [_toggleClapper, _toggleDMX]);

  return (
    <div className={_isCursorVisible ? "App" : "App cursor-hidden"}>
      <main>
        <div className="App-content">
          <div className="header">
            <h1>Angle Brackets Rise</h1>
          </div>
          <div className="media-controller">
            <video
              style={{ width: "50vw", visibility: "hidden" }}
              controls
              ref={_videoRef}
              onEnded={() => {
                if (_replayTimeoutRef.current) {
                  clearTimeout(_replayTimeoutRef.current);
                }
                // loopではなく余韻を残すために終了後5秒たったら再生させる
                _replayTimeoutRef.current = setTimeout(async () => {
                  if (!_videoRef.current) return;
                  _videoRef.current.currentTime = 0;
                  await _videoRef.current.play();
                }, 5000);
              }}
            >
              <source src="/assets/angle_brackets_rise.m4a" type="audio/mpeg" />
              <track ref={_trackRef} src="/assets/lyric.vtt" kind="subtitles" srcLang="en" label="English" default />
              <track src="/assets/dmx-left.vmt" kind="metadata" htmlFor="left" default />
              <track src="/assets/dmx-right.vmt" kind="metadata" htmlFor="right" default />
              <track src="/assets/byebyeworldclapper_clap.vmt" kind="metadata" htmlFor="clap" default />
              <track src="/assets/byebyeworldclapper_eye.vmt" kind="metadata" htmlFor="eye" default />
              <track src="/assets/byebyeworldclapper_mouth.vmt" kind="metadata" htmlFor="mouth" default />
            </video>
          </div>
          <div className="dashboard">
            <Button
              type="primary"
              danger={_isVideoPlayed}
              onClick={async () => {
                if (_videoRef.current.paused) {
                  await _videoRef.current.play();
                } else {
                  _videoRef.current.pause();
                }
              }}
            >
              {!_isVideoPlayed ? "Play music" : "Pause music"}
            </Button>
            <br />
            <Switch
              checkedChildren="clapper On"
              checked={_isClapperOn}
              unCheckedChildren="clapper Off"
              onChange={_toggleClapper}
            />
            <Switch
              checkedChildren="DMX On"
              checked={_isSwitchToggled}
              unCheckedChildren="DMX Off"
              onChange={_toggleDMX}
            />
            <Switch
              style={{ marginLeft: "10px" }}
              checkedChildren="video controller On"
              unCheckedChildren="video controller Off"
              onChange={(checked) => {
                if (checked) {
                  _videoRef.current.style.visibility = "visible";
                } else {
                  _videoRef.current.style.visibility = "hidden";
                }
              }}
            />
          </div>
          <div className="stars-left">
            <Stars ref={_starsLeftRef} />
          </div>
          <div className="stars-right">
            <Stars ref={_starsRightRef} />
          </div>
          <div className="lyric">
            {_lyrics.map((line, key) => (
              <div key={key}>{line}</div>
            ))}
          </div>
          <AudioVisualizer videoElem={_videoRef.current} ref={_visualizerRef} />
        </div>
      </main>
    </div>
  );
}

export default App;
