import React, { useState, useRef } from 'react';

const SpatialAudioTest = () => {
    const [isPlaying, setIsPlaying] = useState(false);
    // Added TypeScript types for the refs here
    const audioContextRef = useRef<AudioContext | null>(null);
    const oscillatorRef = useRef<OscillatorNode | null>(null);

    const toggleAudio = async () => {
        if (isPlaying) {
            audioContextRef.current?.suspend();
            setIsPlaying(false);
            return;
        }

        // If it's the first time playing, set up the audio graph
        if (!audioContextRef.current) {
            // 1. Initialize the browser's Audio Context
            const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
            audioContextRef.current = audioCtx;

            try {
                // 2. Load the Worklet file we just made in the public folder
                await audioCtx.audioWorklet.addModule('/audio-processor.js');

                // 3. Create a node linked to your 'hrtf-processor'
                const hrtfNode = new AudioWorkletNode(audioCtx, 'hrtf-processor');

                // 4. THE MISSING PIECE: Fetch the WASM and send it to the node
                fetch('/hrtf_engine.wasm')
                    .then(response => response.arrayBuffer())
                    .then(wasmBuffer => {
                        hrtfNode.port.postMessage({ 
                            type: 'LOAD_WASM', 
                            wasmBinary: wasmBuffer 
                        });
                    })
                    .catch(err => console.error("Failed to load WASM file:", err));

                // 5. Create a test sound (a basic 440Hz beep)
                const osc = audioCtx.createOscillator();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(440, audioCtx.currentTime); 
                oscillatorRef.current = osc;

                // 6. Connect the plumbing: Beep -> WASM Engine -> Speakers
                osc.connect(hrtfNode);
                hrtfNode.connect(audioCtx.destination);
                
                osc.start();
            } catch (err) {
                console.error("Failed to load audio worklet:", err);
            }
        } else {
            audioContextRef.current.resume();
        }
        
        setIsPlaying(true);
    };

    return (
        <div style={{ padding: '20px', border: '1px solid #ccc', margin: '10px', borderRadius: '8px' }}>
            <h3>WASM HRTF Audio Engine Test</h3>
            <button onClick={toggleAudio} style={{ padding: '10px 20px', cursor: 'pointer' }}>
                {isPlaying ? 'Pause Test Sound' : 'Start Test Sound'}
            </button>
        </div>
    );
};

export default SpatialAudioTest;
