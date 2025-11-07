import { useEffect, useState, useRef, useImperativeHandle, forwardRef } from 'react';

const Stars = forwardRef((props, ref) => {
    const _canvasElem = useRef();
    const _colorRef = useRef('#666');
    const _loadedRef = useRef(false);
    const _reqId = useRef(null);
    const [ _isColorChanged, setIsColorChanged ] = useState(true);

    useImperativeHandle(ref, () => ({
        setColor: ( color ) => {
            _colorRef.current = color;
            _loadedRef.current = false;
            setIsColorChanged(true);
        }
    }));

    useEffect(() => {
        if( !_canvasElem.current ) return;
        if( _loadedRef.current ) {
            return;
        }
        if( !_isColorChanged ) {
            return;
        }
        _loadedRef.current = true;

        const canvas = _canvasElem.current;
        canvas.style.zIndex = 5;
        const ctx = canvas.getContext('2d');

        // Set canvas dimensions
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        let W, H;
        let particles = [];
        const PARTICLE_COUNT = 50;
        //const CENTER_COLOR = 'rgba(255, 255, 200, 0.9)'; // 中央の円の色 (薄い黄色)
        //const CENTER_RADIUS = 50;

        /**
         * キャンバスサイズを親要素に合わせて設定する
         */
        function resizeCanvas() {
            const container = canvas.parentElement;
            W = container.clientWidth;
            H = container.clientHeight;
            canvas.width = W;
            canvas.height = H;
        }

        /**
         * 光の粒子オブジェクトのクラス
         */
        class Particle {
            constructor( centerX, centerY, color ) {
              this.centerX = ( centerX || W / 4 ) + Math.floor( Math.random() * 25 );
              this.centerY = ( centerY || H / 4 ) + Math.floor( Math.random() * 25 );
              this.centerRadius = W / 3;
                // 初期位置を中央付近に設定
                const angle = Math.random() * Math.PI * 2;
                const dist = Math.random() * this.centerRadius * 1.5;
                this.x = this.centerX  + Math.cos(angle) * dist;
                this.y = this.centerY + Math.sin(angle) * dist;

                // 半径はランダムで小さく設定
                this.radius = Math.random() * 1.5 + 0.5;

                // ランダムな移動速度と方向
                this.velocity = {
                    x: (Math.random() - 0.5) * 0.5,
                    y: (Math.random() - 0.5) * 0.5
                };

                // 透明度をランダムに設定し、輝きを表現
                this.alpha = Math.random();
                //this.color = `rgba(255, 255, 255, ${this.alpha})`;
                this.color = _colorRef.current || `rgb(255, 255, 255)`;

                // 透明度の変化速度
                this.fadeSpeed = Math.random() * 0.02 + 0.005;
                this.fadingIn = true; // 現在増加中か減少中か
            }

            // 粒子の移動と透明度の更新
            update() {
                // 軽い摩擦を追加
                // this.velocity.x *= 0.99;
                // this.velocity.y *= 0.99;

                // // 中央の光から遠ざかる、または近づくランダムな力を加える
                const dx = this.centerX - this.x;
                const dy = this.centerY - this.y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                // // 距離に応じて移動の方向を微調整
                const force = distance < this.centerRadius * 2 ? 0.005 : -0.001;
                this.velocity.x += dx * force;
                this.velocity.y += dy * force;


                this.x += this.velocity.x;
                this.y += this.velocity.y;

                // 境界から出たら反対側から出現させる（ループ）
                if (this.x < 0 || this.x > W || this.y < 0 || this.y > H) {
                    this.reset();
                }

                // 透明度の点滅（輝き）
                if (this.fadingIn) {
                    this.alpha += this.fadeSpeed;
                    if (this.alpha > 1) {
                        this.alpha = 1;
                        this.fadingIn = false;
                    }
                } else {
                    this.alpha -= this.fadeSpeed;
                    if (this.alpha < 0) {
                        this.alpha = 0;
                        this.fadingIn = true;
                    }
                }
                //this.color = `rgba(255, 255, 255, ${this.alpha * 0.7 + 0.3})`; // 最低透明度を0.3に設定
            }

            // 粒子のリセット
            reset() {
                const angle = Math.random() * Math.PI * 2;
                const dist = Math.random() * W / 2;
                this.x = this.centerX + Math.cos(angle) * dist;
                this.y = this.centerY + Math.sin(angle) * dist;
                this.velocity = {
                    x: (Math.random() - 0.5) * 0.5,
                    y: (Math.random() - 0.5) * 0.5
                };
            }

            // 粒子の描画
            draw() {
                const color = _colorRef.current || `rgb(255, 255, 255)`;
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2, false);
                ctx.fillStyle = color;
                ctx.shadowBlur = 5; // 粒子の周りにぼかしを追加
                ctx.shadowColor = color;
                ctx.fill();
                ctx.shadowBlur = 0; // 他の描画に影響を与えないようリセット
            }
        }

        /**
         * 粒子の初期化
         */
        function initParticles() {
            particles = [];
          const dW = Math.floor( W / 10);
          const dH = Math.floor( W / 10);
          for( let i = 0; i < 4; i++ ) {
            const centerX = dW + dW * Math.round( Math.random() * 8 );
            const centerY = dH + dH * Math.round( Math.random() * 8 );
            for (let j = 0; j < PARTICLE_COUNT; j++) {
                particles.push(new Particle( centerX, centerY, _colorRef.current ));
            }
          }
        }

        /**
         * 中心に光る円を描画
         */
        //function drawCenterGlow() {
        //  for( let i = 2; i < 5; i++ ) {
        //    const centerX = W / i;
        //    const centerY = H / i;

        //    // 1. グラデーションによる中心のぼかし光
        //    const gradient = ctx.createRadialGradient(
        //        centerX, centerY, 0,
        //        centerX, centerY, CENTER_RADIUS * 2
        //    );
        //    gradient.addColorStop(0, CENTER_COLOR); // 中央は強く
        //    gradient.addColorStop(0.5, 'rgba(100, 100, 255, 0.2)'); // 周辺は青みがかった光
        //    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)'); // 外側は透明

        //    ctx.fillStyle = gradient;
        //    ctx.fillRect(0, 0, W, H);

        //    // 2. 中心円の描画
        //    ctx.beginPath();
        //    ctx.arc(centerX, centerY, CENTER_RADIUS, 0, Math.PI * 2, false);

        //    // 強いシャドウ（光の拡散）
        //    ctx.shadowBlur = 30;
        //    ctx.shadowColor = 'rgba(255, 255, 255, 0.3)';

        //    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        //    ctx.fill();

        //    ctx.shadowBlur = 0; // リセット
        //  }
        //}

        /**
         * アニメーションループ
         */
        function animate() {
            _reqId.current = requestAnimationFrame(animate);

            // 背景をわずかに透明にして上書きすることで、古い描画を薄く残し「残像」効果を出す
            ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
            ctx.fillRect(0, 0, W, H);

            // 中心円の描画
            //drawCenterGlow();

            // 粒子の更新と描画
            particles.forEach(p => {
                p.update();
                p.draw();
            });
        }

        // --- 初期化 ---
        window.addEventListener('resize', () => {
            resizeCanvas();
            initParticles(); // サイズ変更時に粒子の位置をリセット
        });

        resizeCanvas();
        initParticles();

        if (_reqId.current) {
            cancelAnimationFrame(_reqId.current);
        }
        animate();

        setIsColorChanged(false);

        return function cleanup() {
        };
    }, [ _isColorChanged]);

    return (
        <canvas ref={_canvasElem} style={{ width: '100%', height: '100%' }} />
    );
});

export default Stars;