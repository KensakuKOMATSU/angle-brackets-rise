import { useEffect, useCallback, useState, useRef } from "react";
import AudioVisualizer from "./components/audio-visualizer";
import Stars from "./components/stars";

import DMXWrapper from "./libs/dmx-wrapper";
import { datacue2dmx } from "./libs/datacue2dmx";

import ByebyeworldWrapper from "./libs/byebyeworldclapper-wrapper";
import StackChanWrapper from "./libs/stackchan-wrapper";

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
  const _stackChanRefs = useRef({ serial: null, bluetooth: null });
  const _stackChanReactionRefs = useRef({});

  const [_isVideoPlayed, setIsVideoPlayed] = useState(false);
  const [_isSwitchToggled, setIsSwitchToggled] = useState(false);
  const [_isClapperOn, setIsClapperOn] = useState(false);
  const [_isCursorVisible, setIsCursorVisible] = useState(true);
  const [_stackChanConnected, setStackChanConnected] = useState({ serial: false, bluetooth: false });
  const [_stackChanConnecting, setStackChanConnecting] = useState({ serial: false, bluetooth: false });
  const [_stackChanError, setStackChanError] = useState("");

  const _reportStackChanError = useCallback((transport, error) => {
    const label = transport === "serial" ? "StackChan-Serial" : "StackChan-BT";
    console.error(`${label}:`, error);
    setStackChanError(`${label}: ${error.message || error}`);
  }, []);

  const _sendStackChanControl = useCallback((transport, data) => {
    const reaction = _stackChanReactionRefs.current[transport];
    if (data.expression !== undefined) reaction.appearance.expression = data.expression;
    if (data.mouth) reaction.appearance.mouth = { ...reaction.appearance.mouth, ...data.mouth };
    const payload = { ...data };
    if (reaction.timeout !== null) {
      delete payload.expression;
      delete payload.mouth;
    }
    return Object.keys(payload).length ? _stackChanRefs.current[transport].send(payload) : Promise.resolve();
  }, []);

  const _toggleStackChan = useCallback(async (transport, checked) => {
    if (!_stackChanRefs.current[transport]) {
      const reaction = {
        appearance: { expression: "neutral", mouth: { type: "closed", open_ratio: 0 } },
        timeout: null,
      };
      _stackChanReactionRefs.current[transport] = reaction;
      _stackChanRefs.current[transport] = new StackChanWrapper({
        transport,
        onConnectionChange: (connected) => {
          if (!connected) {
            clearTimeout(reaction.timeout);
            reaction.timeout = null;
          }
          setStackChanConnected((previous) => ({ ...previous, [transport]: connected }));
        },
        onReceive: (message) => {
          console.log(`StackChan ${transport} RX:`, message);
          const wrapper = _stackChanRefs.current[transport];
          const events = message?.events;
          const hasSensorEvent = message?.type === "events" && events && (
            events.touch_front > 0 ||
            events.touch_middle > 0 ||
            events.touch_back > 0 ||
            events.touch_click > 0 ||
            events.shake === 1
          );
          if (!wrapper?.connected || !hasSensorEvent) return;
          clearTimeout(reaction.timeout);
          reaction.timeout = setTimeout(() => {
            reaction.timeout = null;
            if (wrapper.connected) {
              wrapper.send({ ...reaction.appearance, mouth: { ...reaction.appearance.mouth } })
                .catch((error) => _reportStackChanError(transport, error));
            }
          }, 3000);
          wrapper.send({ expression: "happy_heart", mouth: { type: "smile" } }).catch((error) => _reportStackChanError(transport, error));
        },
        onError: (error) => _reportStackChanError(transport, error),
      });
    }

    const wrapper = _stackChanRefs.current[transport];
    setStackChanConnecting((previous) => ({ ...previous, [transport]: true }));
    setStackChanError("");
    try {
      if (checked) {
        await wrapper.connect();
        for (const trackElement of _videoRef.current.querySelectorAll('track[kind="metadata"]')) {
          const cues = trackElement.track?.activeCues;
          const cue = cues?.[cues.length - 1];
          if (cue?.type === "org.webvmt.example.stackchan") {
            await _sendStackChanControl(transport, cue.value);
          }
        }
      } else {
        await wrapper.disconnect();
      }
    } catch (error) {
      _reportStackChanError(transport, error);
    } finally {
      setStackChanConnecting((previous) => ({ ...previous, [transport]: false }));
    }
  }, [_reportStackChanError, _sendStackChanControl]);

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
            } else if (currentCue.type === "org.webvmt.example.stackchan") {
              await Promise.all(Object.entries(_stackChanRefs.current).map(async ([transport, wrapper]) => {
                if (!wrapper?.connected) return;
                try {
                  await _sendStackChanControl(transport, currentCue.value);
                } catch (error) {
                  _reportStackChanError(transport, error);
                }
              }));
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
  }, [_reportStackChanError, _sendStackChanControl]);

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
    const wrappers = _stackChanRefs.current;
    const reactions = _stackChanReactionRefs.current;
    return () => {
      for (const reaction of Object.values(reactions)) {
        clearTimeout(reaction.timeout);
        reaction.timeout = null;
      }
      for (const wrapper of Object.values(wrappers)) {
        if (!wrapper) continue;
        wrapper.onConnectionChange = () => { };
        wrapper.onError = (error) => console.error("StackChan cleanup:", error);
        wrapper.disconnect().catch(wrapper.onError);
      }
    };
  }, []);

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
        document.activeElement?.blur?.();
      } else if (key === "r") {
        await Promise.all([_toggleClapper(false), _toggleDMX(false), _pauseMusic()]);
        document.activeElement?.blur?.();
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
              <track src="/assets/stackchan_mouth.vmt" kind="metadata" htmlFor="stackchan-mouth" default />
              <track src="/assets/stackchan_move.vmt" kind="metadata" htmlFor="stackchan-move" default />
              <track src="/assets/stackchan_face.vmt" kind="metadata" htmlFor="stackchan-face" default />
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
            <Switch
              aria-label="StackChan-Serial"
              checkedChildren="StackChan-Serial On"
              unCheckedChildren="StackChan-Serial Off"
              checked={_stackChanConnected.serial}
              loading={_stackChanConnecting.serial}
              disabled={_stackChanConnecting.serial}
              onChange={(checked) => _toggleStackChan("serial", checked)}
            />
            <Switch
              aria-label="StackChan-BT"
              checkedChildren="StackChan-BT On"
              unCheckedChildren="StackChan-BT Off"
              checked={_stackChanConnected.bluetooth}
              loading={_stackChanConnecting.bluetooth}
              disabled={_stackChanConnecting.bluetooth}
              onChange={(checked) => _toggleStackChan("bluetooth", checked)}
            />
            {_stackChanError && <div role="alert">{_stackChanError}</div>}
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
