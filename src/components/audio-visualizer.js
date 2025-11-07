import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react'

const AudioVisualizer = forwardRef((props, ref) => {
    const { videoElem } = props
    const _canvasElem = useRef()
    const _colorRef = useRef({})

        useImperativeHandle(ref, () => ({
            updateColor: ( key, color ) => {
                _colorRef.current = { ..._colorRef.current, [key]: color };
            }
        }));



    useEffect(() => {
        if( !videoElem ) return;
        if( !_canvasElem.current ) return;

        const canvas = _canvasElem.current;
        const ctx = canvas.getContext('2d');

        // Set canvas dimensions
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        // Audio visualization logic here
        // Web Audio関連の変数
        let audioCtx;
        let analyser;
        let dataArrayTime; // タイムドメイン（PCM）データ用配列
        let dataArrayFrequency; // 周波数ドメイン（FFT）データ用配列

        // --- 1. AudioContextの初期化と接続 ---
        function setupAudio() {
            try {
                // ユーザーのジェスチャー後にAudioContextを初期化
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();

                // (1) MediaElementSource: video要素をAudioContextのソースとして接続
                console.log( videoElem )
                const source = audioCtx.createMediaElementSource(videoElem);

                // (2) AnalyserNode: 音声データを分析するためのノードを作成
                analyser = audioCtx.createAnalyser();
                
                // FFTサイズの指定 (データの細かさ。2のべき乗)
                analyser.fftSize = 2048; 
                const bufferLength = analyser.frequencyBinCount; // FFTサイズ / 2

                // データ配列の初期化
                dataArrayTime = new Uint8Array(bufferLength);
                dataArrayFrequency = new Uint8Array(bufferLength);

                // (3) 接続: Source -> Analyser -> Destination (スピーカー)
                source.connect(analyser);
                source.connect(audioCtx.destination); // これで音が聞こえるようになります

                console.log('setupAudio finished')
                // 描画ループの開始
                draw();

            } catch (error) {
                console.error("Web Audio APIの初期化に失敗しました:", error);
            }
        }

        // --- 2. 描画ループ ---
        function draw() {
            // アニメーションフレームをリクエストし、描画を継続
            requestAnimationFrame(draw);

            // キャンバスサイズを取得
            const WIDTH = canvas.offsetWidth;
            const HEIGHT = canvas.offsetHeight;
            canvas.width = WIDTH;
            canvas.height = HEIGHT;

            // 背景をクリア
            ctx.fillStyle = '#1a202c'; // 背景色
            ctx.fillRect(0, 0, WIDTH, HEIGHT);

            // -----------------------------------------------------
            // A. タイムドメイン（波形/PCM）データの取得と描画
            // -----------------------------------------------------
            analyser.getByteTimeDomainData(dataArrayTime);

            ctx.lineWidth = 4;
            //ctx.strokeStyle = 'rgb(129, 140, 248)'; // 薄い紫色 (Indigo-300)
            //const defaultColor = 'rgb(129, 140, 248)'; // 薄い紫色 (Indigo-300)

            const sliceWidth = WIDTH * 1.0 / dataArrayTime.length;
            let x = 0;

            const th = Math.floor( dataArrayTime.length / 2 )

            for (let i = 0; i < dataArrayTime.length; i++) {
                const v = dataArrayTime[i] / 128.0; // 0-255 の値を 0-2 の範囲に正規化
                const y = v * HEIGHT / 2; // 中央線基準で高さを計算

                //if( i === 0 ) 
                //    ctx.strokeStyle = _colorRef.current.left ? _colorRef.current.left.color : defaultColor
                //} else {
                //    ctx.strokeStyle = _colorRef.current.right ? _colorRef.current.right.color : defaultColor
                //}

                if (i === 0) {
                    ctx.beginPath();
                    ctx.strokeStyle = _colorRef.current.left.color
                    console.log( 'left', ctx.strokeStyle )
                    ctx.moveTo(x, y);
                } else if ( i === th ) {
                    ctx.lineTo( x, y )
                    ctx.stroke()

                    ctx.beginPath()
                    ctx.strokeStyle = _colorRef.current.right.color
                    console.log( 'right', ctx.strokeStyle )
                    ctx.moveTo( x, y )
                } else {
                    ctx.lineTo(x, y);
                }
                x += sliceWidth;
            }

            ctx.lineTo(WIDTH, HEIGHT / 2);
            ctx.stroke();

            // -----------------------------------------------------
            // B. 周波数ドメイン（スペクトラム）データの取得と描画
            // -----------------------------------------------------
            analyser.getByteFrequencyData(dataArrayFrequency);

            const barWidth = (WIDTH / dataArrayFrequency.length) * 0.9;
            let barX = 0;

            for (let i = 0; i < dataArrayFrequency.length; i++) {
                const barHeight = dataArrayFrequency[i] * 1; // 0-255 の値を描画しやすいように調整

                // グラデーションを作成
                const hue = i / dataArrayFrequency.length * 360; // 色相を周波数に応じて変化
                ctx.fillStyle = `hsl(${hue}, 100%, 50%)`;

                // 描画 (タイムドメインの上半分に表示)
                const barY = HEIGHT - barHeight;
                ctx.fillRect(barX, barY, barWidth, barHeight);

                barX += barWidth + 1; // 棒と棒の間に少し隙間を空ける
            }
            
            // -----------------------------------------------------
            // C. 周波数情報（デバッグ用）
            // -----------------------------------------------------
            if (audioCtx) {
                ctx.fillStyle = '#fef3c7'; // 薄い黄色
                ctx.font = '12px Inter';
                ctx.fillText(`sampling rate [Hz]: ${audioCtx.sampleRate}`, 10, 20);
                ctx.fillText(`FFT size: ${analyser.fftSize}`, 10, 35);
                ctx.fillText(`colorRef: ${JSON.stringify( _colorRef.current )}`, 10, 50);
            }
        }

        // --- 3. イベントリスナー ---
        // ユーザー操作 (ボタンクリック) でAudioContextを起動
        //startButton.addEventListener('click', () => {
        //    if (audioCtx && audioCtx.state === 'running') {
        //        console.log('既に開始されています。');
        //        return;
        //    }
        //    
        //    // AudioContextのセットアップと描画の開始
        //    setupAudio(); 
        //    
        //    // 動画の再生を開始（自動再生がブロックされる場合に備えて）
        //    videoElem.play().catch(e => {
        //        console.error("動画の再生に失敗しました (自動再生ブロックの可能性):", e);
        //    });

        //    startButton.disabled = true;
        //    startButton.classList.remove('bg-indigo-600');
        //    startButton.classList.add('bg-gray-400');
        //});
        
        // 画面サイズ変更時の対応 (canvasサイズを親要素に合わせる)
        window.addEventListener('resize', () => {
            const container = _canvasElem.current.parentElement;
            container.style.width = '100vw';
            container.style.height = '100vh';
            _canvasElem.current.style.width = container.offsetWidth + 'px';
            _canvasElem.current.style.height = container.offsetHeight + 'px';
        });

        setupAudio()

        return () => {
            // Cleanup
        };
    }, [videoElem])

    return (
        <div className="AudioVisualizer audio-visualizer">
            <canvas ref={_canvasElem}></canvas>
        </div>
    )

})

export default AudioVisualizer