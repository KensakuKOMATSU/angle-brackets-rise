# StackChan Browser Control

CoreS3搭載StackChanを、USB Web SerialまたはWeb Bluetoothから制御するファームウェアとブラウザテスト画面です。

## ビルド

PlatformIOで`m5stack-cores3`環境をビルドします。StackChan公式BSP 1.1.0、互換性確保のためM5Unified 0.2.20、ArduinoJson 7を使用します。BSP 1.1.0のPY32IOExpanderは`void setDirection(...)`を実装していますが、M5Unified 0.2.21以降では基底APIの戻り値が`bool`に変わるため、M5Unifiedを固定しています。ブラウザからファームウェアを書き込むツールは含みません。

```sh
pio run
```

## 起動と接続

電源投入後、画面に接続方式が5秒間表示されます。画面の左半分をタップするとWeb Serial、右半分をタップするとWeb Bluetoothが選択され、ハイライト表示とともにNVSへ保存されます。選択後も5秒の待機を続け、時間切れで選択中のモードを起動します。操作がなければ前回保存されたモードで起動します。初回起動の既定値はWeb Serialです。

ブラウザテスト画面は`test/control/index.html`です。Web Serial / Web Bluetooth APIを利用するには対応ブラウザとセキュアコンテキストが必要です。ローカルで開く場合はプロジェクトルートからHTTPサーバーを起動し、`http://localhost:8000/test/control/`を開いてください。

最小構成の単独サンプルは`test/control/minimal-web-serial.html`と`test/control/minimal-web-bluetooth.html`です。どちらもCSSなしで、接続・JSON送信・受信表示だけを実装しています。

```sh
python3 -m http.server 8000
```

Web Serialは115200 bps、1行1 JSONです。Bluetoothは`StackChan-Control`のGATTサービスを使い、RXにJSONを書き込み、TX通知で応答を受信します。

USB CDCの製品名は`StackChan Control`です。USB descriptorは起動時に設定するため、名前を変更した後はUSBを抜き差しして再認識させてください。ホストOSのポート一覧が名前をキャッシュしている場合は、一覧を閉じて開き直します。

| 用途 | UUID |
| --- | --- |
| Service | `6E400001-B5A3-F393-E0A9-E50E24DCCA9E` |
| RX (Write) | `6E400002-B5A3-F393-E0A9-E50E24DCCA9E` |
| TX (Notify) | `6E400003-B5A3-F393-E0A9-E50E24DCCA9E` |

## 制御JSON

```json
{
  "command": "control",
  "servo": { "x": 0.0, "y": 30.0, "duration": 500 },
  "expression": "happy_heart",
  "mouth": { "type": "open", "open_ratio": 80 }
}
```

ブラウザ画面の「サーボを送信」チェックは初期状態でオンです。オフの場合、JSONから`servo`全体を省略しサーボを動かしません。オンの場合は`x`左右角度（-128〜128度）、`y`上下角度（5〜85度）、`duration`移動時間（ms、0〜60000）を送信します。公式BSPのモーションAPIは速度指定のため、ファームウェアが`duration`に沿って20ms間隔で目標角を補間します。連続指令中はBSPの自動角度同期を一時停止して内部スプリングの速度を保ち、停止後に再有効化します。サーボ指令中と終了後700msは、振動によるシェイク誤検出を避けるためシェイク判定を抑制します。物理サーボの追従時間は負荷や移動距離でも変わります。

`expression`は`neutral`、`happy`、`happy_heart`、`sad`、`angry`、`surprised`、`sleepy`、`dizzy`を受け付けます。`mouth.type`は`closed`、`open`、`smile`、`round`、`open_ratio`は0〜100です。ブラウザの「表情を送信」「開きも送信」チェックで個別にキーを省略できます。表情と口はCoreS3のLCDに描画し、物理的な口機構は動かしません。各プロパティは省略可能で、省略値を維持します。

成功時は`{"ok":true,...}`、入力不正時は`{"ok":false,"error":"..."}`を応答します。

## センサー

接続中はタッチ前面・中央・背面の押下、クリック、およびIMU加速度ベクトルのサンプル差が1g以上になったシェイクを検出すると、端末から短いイベントJSONを自動送信し、受信JSON欄と通信ログに表示します。応答はイベント件数と`shake`の現在状態（検出中`1`、通常時`0`）のみを含み、電池・IMUベクトルなどの詳細データは送りません。シェイク検出後700msは再検出を抑制し、検出開始から約300ms後に解除状態`0`を送ります。必要時はJSON欄から`{"command":"sensors"}`を送信してイベント状態を取得できます。